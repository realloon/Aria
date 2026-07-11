import * as vscode from 'vscode'
import { generateCommitMessage } from './gitCommitMessage.js'

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'aria.generateCommitMessage',
      generateCommitMessage,
    ),
  )
}
