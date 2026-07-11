import * as vscode from 'vscode'
import { registerGenerateCommitMessageCommand } from './gitCommitMessage.js'

export function activate(context: vscode.ExtensionContext) {
  const generateCommitMessageCommand = registerGenerateCommitMessageCommand()

  context.subscriptions.push(generateCommitMessageCommand)
}
