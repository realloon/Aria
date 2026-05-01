import * as vscode from 'vscode'
import { AriaChatViewProvider } from './webview/AriaChatViewProvider.js'

export function activate(context: vscode.ExtensionContext) {
  const chatViewProvider = new AriaChatViewProvider(context)

  const helloWorldCommand = vscode.commands.registerCommand(
    'aria.helloWorld',
    () => {
      vscode.window.showInformationMessage('Hello from Aria.')
    },
  )

  const openSettingsCommand = vscode.commands.registerCommand(
    'aria.openSettings',
    async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'aria')
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
    openSettingsCommand,
    chatViewRegistration,
  )
}

export function deactivate() {}
