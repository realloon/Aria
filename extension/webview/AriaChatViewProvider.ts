import * as vscode from 'vscode'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { streamChat } from '../model/ModelApiClient.js'

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'sendMessage'; text: string }

export class AriaChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'aria.chatView'

  private readonly messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        'You are Aria, a concise programming agent inside VS Code. Help with code, explain tradeoffs, and ask for missing context only when necessary.',
    },
  ]
  private webviewView?: vscode.WebviewView

  constructor(private readonly context: vscode.ExtensionContext) {}

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

    this.messages.push({ role: 'user', content: userText })
    await this.postMessage({ type: 'loading', loading: true })

    try {
      let responseText = ''

      await this.postMessage({ type: 'assistantMessageStart' })

      for await (const delta of streamChat({ apiKey, baseUrl, model }, this.messages)) {
        if (delta.type === 'content') {
          responseText += delta.text
        }

        await this.postMessage({
          type:
            delta.type === 'reasoning'
              ? 'assistantReasoningDelta'
              : 'assistantMessageDelta',
          text: delta.text,
        })
      }

      this.messages.push({ role: 'assistant', content: responseText })
    } catch (error) {
      this.messages.pop()
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

  private async postMessage(message: unknown): Promise<void> {
    await this.webviewView?.webview.postMessage(message)
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
