import * as vscode from 'vscode'
import { AriaChatViewProvider } from './webview/AriaChatViewProvider.js'

const apiKeySecretKey = 'aria.apiKey'

export function activate(context: vscode.ExtensionContext) {
  const chatViewProvider = new AriaChatViewProvider(context, apiKeySecretKey)

  const helloWorldCommand = vscode.commands.registerCommand(
    'aria.helloWorld',
    () => {
      vscode.window.showInformationMessage('Hello from Aria.')
    },
  )

  const setApiKeyCommand = vscode.commands.registerCommand(
    'aria.setApiKey',
    async () => {
      const apiKey = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        password: true,
        placeHolder: 'Model API key',
        prompt: 'Enter the API key Aria should use for model requests.',
        title: 'Set Aria API Key',
      })

      if (!apiKey) {
        return
      }

      await context.secrets.store(apiKeySecretKey, apiKey)
      chatViewProvider.refreshStatus()
      vscode.window.showInformationMessage('Aria API key saved.')
    },
  )

  const clearApiKeyCommand = vscode.commands.registerCommand(
    'aria.clearApiKey',
    async () => {
      await context.secrets.delete(apiKeySecretKey)
      chatViewProvider.refreshStatus()
      vscode.window.showInformationMessage('Aria API key cleared.')
    },
  )

  const chatViewRegistration = vscode.window.registerWebviewViewProvider(
    AriaChatViewProvider.viewType,
    chatViewProvider,
    {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    },
  )

  context.subscriptions.push(
    helloWorldCommand,
    setApiKeyCommand,
    clearApiKeyCommand,
    chatViewRegistration,
  )
}

export function deactivate() {}
