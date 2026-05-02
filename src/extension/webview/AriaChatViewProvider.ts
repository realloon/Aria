import * as vscode from 'vscode'
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions'
import {
  createProviderModel,
  modelProviders,
  parseModelProviderId,
} from '../../model/index.js'
import type {
  ChatReasoningEffort,
  ModelProviderId,
} from '../../model/index.js'
import {
  builtinToolDefinitions,
  executeBuiltinTool,
} from '../../tools/index.js'
import type { BuiltinToolContext } from '../../tools/types.js'

type WebviewMessage = { type: 'ready' } | { type: 'sendMessage'; text: string }

interface PendingUserInput {
  resolve(value: string): void
}

export class AriaChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'aria.chatView'

  private readonly context: vscode.ExtensionContext
  private readonly messages: ChatCompletionMessageParam[] = []
  private pendingUserInput?: PendingUserInput
  private webviewView?: vscode.WebviewView

  constructor(context: vscode.ExtensionContext) {
    this.context = context
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
        await this.handleUserText(message.text)
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
      await this.postMessage({ type: 'loading', loading: true })
      await this.postMessage({ type: 'assistantMessageStart' })
      resolve(userText)
      return
    }

    await this.sendMessage(userText)
  }

  private async sendMessage(userText: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('aria.api')
    const providerValue = config.get<string>('provider')?.trim()

    let providerId: ModelProviderId

    try {
      providerId = parseModelProviderId(providerValue)
    } catch (error) {
      await this.postError(
        error instanceof Error
          ? error.message
          : 'Configure aria.api.provider before sending a message.',
      )
      return
    }

    const apiKey = getProviderApiKey(config, providerId)

    if (!apiKey) {
      await this.postError(
        `Configure aria.api.apiKeys.${providerId} before sending a message.`,
      )
      return
    }

    let reasoningEffort: ChatReasoningEffort

    try {
      reasoningEffort = parseReasoningEffort(
        config.get<string>('reasoningEffort')?.trim(),
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

    try {
      await this.postMessage({ type: 'assistantMessageStart' })

      const messages = await this.runAssistantTurn(
        {
          apiKey,
          providerId,
          reasoningEffort,
        },
        userText,
      )
      this.messages.splice(0, this.messages.length, ...messages)
    } catch (error) {
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

  private async runAssistantTurn(
    config: {
      apiKey: string
      providerId: ModelProviderId
      reasoningEffort: ChatReasoningEffort
    },
    userText: string,
  ): Promise<ChatCompletionMessageParam[]> {
    const toolContext = this.getToolContext()
    const tools = toolContext ? builtinToolDefinitions : []
    const systemMessage = await this.getSystemMessage()
    const systemPrompt =
      typeof systemMessage.content === 'string'
        ? systemMessage.content
        : JSON.stringify(systemMessage.content)
    const provider = modelProviders[config.providerId]
    const model = createProviderModel(
      config.providerId,
      config.apiKey,
      systemPrompt,
    )
    model.messages.push(...this.messages)

    for await (const delta of model.chat({
      model: provider.chatModel,
      input: userText,
      tools,
      reasoningEffort: config.reasoningEffort,
      executeTool: toolContext
        ? toolCall => this.executeToolCall(toolCall, toolContext)
        : undefined,
      maxToolRounds: tools.length > 0 ? 5 : undefined,
    })) {
      if (delta.type === 'content') {
        await this.postMessage({
          type: 'assistantMessageDelta',
          text: delta.text,
        })
        continue
      }

      if (delta.type === 'reasoning') {
        await this.postMessage({
          type: 'assistantReasoningDelta',
          text: delta.text,
        })
        continue
      }
    }

    return model.messages
  }

  private async executeToolCall(
    toolCall: ChatCompletionMessageToolCall,
    toolContext: BuiltinToolContext,
  ): Promise<string> {
    if (toolCall.type !== 'function') {
      return JSON.stringify({
        ok: false,
        error: `Unsupported tool call type: ${toolCall.type}`,
      })
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

  private getToolContext(): BuiltinToolContext | undefined {
    const workspaceFolder = this.getCurrentWorkspaceFolder()
    return workspaceFolder
      ? {
          cwd: workspaceFolder.uri.fsPath,
          askUser: (question, options) => this.askUser(question, options),
        }
      : undefined
  }

  private async askUser(question: string, options: string[]): Promise<string> {
    if (this.pendingUserInput) {
      throw new Error('Already waiting for user input.')
    }

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

function parseReasoningEffort(value: string | undefined): ChatReasoningEffort {
  switch (value) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value
    default:
      throw new Error(
        'Configure aria.api.reasoningEffort before sending a message.',
      )
  }
}

function getProviderApiKey(
  config: vscode.WorkspaceConfiguration,
  providerId: ModelProviderId,
): string {
  return config.get<string>(`apiKeys.${providerId}`)?.trim() ?? ''
}
