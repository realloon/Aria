import * as vscode from 'vscode'
import { basename } from 'node:path'
import { relative, sep } from 'node:path'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { parseModelProviderId, runModelChat } from '../model/index.js'
import type { ChatReasoningEffort, ModelProviderId } from '../types/model.js'
import {
  getProviderApiKey,
  getProviderBaseURL,
  getSelectedChatModel,
  parseReasoningEffort,
} from '../utils/modelSettings.js'

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

interface ChatModelSettings {
  apiKey: string
  baseURL?: string
  model: string
  providerId: ModelProviderId
  reasoningEffort: ChatReasoningEffort
}

interface ChangeContext {
  diff: string
  mode: 'staged' | 'working tree'
}

export function registerGenerateCommitMessageCommand(
  context: vscode.ExtensionContext,
) {
  return vscode.commands.registerCommand('aria.generateCommitMessage', () =>
    handleGenerateCommitMessage(context),
  )
}

async function handleGenerateCommitMessage(context: vscode.ExtensionContext) {
  try {
    await generateCommitMessage(context)
  } catch (error) {
    await vscode.window.showErrorMessage(
      error instanceof Error
        ? error.message
        : 'Failed to generate commit message.',
    )
  }
}

async function generateCommitMessage(context: vscode.ExtensionContext) {
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

      const settings = getChatModelSettings(context)
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
  settings: ChatModelSettings,
  changeContext: ChangeContext,
) {
  const messages = await runModelChat({
    providerId: settings.providerId,
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    model: settings.model,
    reasoningEffort: settings.reasoningEffort,
    messages: [],
    systemPrompt: buildCommitSystemPrompt(),
    userText: `Generate a commit message for these ${changeContext.mode} changes:\n\n${changeContext.diff}`,
  })
  const content = getLastAssistantText(messages)
  const commitMessage = normalizeCommitMessage(content)

  if (!commitMessage) {
    throw new Error('Model returned an empty commit message.')
  }

  return commitMessage
}

function getChatModelSettings(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('aria.api')
  const providerId = parseModelProviderId(
    config.get<string>('provider')?.trim(),
  )
  const apiKey = getProviderApiKey(config, providerId)

  if (!apiKey) {
    throw new Error(`Configure aria.api.apiKeys.${providerId}.`)
  }

  const baseURL = getProviderBaseURL(config, providerId)

  if (providerId === 'openai-compatible' && !baseURL) {
    throw new Error('Configure aria.api.baseURLs.openai-compatible.')
  }

  return {
    providerId,
    apiKey,
    baseURL,
    model: getSelectedChatModel(context, providerId),
    reasoningEffort: parseReasoningEffort(
      config.get<string>('reasoningEffort')?.trim(),
    ),
  } as ChatModelSettings
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

function getLastAssistantText(messages: ChatCompletionMessageParam[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]

    if (message?.role !== 'assistant') {
      continue
    }

    const content = message.content

    if (typeof content === 'string') {
      return content
    }

    if (Array.isArray(content)) {
      return content
        .map(item =>
          'text' in item && typeof item.text === 'string' ? item.text : '',
        )
        .join('')
    }
  }

  return ''
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
