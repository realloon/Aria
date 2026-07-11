import * as vscode from 'vscode'
import { basename, relative, sep } from 'node:path'

const maxDiffCharacters = 60_000
const maxUntrackedFiles = 10
const maxUntrackedFileCharacters = 4_000

interface GitChange {
  readonly uri: vscode.Uri
}

export interface GitRepository {
  readonly rootUri: vscode.Uri
  readonly inputBox: { value: string }
  readonly state: {
    indexChanges: GitChange[]
    workingTreeChanges: GitChange[]
    untrackedChanges: GitChange[]
  }
  readonly ui: { selected: boolean }
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

export interface ChangeContext {
  diff: string
  mode: 'staged' | 'working tree'
}

export async function getCurrentRepository() {
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
    { placeHolder: 'Select repository for commit message generation' },
  )

  if (!selected) {
    throw new Error('No Git repository selected.')
  }

  return selected.repository
}

export async function buildChangeContext(
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
    { staged: false },
  )
  const untrackedSummary = await buildUntrackedSummary(repository)

  return {
    diff: truncateDiff(
      [trackedDiff, untrackedSummary]
        .filter(section => section.trim())
        .join('\n\n'),
    ),
    mode: 'working tree',
  }
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

    if (bytes.slice(0, 8_000).some(byte => byte === 0)) {
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

function truncateDiff(diff: string) {
  return diff.length <= maxDiffCharacters
    ? diff
    : `${diff.slice(0, maxDiffCharacters)}\n\n[Diff truncated.]`
}

function toRepositoryPath(repository: GitRepository, uri: vscode.Uri) {
  return relative(repository.rootUri.fsPath, uri.fsPath).split(sep).join('/')
}
