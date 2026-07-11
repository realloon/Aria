import * as vscode from 'vscode'
import { requestCommitMessage } from './deepseek.js'
import { buildChangeContext, getCurrentRepository } from './gitRepository.js'

export async function generateCommitMessage() {
  try {
    await runGenerateCommitMessage()
  } catch (error) {
    await vscode.window.showErrorMessage(
      error instanceof Error
        ? error.message
        : 'Failed to generate commit message.',
    )
  }
}

async function runGenerateCommitMessage() {
  const generatedMode = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Aria: generating commit message',
      cancellable: false,
    },
    async () => {
      const repository = await getCurrentRepository()
      const changeContext = await buildChangeContext(repository)

      if (!changeContext.diff.trim()) {
        await vscode.window.showWarningMessage(
          'No Git changes found for commit message generation.',
        )
        return undefined
      }

      repository.inputBox.value = await requestCommitMessage(
        getCommitApiKey(),
        changeContext,
      )
      await vscode.commands.executeCommand('workbench.view.scm')
      return changeContext.mode
    },
  )

  if (generatedMode) {
    void vscode.window.showInformationMessage(
      `Generated commit message from ${generatedMode} changes.`,
    )
  }
}

function getCommitApiKey() {
  const apiKey = vscode.workspace
    .getConfiguration('aria.api')
    .get<string>('apiKey')
    ?.trim()

  if (!apiKey) {
    throw new Error('Configure aria.api.apiKey.')
  }

  return apiKey
}
