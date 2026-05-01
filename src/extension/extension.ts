import * as vscode from 'vscode'
import { FimInlineCompletionProvider } from './FimInlineCompletionProvider.js'
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
  const fimInlineCompletionRegistration =
    vscode.languages.registerInlineCompletionItemProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }],
      new FimInlineCompletionProvider(),
    )

  context.subscriptions.push(
    openSettingsCommand,
    showSystemPromptCommand,
    chatViewRegistration,
    fimInlineCompletionRegistration,
  )
}

export function deactivate() {}
