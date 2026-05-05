import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions'
import {
  modelProviders,
  parseModelProviderId,
  runModelChat,
} from '../../model/index.js'
import { McpToolManager } from '../McpToolManager.js'
import type {
  ChatReasoningEffort,
  ModelProvider,
  ModelProviderId,
} from '../../types/model.js'
import {
  chatModelStateKey,
  getProviderApiKey,
  getProviderBaseURL,
  getSelectedChatModel,
  parseReasoningEffort,
} from '../../utils/modelSettings.js'
import {
  builtinToolDefinitions,
  executeBuiltinTool,
} from '../../tools/index.js'
import type { BuiltinToolContext } from '../../types/tools.js'

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'sendMessage'; text: string }
  | { type: 'selectChatModel'; model: string }

interface UiChatMessage {
  id: string
  role: 'user' | 'assistant'
  reasoning?: string
  text: string
}

interface Thread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatCompletionMessageParam[]
  uiMessages: UiChatMessage[]
}

interface ThreadState {
  version: 1
  activeThreadId: string
  threads: Thread[]
}

interface PendingUserInput {
  resolve(value: string): void
}

type ToolContext = BuiltinToolContext & {
  workspaceFolder: vscode.WorkspaceFolder
}

export class AriaChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'aria.chatView'
  private static readonly threadStateKey = 'aria.threadState'

  private readonly context: vscode.ExtensionContext
  private readonly mcpToolManager = new McpToolManager()
  private readonly threadState: ThreadState
  private busy = false
  private pendingUserInput?: PendingUserInput
  private webviewView?: vscode.WebviewView

  constructor(context: vscode.ExtensionContext) {
    this.context = context
    this.threadState = this.loadThreadState()
  }

  async showSystemPrompt(): Promise<void> {
    const systemMessage = await this.getSystemMessage()
    const content =
      typeof systemMessage.content === 'string'
        ? systemMessage.content
        : JSON.stringify(systemMessage.content, null, 2)
    const document = await vscode.workspace.openTextDocument({
      content,
      language: 'xml',
    })

    await vscode.window.showTextDocument(document, { preview: false })
  }

  async dispose(): Promise<void> {
    await this.mcpToolManager.dispose()
  }

  async createNewThread(): Promise<void> {
    await this.createThread()
    this.webviewView?.show(true)
  }

  async showHistory(): Promise<void> {
    if (this.isThreadLocked()) {
      return
    }

    const selected = await vscode.window.showQuickPick(
      this.threadState.threads.map(thread => ({
        label: thread.title,
        description:
          thread.id === this.threadState.activeThreadId ? 'current' : undefined,
        detail: new Date(thread.updatedAt).toLocaleString(),
        threadId: thread.id,
      })),
      {
        placeHolder: 'Select chat history',
      },
    )

    if (!selected) {
      return
    }

    await this.selectThread(selected.threadId)
    this.webviewView?.show(true)
  }

  async deleteThread(): Promise<void> {
    if (this.isThreadLocked()) {
      return
    }

    const selected = await vscode.window.showQuickPick(
      this.threadState.threads.map(thread => ({
        label: thread.title,
        description:
          thread.id === this.threadState.activeThreadId ? 'current' : undefined,
        detail: new Date(thread.updatedAt).toLocaleString(),
        threadId: thread.id,
      })),
      {
        placeHolder: 'Select thread to delete',
      },
    )

    if (!selected) {
      return
    }

    await this.deleteThreadById(selected.threadId)
    this.webviewView?.show(true)
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView
    const webview = webviewView.webview
    const webviewDistUri = vscode.Uri.joinPath(
      this.context.extensionUri,
      'dist',
      'webview',
    )

    webview.options = {
      enableScripts: true,
      localResourceRoots: [webviewDistUri],
    }
    webview.html = this.getHtml(webview)

    webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.handleMessage(message)
    })
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.postThreadState()
        await this.postChatModelState()
        return
      case 'sendMessage':
        await this.handleUserText(message.text)
        return
      case 'selectChatModel':
        await this.selectChatModel(message.model)
        return
    }
  }

  private async handleUserText(text: string): Promise<void> {
    const userText = text.trim()

    if (!userText) {
      return
    }

    if (this.pendingUserInput) {
      const { resolve } = this.pendingUserInput
      this.pendingUserInput = undefined
      this.addUiMessage({
        role: 'user',
        text: userText,
      })
      await this.saveThreadState()
      await this.postMessage({ type: 'loading', loading: true })
      resolve(userText)
      return
    }

    await this.sendMessage(userText)
  }

  private async sendMessage(userText: string): Promise<void> {
    if (this.busy) {
      return
    }

    const thread = this.getActiveThread()
    this.addUiMessage({ role: 'user', text: userText })
    this.updateThreadTitle(thread, userText)
    await this.saveThreadState()
    await this.postThreadState()

    const config = vscode.workspace.getConfiguration('aria.api')
    const providerId = await this.getConfiguredProviderId(config)

    if (!providerId) {
      return
    }

    const apiKey = getProviderApiKey(config, providerId)

    if (!apiKey) {
      await this.postError(
        `Configure aria.api.apiKeys.${providerId} before sending a message.`,
      )
      return
    }

    const baseURL = getProviderBaseURL(config, providerId)

    if (providerId === 'openai-compatible' && !baseURL) {
      await this.postError(
        'Configure aria.api.baseURLs.openai-compatible before sending a message.',
      )
      return
    }

    const chatModel = getSelectedChatModel(this.context, providerId)

    let reasoningEffort: ChatReasoningEffort

    try {
      reasoningEffort = parseReasoningEffort(
        config.get<string>('reasoningEffort')?.trim(),
        'Configure aria.api.reasoningEffort before sending a message.',
      )
    } catch (error) {
      await this.postError(
        error instanceof Error
          ? error.message
          : 'Configure aria.api.reasoningEffort before sending a message.',
      )
      return
    }

    await this.postMessage({ type: 'loading', loading: true })
    this.busy = true

    try {
      let assistantMessage: UiChatMessage | undefined
      const messages = await this.runAssistantTurn(
        {
          apiKey,
          baseURL,
          chatModel,
          providerId,
          reasoningEffort,
        },
        userText,
        delta => {
          assistantMessage ??= this.addUiMessage({
            role: 'assistant',
            reasoning: '',
            text: '',
          })

          if (delta.type === 'reasoning') {
            assistantMessage.reasoning = `${assistantMessage.reasoning ?? ''}${delta.text}`
            return
          }

          assistantMessage.text += delta.text
        },
      )
      thread.messages = messages
      await this.saveThreadState()
      await this.postThreadState()
    } catch (error) {
      await this.postError(
        error instanceof Error ? error.message : 'Model request failed.',
      )
    } finally {
      this.busy = false
      await this.postMessage({ type: 'loading', loading: false })
    }
  }

  private async postError(message: string): Promise<void> {
    this.addUiMessage({
      role: 'assistant',
      text: message,
    })
    await this.saveThreadState()
    await this.postMessage({ type: 'error', message })
  }

  private async runAssistantTurn(
    config: {
      apiKey: string
      baseURL?: string
      chatModel: string
      providerId: ModelProviderId
      reasoningEffort: ChatReasoningEffort
    },
    userText: string,
    onDelta: (delta: { type: 'content' | 'reasoning'; text: string }) => void,
  ): Promise<ChatCompletionMessageParam[]> {
    const toolContext = this.getToolContext()
    const mcpToolDefinitions = toolContext
      ? await this.mcpToolManager.getToolDefinitions(
          toolContext.workspaceFolder,
        )
      : []
    const tools = toolContext
      ? [...builtinToolDefinitions, ...mcpToolDefinitions]
      : []
    const systemMessage = await this.getSystemMessage()
    const systemPrompt =
      typeof systemMessage.content === 'string'
        ? systemMessage.content
        : JSON.stringify(systemMessage.content)

    return await runModelChat({
      providerId: config.providerId,
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      model: config.chatModel,
      systemPrompt,
      messages: this.getActiveThread().messages,
      userText,
      tools,
      reasoningEffort: config.reasoningEffort,
      executeTool: toolContext
        ? toolCall => this.executeToolCall(toolCall, toolContext)
        : undefined,
      maxToolRounds: tools.length > 0 ? 5 : undefined,
      onEvent: async delta => {
        if (delta.type === 'toolCalls') {
          return
        }

        if (delta.type === 'content') {
          onDelta(delta)
          await this.postMessage({
            type: 'assistantMessageDelta',
            text: delta.text,
          })
          return
        }

        if (delta.type === 'reasoning') {
          onDelta(delta)
          await this.postMessage({
            type: 'assistantReasoningDelta',
            text: delta.text,
          })
        }
      },
    })
  }

  private loadThreadState(): ThreadState {
    const saved = this.context.workspaceState.get<Partial<ThreadState>>(
      AriaChatViewProvider.threadStateKey,
    )

    if (!saved || !Array.isArray(saved.threads) || saved.threads.length === 0) {
      const thread = this.createEmptyThread()
      return {
        version: 1,
        activeThreadId: thread.id,
        threads: [thread],
      }
    }

    const threads = saved.threads
      .filter(thread => typeof thread.id === 'string')
      .map(thread => ({
        id: thread.id,
        title: normalizeThreadTitle(thread.title),
        createdAt:
          typeof thread.createdAt === 'number' ? thread.createdAt : Date.now(),
        updatedAt:
          typeof thread.updatedAt === 'number' ? thread.updatedAt : Date.now(),
        messages: Array.isArray(thread.messages) ? thread.messages : [],
        uiMessages: Array.isArray(thread.uiMessages) ? thread.uiMessages : [],
      }))

    if (threads.length === 0) {
      const thread = this.createEmptyThread()
      return {
        version: 1,
        activeThreadId: thread.id,
        threads: [thread],
      }
    }

    const activeThreadId =
      typeof saved.activeThreadId === 'string' &&
      threads.some(thread => thread.id === saved.activeThreadId)
        ? saved.activeThreadId
        : threads[0]!.id

    return {
      version: 1,
      activeThreadId,
      threads,
    }
  }

  private async saveThreadState(): Promise<void> {
    await this.context.workspaceState.update(
      AriaChatViewProvider.threadStateKey,
      this.threadState,
    )
  }

  private async createThread(): Promise<void> {
    if (this.isThreadLocked()) {
      return
    }

    const thread = this.createEmptyThread()
    this.threadState.threads.unshift(thread)
    this.threadState.activeThreadId = thread.id
    await this.saveThreadState()
    await this.postThreadState()
  }

  private async selectThread(threadId: string): Promise<void> {
    if (this.isThreadLocked()) {
      return
    }

    if (!this.threadState.threads.some(thread => thread.id === threadId)) {
      return
    }

    this.threadState.activeThreadId = threadId
    await this.saveThreadState()
    await this.postThreadState()
  }

  private async deleteThreadById(threadId: string): Promise<void> {
    const index = this.threadState.threads.findIndex(
      thread => thread.id === threadId,
    )

    if (index === -1) {
      return
    }

    this.threadState.threads.splice(index, 1)

    if (this.threadState.threads.length === 0) {
      const thread = this.createEmptyThread()
      this.threadState.threads.push(thread)
      this.threadState.activeThreadId = thread.id
    } else if (this.threadState.activeThreadId === threadId) {
      this.threadState.activeThreadId =
        this.threadState.threads[Math.max(index - 1, 0)]?.id ??
        this.threadState.threads[0]!.id
    }

    await this.saveThreadState()
    await this.postThreadState()
  }

  private createEmptyThread(): Thread {
    const now = Date.now()

    return {
      id: randomUUID(),
      title: 'New Thread',
      createdAt: now,
      updatedAt: now,
      messages: [],
      uiMessages: [],
    }
  }

  private getActiveThread(): Thread {
    const thread = this.threadState.threads.find(
      item => item.id === this.threadState.activeThreadId,
    )

    if (!thread) {
      throw new Error('Active thread not found.')
    }

    return thread
  }

  private addUiMessage(message: Omit<UiChatMessage, 'id'>): UiChatMessage {
    const thread = this.getActiveThread()
    const uiMessage = {
      id: randomUUID(),
      ...message,
    }

    thread.uiMessages.push(uiMessage)
    thread.updatedAt = Date.now()
    this.sortThreads()

    return uiMessage
  }

  private updateThreadTitle(thread: Thread, userText: string): void {
    if (thread.title !== 'New Thread') {
      return
    }

    thread.title = normalizeThreadTitle(userText)
  }

  private sortThreads(): void {
    this.threadState.threads.sort(
      (left, right) => right.updatedAt - left.updatedAt,
    )
  }

  private isThreadLocked(): boolean {
    return this.busy || this.pendingUserInput !== undefined
  }

  private async postThreadState(): Promise<void> {
    const activeThread = this.getActiveThread()

    await this.postMessage({
      type: 'threadState',
      messages: activeThread.uiMessages,
    })
  }

  async postChatModelState(): Promise<void> {
    const config = vscode.workspace.getConfiguration('aria.api')
    const providerId = await this.getConfiguredProviderId(config)

    if (!providerId) {
      return
    }

    const provider: ModelProvider = modelProviders[providerId]
    const selectedModel = getSelectedChatModel(this.context, providerId)

    await this.postMessage({
      type: 'chatModelState',
      models: provider.chatModels,
      selectedModel,
    })
  }

  private async executeToolCall(
    toolCall: ChatCompletionMessageToolCall,
    toolContext: ToolContext,
  ): Promise<string> {
    if (toolCall.type !== 'function') {
      return JSON.stringify({
        ok: false,
        error: `Unsupported tool call type: ${toolCall.type}`,
      })
    }

    if (this.mcpToolManager.hasTool(toolCall.function.name)) {
      return await this.mcpToolManager.executeTool(
        toolCall.function.name,
        toolCall.function.arguments,
      )
    }

    return await executeBuiltinTool(
      toolCall.function.name,
      toolCall.function.arguments,
      toolContext,
    )
  }

  private async postMessage(message: unknown): Promise<void> {
    await this.webviewView?.webview.postMessage(message)
  }

  private async getConfiguredProviderId(
    config: vscode.WorkspaceConfiguration,
  ): Promise<ModelProviderId | undefined> {
    try {
      return parseModelProviderId(config.get<string>('provider')?.trim())
    } catch (error) {
      await this.postError(
        error instanceof Error
          ? error.message
          : 'Configure aria.api.provider before sending a message.',
      )
      return undefined
    }
  }

  private async selectChatModel(model: string): Promise<void> {
    if (this.isThreadLocked()) {
      await this.postChatModelState()
      return
    }

    const config = vscode.workspace.getConfiguration('aria.api')
    const providerId = await this.getConfiguredProviderId(config)

    if (!providerId) {
      return
    }

    const provider: ModelProvider = modelProviders[providerId]

    if (!provider.chatModels.includes(model)) {
      await this.postChatModelState()
      return
    }

    const selectedModels =
      this.context.workspaceState.get<Record<string, string>>(
        chatModelStateKey,
      ) ?? {}

    await this.context.workspaceState.update(chatModelStateKey, {
      ...selectedModels,
      [providerId]: model,
    })
    await this.postChatModelState()
  }

  private async getSystemMessage(): Promise<ChatCompletionMessageParam> {
    const identityContent = await this.readIdentityInstructions()
    const agentsContent = await this.readAgentsInstructions()

    return {
      role: 'system',
      content: this.buildSystemPrompt(identityContent, agentsContent),
    }
  }

  private buildSystemPrompt(
    identityContent: string,
    agentsContent: string | undefined,
  ): string {
    const repositoryInstructions = agentsContent
      ? `\n  <repository_instructions><![CDATA[\n${agentsContent}\n  ]]></repository_instructions>`
      : ''

    return `<system_prompt>
  <identity><![CDATA[
${identityContent}
  ]]></identity>${repositoryInstructions}
</system_prompt>`
  }

  private async readIdentityInstructions(): Promise<string> {
    const identityUri = vscode.Uri.joinPath(
      this.context.extensionUri,
      'resources',
      'identity.md',
    )
    const content = await vscode.workspace.fs.readFile(identityUri)

    return new TextDecoder('utf-8').decode(content).trim()
  }

  private async readAgentsInstructions(): Promise<string | undefined> {
    const workspaceFolder = this.getCurrentWorkspaceFolder()

    if (!workspaceFolder) {
      return undefined
    }

    const agentsUri = vscode.Uri.joinPath(workspaceFolder.uri, 'AGENTS.md')

    try {
      const content = await vscode.workspace.fs.readFile(agentsUri)
      return new TextDecoder('utf-8').decode(content).trim()
    } catch (error) {
      if (error instanceof vscode.FileSystemError) {
        return undefined
      }

      throw error
    }
  }

  private getCurrentWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0]
  }

  private getToolContext(): ToolContext | undefined {
    const workspaceFolder = this.getCurrentWorkspaceFolder()
    return workspaceFolder
      ? {
          workspaceFolder,
          cwd: workspaceFolder.uri.fsPath,
          askUser: (question, options) => this.askUser(question, options),
        }
      : undefined
  }

  private async askUser(question: string, options: string[]): Promise<string> {
    if (this.pendingUserInput) {
      throw new Error('Already waiting for user input.')
    }

    this.addUiMessage({
      role: 'assistant',
      text: question,
    })
    await this.saveThreadState()
    await this.postMessage({ type: 'askUser', question, options })
    await this.postMessage({ type: 'loading', loading: false })

    return await new Promise(resolve => {
      this.pendingUserInput = { resolve }
    })
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce()
    const scriptUri = this.getWebviewUri(webview, 'assets/index.js')
    const styleUri = this.getWebviewUri(webview, 'assets/index.css')

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link nonce="${nonce}" href="${styleUri}" rel="stylesheet">
    <title>Aria Chat</title>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`
  }

  private getWebviewUri(
    webview: vscode.Webview,
    relativePath: string,
  ): vscode.Uri {
    return webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        'dist',
        'webview',
        ...relativePath.split('/'),
      ),
    )
  }
}

function getNonce(): string {
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let text = ''

  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }

  return text
}

function normalizeThreadTitle(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim()

  if (!firstLine) {
    return 'New Thread'
  }

  return firstLine.length > 40 ? `${firstLine.slice(0, 37)}...` : firstLine
}
