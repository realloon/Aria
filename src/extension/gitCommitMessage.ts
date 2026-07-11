import * as vscode from 'vscode'
import { basename } from 'node:path'
import { relative, sep } from 'node:path'
import { createModelClient, deepseek } from '../model/providers.js'
import type { ReasoningEffort } from '../model/providers.js'

const maxDiffCharacters = 60_000
const maxUntrackedFiles = 10
const maxUntrackedFileCharacters = 4_000

interface GitInputBox {
  value: string
}

interface GitChange {
  readonly uri: vscode.Uri
}

interface GitRepositoryState {
  readonly indexChanges: GitChange[]
  readonly workingTreeChanges: GitChange[]
  readonly untrackedChanges: GitChange[]
}

interface GitRepositoryUiState {
  readonly selected: boolean
}

interface GitRepository {
  readonly rootUri: vscode.Uri
  readonly inputBox: GitInputBox
  readonly state: GitRepositoryState
  readonly ui: GitRepositoryUiState
  diffWithHEAD(): Promise<GitChange[]>
  diffWithHEAD(path: string): Promise<string>
  diffIndexWithHEAD(): Promise<GitChange[]>
  diffIndexWithHEAD(path: string): Promise<string>
}

interface GitApi {
  readonly repositories: GitRepository[]
  getRepository(uri: vscode.Uri): GitRepository | null
}

interface GitExtension {
  readonly enabled: boolean
  getAPI(version: 1): GitApi
}

interface CommitModelSettings {
  apiKey: string
  model: string
  reasoningEffort: ReasoningEffort
}

interface ChangeContext {
  diff: string
  mode: 'staged' | 'working tree'
}

export function registerGenerateCommitMessageCommand() {
  return vscode.commands.registerCommand('aria.generateCommitMessage', () =>
    handleGenerateCommitMessage(),
  )
}

async function handleGenerateCommitMessage() {
  try {
    await generateCommitMessage()
  } catch (error) {
    await vscode.window.showErrorMessage(
      error instanceof Error
        ? error.message
        : 'Failed to generate commit message.',
    )
  }
}

