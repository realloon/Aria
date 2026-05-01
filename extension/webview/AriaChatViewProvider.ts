import * as vscode from 'vscode'
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions'
import { streamChat } from '../model/ModelApiClient.js'
import {
  builtinToolDefinitions,
  executeBuiltinTool,
} from '../tools/BuiltinTools.js'

type AssistantMessageWithReasoning = ChatCompletionAssistantMessageParam & {
  reasoning_content?: string
}

type WebviewMessage = { type: 'ready' } | { type: 'sendMessage'; text: string }

export class AriaChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'aria.chatView'

  private readonly messages: ChatCompletionMessageParam[] = []
  private webviewView?: vscode.WebviewView

  constructor(private readonly context: vscode.ExtensionContext) {}

  async showSystemPrompt(): Promise<void> {
    const systemMessage = await this.getSystemMessage()
    const content =
      typeof systemMessage.content === 'string'
        ? systemMessage.content
        : JSON.stringify(systemMessage.content, null, 2)
    const document = await vscode.workspace.openTextDocument({
      content,
      language: 'markdown',
    })

    await vscode.window.showTextDocument(document, { preview: false })
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
        return
      case 'sendMessage':
        await this.sendMessage(message.text)
        return
    }
  }

  private async sendMessage(text: string): Promise<void> {
    const userText = text.trim()

    if (!userText) {
      return
    }

    const config = vscode.workspace.getConfiguration('aria.api')
    const baseUrl = config.get<string>('baseUrl')?.trim() ?? ''
    const model = config.get<string>('model')?.trim() ?? ''
    const apiKey = config.get<string>('apiKey')?.trim() ?? ''

    if (!apiKey) {
      await this.postError('Set an API key before sending a message.')
      return
    }

    if (!baseUrl) {
      await this.postError(
        'Configure aria.api.baseUrl before sending a message.',
      )
      return
    }

    if (!model) {
      await this.postError('Configure aria.api.model before sending a message.')
      return
    }

    const messageStartIndex = this.messages.length
    this.messages.push({ role: 'user', content: userText })
    await this.postMessage({ type: 'loading', loading: true })

    try {
      await this.postMessage({ type: 'assistantMessageStart' })

      const turnMessages = await this.runAssistantTurn({
        apiKey,
        baseUrl,
        model,
      })
      this.messages.push(...turnMessages)
    } catch (error) {
      this.messages.splice(messageStartIndex)
      await this.postError(
        error instanceof Error ? error.message : 'Model request failed.',
      )
    } finally {
      await this.postMessage({ type: 'loading', loading: false })
    }
  }

  private async postError(message: string): Promise<void> {
    await this.postMessage({ type: 'error', message })
  }

  private async runAssistantTurn(config: {
    apiKey: string
    baseUrl: string
    model: string
  }): Promise<ChatCompletionMessageParam[]> {
    const maxToolRounds = 5
    const turnMessages: ChatCompletionMessageParam[] = []
    const toolContext = this.getToolContext()
    const tools = toolContext ? builtinToolDefinitions : []

    for (let round = 0; round < maxToolRounds; round += 1) {
      let responseText = ''
      let reasoningText = ''
      let toolCalls: ChatCompletionMessageToolCall[] = []
      const messages = [
        await this.getSystemMessage(),
        ...this.messages,
        ...turnMessages,
      ] satisfies ChatCompletionMessageParam[]

      for await (const delta of streamChat(config, messages, tools)) {
        if (delta.type === 'content') {
          responseText += delta.text
          await this.postMessage({
            type: 'assistantMessageDelta',
            text: delta.text,
          })
          continue
        }

        if (delta.type === 'reasoning') {
          reasoningText += delta.text
          await this.postMessage({
            type: 'assistantReasoningDelta',
            text: delta.text,
          })
          continue
        }

        toolCalls = delta.toolCalls
      }

      if (toolCalls.length === 0) {
        turnMessages.push(
          this.createAssistantMessage({
            content: responseText,
            reasoningContent: reasoningText,
          }),
        )
        return turnMessages
      }

      turnMessages.push(
        this.createAssistantMessage({
          content: responseText,
          reasoningContent: reasoningText,
          toolCalls,
        }),
      )

      if (!toolContext) {
        throw new Error('Open a workspace before using tools.')
      }

      turnMessages.push(
        ...(await Promise.all(
          toolCalls.map(toolCall =>
            this.executeToolCall(toolCall, toolContext),
          ),
        )),
      )
    }

    throw new Error('Stopped after too many tool call rounds.')
  }

  private async executeToolCall(
    toolCall: ChatCompletionMessageToolCall,
    toolContext: { cwd: string },
  ): Promise<ChatCompletionToolMessageParam> {
    if (toolCall.type !== 'function') {
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({
          ok: false,
          error: `Unsupported tool call type: ${toolCall.type}`,
        }),
      }
    }

    const content = await executeBuiltinTool(
      toolCall.function.name,
      toolCall.function.arguments,
      toolContext,
    )

    return {
      role: 'tool',
      tool_call_id: toolCall.id,
      content,
    }
  }

  private createAssistantMessage(options: {
    content: string
    reasoningContent: string
    toolCalls?: ChatCompletionMessageToolCall[]
  }): AssistantMessageWithReasoning {
    const message: AssistantMessageWithReasoning = {
      role: 'assistant',
      content: options.content || null,
    }

    if (options.reasoningContent) {
      message.reasoning_content = options.reasoningContent
    }

    if (options.toolCalls) {
      message.tool_calls = options.toolCalls
    }

    return message
  }

  private async postMessage(message: unknown): Promise<void> {
    await this.webviewView?.webview.postMessage(message)
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

  private getToolContext(): { cwd: string } | undefined {
    const workspaceFolder = this.getCurrentWorkspaceFolder()
    return workspaceFolder ? { cwd: workspaceFolder.uri.fsPath } : undefined
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
