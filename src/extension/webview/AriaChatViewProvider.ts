import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import type {
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
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
  getChatModelDisplayName,
  getProviderApiKey,
  getProviderBaseURL,
  getSelectedChatModel,
  parseReasoningEffort,
} from '../../utils/modelSettings.js'
import {
  builtinToolDefinitions,
  executeBuiltinTool,
} from '../../tools/index.js'
import type {
  ChatTraceItem,
  ChatMessage,
  ExtensionMessage,
  ToolActivity,
  WebviewMessage,
} from '../../types/chat.js'
import type { BuiltinToolContext } from '../../types/tools.js'

interface Thread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatCompletionMessageParam[]
  uiMessages: ChatMessage[]
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

export class AriaChatViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
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

  async showSystemPrompt() {
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

  dispose() {
    void this.mcpToolManager.dispose().catch(error => {
      console.error('Failed to dispose MCP tool manager.', error)
    })
  }

  async createNewThread() {
    await this.createThread()
    this.webviewView?.show(true)
  }

  async showHistory() {
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

  async deleteThread() {
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

    if (!selected) return

    await this.deleteThreadById(selected.threadId)
    this.webviewView?.show(true)
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
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

  private async handleMessage(message: WebviewMessage) {
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

  private async handleUserText(text: string) {
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

  private async sendMessage(userText: string) {
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
      let assistantMessage: ChatMessage | undefined
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
            trace: [],
            text: '',
          })

          if (delta.type === 'reasoning') {
            const traceItem = ensureCurrentTrace(assistantMessage, 'reasoning')
            traceItem.text = `${traceItem.text ?? ''}${delta.text}`
            return
          }

          assistantMessage.text += delta.text
        },
        tools => {
          assistantMessage ??= this.addUiMessage({
            role: 'assistant',
            trace: [],
            text: '',
          })
          const traceItem = ensureCurrentTrace(assistantMessage, 'tools')
          traceItem.tools = [...(traceItem.tools ?? []), ...tools]
        },
        toolCallId => {
          if (!assistantMessage?.trace) {
            return
          }

          const traceItem = assistantMessage.trace.find(
            item =>
              item.type === 'tools' &&
              item.tools?.some(tool => tool.id === toolCallId),
          )
          const tool = traceItem?.tools?.find(item => item.id === toolCallId)

          if (tool) {
            tool.state = 'done'
          }
        },
      )
      if (assistantMessage) {
        assistantMessage.traceFinishedAt = Date.now()
      }
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

  private async postError(message: string) {
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
    onToolCallsStarted: (tools: ToolActivity[]) => void,
    onToolCallDone: (toolCallId: string) => void,
  ) {
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
      reasoningEffort: config.reasoningEffort,
      toolConfig: toolContext
        ? {
            tools,
            executeTool: toolCall =>
              this.executeToolCallWithStatus(
                toolCall,
                toolContext,
                onToolCallDone,
              ),
          }
        : undefined,
      onEvent: async event => {
        if (event.type === 'toolCalls') {
          const tools = event.toolCalls.map(toToolActivity)
          onToolCallsStarted(tools)
          await this.postMessage({
            type: 'assistantToolCallsStarted',
            tools,
          })
          return
        }

        if (event.type === 'content') {
          onDelta(event)
          await this.postMessage({
            type: 'assistantMessageDelta',
            text: event.text,
          })
          return
        }

        if (event.type === 'reasoning') {
          onDelta(event)
          await this.postMessage({
            type: 'assistantReasoningDelta',
            text: event.text,
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

  private async saveThreadState() {
    await this.context.workspaceState.update(
      AriaChatViewProvider.threadStateKey,
      this.threadState,
    )
  }

  private async createThread() {
    if (this.isThreadLocked()) {
      return
    }

    const thread = this.createEmptyThread()
    this.threadState.threads.unshift(thread)
    this.threadState.activeThreadId = thread.id
    await this.saveThreadState()
    await this.postThreadState()
  }

  private async selectThread(threadId: string) {
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

  private async deleteThreadById(threadId: string) {
    const index = this.threadState.threads.findIndex(
      thread => thread.id === threadId,
    )

    if (index === -1) return

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

  private createEmptyThread() {
    const now = Date.now()

    return {
      id: randomUUID(),
      title: 'New Thread',
      createdAt: now,
      updatedAt: now,
      messages: [],
      uiMessages: [],
    } as Thread
  }

  private getActiveThread() {
    const thread = this.threadState.threads.find(
      item => item.id === this.threadState.activeThreadId,
    )

    if (!thread) {
      throw new Error('Active thread not found.')
    }

    return thread
  }

  private addUiMessage(message: Omit<ChatMessage, 'id'>) {
    const thread = this.getActiveThread()
    const uiMessage = {
      id: randomUUID(),
      ...message,
    }

    thread.uiMessages.push(uiMessage)
    thread.updatedAt = Date.now()
    this.sortThreads()

    return uiMessage as ChatMessage
  }

  private updateThreadTitle(thread: Thread, userText: string) {
    if (thread.title !== 'New Thread') {
      return
    }

    thread.title = normalizeThreadTitle(userText)
  }

  private sortThreads() {
    this.threadState.threads.sort(
      (left, right) => right.updatedAt - left.updatedAt,
    )
  }

  private isThreadLocked() {
    return this.busy || this.pendingUserInput !== undefined
  }

  private async postThreadState() {
    const activeThread = this.getActiveThread()

    await this.postMessage({
      type: 'threadState',
      messages: activeThread.uiMessages,
    })
  }

  async postChatModelState() {
    const config = vscode.workspace.getConfiguration('aria.api')
    const providerId = await this.getConfiguredProviderId(config)

    if (!providerId) {
      return
    }

    const provider: ModelProvider = modelProviders[providerId]
    const selectedModel = getSelectedChatModel(this.context, providerId)

    await this.postMessage({
      type: 'chatModelState',
      models: provider.chatModels.map(model => ({
        id: model,
        label: getChatModelDisplayName(provider, model),
      })),
      selectedModel,
    })
  }

  private async executeToolCall(
    toolCall: ChatCompletionMessageFunctionToolCall,
    toolContext: ToolContext,
  ) {
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

  private async executeToolCallWithStatus(
    toolCall: ChatCompletionMessageFunctionToolCall,
    toolContext: ToolContext,
    onDone: (toolCallId: string) => void,
  ) {
    try {
      return await this.executeToolCall(toolCall, toolContext)
    } finally {
      onDone(toolCall.id)
      await this.postMessage({
        type: 'assistantToolCallDone',
        id: toolCall.id,
      })
    }
  }

  private async postMessage(message: ExtensionMessage) {
    await this.webviewView?.webview.postMessage(message)
  }

  private async getConfiguredProviderId(config: vscode.WorkspaceConfiguration) {
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

  private async selectChatModel(model: string) {
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

  private async getSystemMessage() {
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
  ) {
    const repositoryInstructions = agentsContent
      ? `\n  <repository_instructions><![CDATA[\n${agentsContent}\n  ]]></repository_instructions>`
      : ''

    return `<system_prompt>
  <identity><![CDATA[
${identityContent}
  ]]></identity>${repositoryInstructions}
</system_prompt>`
  }

  private async readIdentityInstructions() {
    const identityUri = vscode.Uri.joinPath(
      this.context.extensionUri,
      'resources',
      'identity.md',
    )
    const content = await vscode.workspace.fs.readFile(identityUri)

    return new TextDecoder('utf-8').decode(content).trim()
  }

  private async readAgentsInstructions() {
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

  private getCurrentWorkspaceFolder() {
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

  private getHtml(webview: vscode.Webview) {
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

  private getWebviewUri(webview: vscode.Webview, relativePath: string) {
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

function getNonce() {
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let text = ''

  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }

  return text
}

function normalizeThreadTitle(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : ''
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim()

  if (!firstLine) {
    return 'New Thread'
  }

  return firstLine.length > 40 ? `${firstLine.slice(0, 37)}...` : firstLine
}

function toToolActivity(toolCall: ChatCompletionMessageFunctionToolCall) {
  return {
    id: toolCall.id,
    name: formatToolName(toolCall.function.name),
    state: 'running',
  } as ToolActivity
}

function formatToolName(name: string) {
  return name
    .replace(/^builtin__/, '')
    .replace(/__/g, ' /')
    .replace(/_/g, ' ')
}

function ensureCurrentTrace(message: ChatMessage, type: ChatTraceItem['type']) {
  message.trace ??= []
  message.traceStartedAt ??= Date.now()

  const lastTrace = message.trace.at(-1)

  if (lastTrace?.type === type) {
    return lastTrace
  }

  const traceItem: ChatTraceItem = {
    id: randomUUID(),
    type,
  }
  if (type === 'reasoning') {
    traceItem.text = ''
  } else {
    traceItem.tools = []
  }

  message.trace.push(traceItem)
  return traceItem
}
