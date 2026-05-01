import * as vscode from 'vscode'
import { AriaChatViewProvider } from './webview/AriaChatViewProvider.js'

export function activate(context: vscode.ExtensionContext) {
  const chatViewProvider = new AriaChatViewProvider(context)

  const openSettingsCommand = vscode.commands.registerCommand(
    'aria.openSettings',
    async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'aria')
    },
  )

  const showSystemPromptCommand = vscode.commands.registerCommand(
    'aria.showSystemPrompt',
    async () => {
      await chatViewProvider.showSystemPrompt()
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
    openSettingsCommand,
    showSystemPromptCommand,
    chatViewRegistration,
  )
}

export function deactivate() {}