async function generateCommitMessage() {
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

      const settings = getCommitModelSettings()
      const commitMessage = await requestCommitMessage(settings, changeContext)

      repository.inputBox.value = commitMessage
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

async function getCurrentRepository() {
  const api = await getGitApi()

  if (api.repositories.length === 0) {
    throw new Error('No Git repository is open.')
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri
  const activeRepository = activeUri ? api.getRepository(activeUri) : undefined

  if (activeRepository) {
    return activeRepository
  }

  const selectedRepositories = api.repositories.filter(
    repository => repository.ui.selected,
  )

  if (selectedRepositories.length === 1) {
    return selectedRepositories[0]!
  }

  if (api.repositories.length === 1) {
    return api.repositories[0]!
  }

  const selected = await vscode.window.showQuickPick(
    api.repositories.map(repository => ({
      label: basename(repository.rootUri.fsPath),
      description: repository.rootUri.fsPath,
      repository,
    })),
    {
      placeHolder: 'Select repository for commit message generation',
    },
  )

  if (!selected) {
    throw new Error('No Git repository selected.')
  }

  return selected.repository
}

async function getGitApi() {
  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git')

  if (!extension) {
    throw new Error('VS Code Git extension is not available.')
  }

  const gitExtension = extension.isActive
    ? extension.exports
    : await extension.activate()

  if (!gitExtension.enabled) {
    throw new Error('VS Code Git extension is disabled.')
  }

  return gitExtension.getAPI(1)
}

async function buildChangeContext(
  repository: GitRepository,
): Promise<ChangeContext> {
  if (repository.state.indexChanges.length > 0) {
    return {
      diff: truncateDiff(
        await buildDiffForChanges(repository, repository.state.indexChanges, {
          staged: true,
        }),
      ),
      mode: 'staged',
    }
  }

  const trackedDiff = await buildDiffForChanges(
    repository,
    repository.state.workingTreeChanges,
    {
      staged: false,
    },
  )
  const untrackedSummary = await buildUntrackedSummary(repository)
  const sections = [trackedDiff, untrackedSummary].filter(section =>
    section.trim(),
  )

  return {
    diff: truncateDiff(sections.join('\n\n')),
    mode: 'working tree',
  }
}

async function buildDiffForChanges(
  repository: GitRepository,
  changes: GitChange[],
  options: { staged: boolean },
) {
  const diffs: string[] = []
  const seenPaths = new Set<string>()

  for (const change of changes) {
    const relativePath = toRepositoryPath(repository, change.uri)

    if (seenPaths.has(relativePath)) {
      continue
    }

    seenPaths.add(relativePath)
    diffs.push(
      options.staged
        ? await repository.diffIndexWithHEAD(relativePath)
        : await repository.diffWithHEAD(relativePath),
    )
  }

  return diffs.join('\n\n')
}

async function buildUntrackedSummary(repository: GitRepository) {
  const changes = repository.state.untrackedChanges.slice(0, maxUntrackedFiles)

  if (changes.length === 0) {
    return ''
  }

  const summaries: string[] = []

  for (const change of changes) {
    const relativePath = toRepositoryPath(repository, change.uri)
    const stat = await vscode.workspace.fs.stat(change.uri)

    if (stat.type === vscode.FileType.Directory) {
      summaries.push(`Untracked directory: ${relativePath}`)
      continue
    }

    const bytes = await vscode.workspace.fs.readFile(change.uri)

    if (isBinary(bytes)) {
      summaries.push(`Untracked binary file: ${relativePath}`)
      continue
    }

    const content = new TextDecoder('utf-8')
      .decode(bytes)
      .slice(0, maxUntrackedFileCharacters)

    summaries.push(`Untracked file: ${relativePath}\n${content}`)
  }

  const remaining = repository.state.untrackedChanges.length - changes.length

  if (remaining > 0) {
    summaries.push(`${remaining} more untracked file(s) omitted.`)
  }

  return summaries.join('\n\n')
}

async function requestCommitMessage(
  settings: CommitModelSettings,
  changeContext: ChangeContext,
) {
  const client = createModelClient(settings.apiKey)
  const response = await client.chat.completions.create({
    model: settings.model,
    messages: [
      { role: 'system', content: buildCommitSystemPrompt() },
      {
        role: 'user',
        content: `Generate a commit message for these ${changeContext.mode} changes:\n\n${changeContext.diff}`,
      },
    ],
    reasoning_effort: settings.reasoningEffort,
  })
  const commitMessage = normalizeCommitMessage(
    response.choices[0]?.message.content ?? '',
  )

  if (!commitMessage) {
    throw new Error('Model returned an empty commit message.')
  }

  return commitMessage
}

function getCommitModelSettings(): CommitModelSettings {
  const config = vscode.workspace.getConfiguration('aria.api')
  const apiKey = config.get<string>('apiKey')?.trim() ?? ''

  if (!apiKey) {
    throw new Error('Configure aria.api.apiKey.')
  }

  return {
    apiKey,
    model: deepseek.commitMessageModel,
    reasoningEffort: parseReasoningEffort(
      config.get<string>('reasoningEffort')?.trim(),
    ),
  } as CommitModelSettings
}

function parseReasoningEffort(value: string | undefined): ReasoningEffort {
  switch (value) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value
    default:
      throw new Error('Configure aria.api.reasoningEffort.')
  }
}

// todo: extract
function buildCommitSystemPrompt() {
  return `You generate Git commit messages.

Rules:
- Output exactly one commit message and nothing else.
- Use the format "type: message".
- Keep it concise.
- Use the most specific type from feat, fix, refactor, docs, test, style, build, ci, perf, chore.
- Prefer English unless the code changes are explicitly Chinese-language user-facing text.
- Do not mention files unless the filename is the product-visible concept.`
}

function normalizeCommitMessage(value: string) {
  return (
    value
      .trim()
      .replace(/^```(?:\w+)?\s*/, '')
      .replace(/\s*```$/, '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)[0]
      ?.replace(/^["']|["']$/g, '')
      .trim()
      .slice(0, 200) ?? ''
  )
}

function truncateDiff(diff: string) {
  if (diff.length <= maxDiffCharacters) {
    return diff
  }

  return `${diff.slice(0, maxDiffCharacters)}\n\n[Diff truncated.]`
}

function toRepositoryPath(repository: GitRepository, uri: vscode.Uri) {
  return relative(repository.rootUri.fsPath, uri.fsPath).split(sep).join('/')
}

function isBinary(bytes: Uint8Array) {
  return bytes.slice(0, 8_000).some(byte => byte === 0)
}
