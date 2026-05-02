import * as vscode from 'vscode'
import {
  buildFimContext,
  FimInlineCompletionProvider,
  getFimSettings,
} from './FimInlineCompletionProvider.js'
import { AriaChatViewProvider } from './webview/AriaChatViewProvider.js'

export function activate(context: vscode.ExtensionContext) {
  const chatViewProvider = new AriaChatViewProvider(context)

  const openSettingsCommand = vscode.commands.registerCommand(
    'aria.openSettings',
    async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'aria')
    },
  )
  const newThreadCommand = vscode.commands.registerCommand(
    'aria.newThread',
    async () => {
      await chatViewProvider.createNewThread()
    },
  )
  const showHistoryCommand = vscode.commands.registerCommand(
    'aria.showHistory',
    async () => {
      await chatViewProvider.showHistory()
    },
  )
  const deleteThreadCommand = vscode.commands.registerCommand(
    'aria.deleteThread',
    async () => {
      await chatViewProvider.deleteThread()
    },
  )

  const showSystemPromptCommand = vscode.commands.registerCommand(
    'aria.showSystemPrompt',
    async () => {
      await chatViewProvider.showSystemPrompt()
    },
  )
  const showFimContextCommand = vscode.commands.registerCommand(
    'aria.showFimContext',
    async () => {
      await showFimContext()
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
    newThreadCommand,
    showHistoryCommand,
    deleteThreadCommand,
    showSystemPromptCommand,
    showFimContextCommand,
    chatViewRegistration,
    fimInlineCompletionRegistration,
  )
}

export function deactivate() {}

async function showFimContext(): Promise<void> {
  const editor = vscode.window.activeTextEditor

  if (!editor) {
    await vscode.window.showWarningMessage(
      'Open a text editor before showing FIM context.',
    )
    return
  }

  const settings = getFimSettings()
  const position = editor.selection.active
  const context = await buildFimContext(
    editor.document,
    position,
    settings.useWorkspaceSymbols,
  )
  const document = await vscode.workspace.openTextDocument({
    content: JSON.stringify(
      {
        prompt: context.prefix,
        suffix: context.suffix || undefined,
        max_tokens: settings.maxTokens,
      },
      null,
      2,
    ),
    language: 'json',
  })

  await vscode.window.showTextDocument(document, { preview: false })
}
