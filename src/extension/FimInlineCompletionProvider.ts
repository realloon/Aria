import * as vscode from 'vscode'
import { completeFim } from '../model/ModelApiClient.js'

const maxPrefixLength = 16_000
const maxSuffixLength = 8_000
const maxSymbolContextLength = 2_000
const maxDocumentSymbols = 12
const maxWorkspaceSymbols = 12

export class FimInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (context.selectedCompletionInfo || token.isCancellationRequested) {
      return undefined
    }

    const config = this.getConfig()

    if (!config || !this.shouldRequestCompletion(document, position, context)) {
      return undefined
    }

    const { prefix, suffix } = await getFimContext(
      document,
      position,
      config.useWorkspaceSymbols,
    )

    if (!prefix && !suffix) {
      return undefined
    }

    const abortController = new AbortController()
    const cancellation = token.onCancellationRequested(() => {
      abortController.abort()
    })

    try {
      const completion = await completeFim(
        {
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.model,
        },
        {
          prefix,
          suffix: suffix || undefined,
          maxTokens: config.maxTokens,
        },
        { signal: abortController.signal },
      )

      if (token.isCancellationRequested || !completion.trim()) {
        return undefined
      }

      return [
        new vscode.InlineCompletionItem(
          normalizeEol(completion, document.eol),
          new vscode.Range(position, position),
        ),
      ]
    } catch (error) {
      if (abortController.signal.aborted) {
        return undefined
      }

      console.error('Aria FIM completion failed.', error)
      return undefined
    } finally {
      cancellation.dispose()
    }
  }

  private getConfig():
    | {
        apiKey: string
        baseUrl: string
        model: string
        maxTokens: number
        useWorkspaceSymbols: boolean
      }
    | undefined {
    const apiConfig = vscode.workspace.getConfiguration('aria.api')
    const fimConfig = vscode.workspace.getConfiguration('aria.fim')

    if (fimConfig.get<boolean>('enabled') === false) {
      return undefined
    }

    const apiKey = apiConfig.get<string>('apiKey')?.trim() ?? ''
    const model =
      fimConfig.get<string>('model')?.trim() ||
      apiConfig.get<string>('model')?.trim() ||
      ''
    const configuredBaseUrl =
      fimConfig.get<string>('baseUrl')?.trim() ||
      apiConfig.get<string>('baseUrl')?.trim() ||
      ''
    const baseUrl = configuredBaseUrl.replace(/\/+$/, '')

    if (!apiKey || !model || !baseUrl) {
      return undefined
    }

    return {
      apiKey,
      baseUrl,
      model,
      maxTokens: clampMaxTokens(fimConfig.get<number>('maxTokens') ?? 128),
      useWorkspaceSymbols:
        fimConfig.get<boolean>('useWorkspaceSymbols') !== false,
    }
  }

  private shouldRequestCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
  ): boolean {
    if (document.isClosed || document.lineAt(position).text.length > 2_000) {
      return false
    }

    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke) {
      return true
    }

    const linePrefix = document.lineAt(position).text.slice(0, position.character)

    if (!linePrefix.trim()) {
      return (
        position.line > 0 && document.lineAt(position.line - 1).text.trim() !== ''
      )
    }

    return /[\w.)\]}>"'`]$/.test(linePrefix)
  }
}

async function getFimContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  useWorkspaceSymbols: boolean,
): Promise<{ prefix: string; suffix: string }> {
  const documentStart = new vscode.Position(0, 0)
  const documentEnd = getDocumentEnd(document)
  const rawPrefix = tail(
    document.getText(new vscode.Range(documentStart, position)),
    maxPrefixLength,
  )
  const symbolContext = await getSymbolContext(
    document,
    position,
    useWorkspaceSymbols,
  )
  const prefix = symbolContext
    ? `${symbolContext}${tail(
        rawPrefix,
        Math.max(maxPrefixLength - symbolContext.length, 1),
      )}`
    : rawPrefix
  const suffix = head(
    document.getText(new vscode.Range(position, documentEnd)),
    maxSuffixLength,
  )

  return { prefix, suffix }
}

async function getSymbolContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  useWorkspaceSymbols: boolean,
): Promise<string> {
  const commentStyle = getCommentStyle(document.languageId)

  if (!commentStyle) {
    return ''
  }

  const [documentSymbols, workspaceSymbols] = await Promise.all([
    getDocumentSymbolSummaries(document, position),
    useWorkspaceSymbols
      ? getWorkspaceSymbolSummaries(document, position)
      : Promise.resolve([]),
  ])
  const lines = [
    ...formatSymbolSection('Current file symbols', documentSymbols),
    ...formatSymbolSection('Workspace symbol matches', workspaceSymbols),
  ]

  if (lines.length === 0) {
    return ''
  }

  return `${toCommentBlock(
    ['Aria FIM context from VS Code symbols:', ...lines],
    commentStyle,
  )}\n`
}

async function getDocumentSymbolSummaries(
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<SymbolSummary[]> {
  const symbols =
    await vscode.commands.executeCommand<
      Array<vscode.DocumentSymbol | vscode.SymbolInformation> | undefined
    >('vscode.executeDocumentSymbolProvider', document.uri)

  if (!symbols?.length) {
    return []
  }

  const flattened = flattenSymbols(symbols)
  const containing = flattened
    .filter(symbol => symbol.range.contains(position))
    .sort((left, right) => rangeSize(left.range) - rangeSize(right.range))
  const topLevel = flattened.filter(
    symbol => symbol.range.start.character === 0 || symbol.containerName,
  )
  const selected = uniqueSymbols([...containing, ...topLevel]).slice(
    0,
    maxDocumentSymbols,
  )

  return selected.map(symbol => toSymbolSummary(symbol, document.uri))
}

async function getWorkspaceSymbolSummaries(
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<SymbolSummary[]> {
  const query = getWorkspaceSymbolQuery(document, position)

  if (!query) {
    return []
  }

  const symbols =
    await vscode.commands.executeCommand<vscode.SymbolInformation[] | undefined>(
      'vscode.executeWorkspaceSymbolProvider',
      query,
    )

  return uniqueWorkspaceSymbols(symbols ?? [], document.uri)
    .slice(0, maxWorkspaceSymbols)
    .map(toWorkspaceSymbolSummary)
}

interface FlatSymbol {
  name: string
  kind: vscode.SymbolKind
  containerName?: string
  range: vscode.Range
  uri?: vscode.Uri
}

interface SymbolSummary {
  name: string
  kind: vscode.SymbolKind
  containerName?: string
  uri: vscode.Uri
  line: number
}

function flattenSymbols(
  symbols: Array<vscode.DocumentSymbol | vscode.SymbolInformation>,
  containerName?: string,
): FlatSymbol[] {
  const flattened: FlatSymbol[] = []

  for (const symbol of symbols) {
    if (isDocumentSymbol(symbol)) {
      flattened.push({
        name: symbol.name,
        kind: symbol.kind,
        containerName,
        range: symbol.range,
      })
      flattened.push(...flattenSymbols(symbol.children, symbol.name))
      continue
    }

    flattened.push({
      name: symbol.name,
      kind: symbol.kind,
      containerName: symbol.containerName,
      range: symbol.location.range,
      uri: symbol.location.uri,
    })
  }

  return flattened
}

function isDocumentSymbol(
  symbol: vscode.DocumentSymbol | vscode.SymbolInformation,
): symbol is vscode.DocumentSymbol {
  return 'children' in symbol
}

function rangeSize(range: vscode.Range): number {
  return range.end.line - range.start.line
}

function uniqueSymbols(symbols: FlatSymbol[]): FlatSymbol[] {
  const seen = new Set<string>()
  const unique: FlatSymbol[] = []

  for (const symbol of symbols) {
    const key = `${symbol.name}:${symbol.kind}:${symbol.range.start.line}`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    unique.push(symbol)
  }

  return unique
}

function uniqueWorkspaceSymbols(
  symbols: vscode.SymbolInformation[],
  currentUri: vscode.Uri,
): vscode.SymbolInformation[] {
  const seen = new Set<string>()
  const unique: vscode.SymbolInformation[] = []

  for (const symbol of symbols) {
    const key = `${symbol.name}:${symbol.kind}:${symbol.location.uri.toString()}:${
      symbol.location.range.start.line
    }`

    if (seen.has(key) || symbol.location.uri.toString() === currentUri.toString()) {
      continue
    }

    seen.add(key)
    unique.push(symbol)
  }

  return unique
}

function toSymbolSummary(symbol: FlatSymbol, fallbackUri: vscode.Uri): SymbolSummary {
  return {
    name: symbol.name,
    kind: symbol.kind,
    containerName: symbol.containerName,
    uri: symbol.uri ?? fallbackUri,
    line: symbol.range.start.line + 1,
  }
}

function toWorkspaceSymbolSummary(symbol: vscode.SymbolInformation): SymbolSummary {
  return {
    name: symbol.name,
    kind: symbol.kind,
    containerName: symbol.containerName,
    uri: symbol.location.uri,
    line: symbol.location.range.start.line + 1,
  }
}

function getWorkspaceSymbolQuery(
  document: vscode.TextDocument,
  position: vscode.Position,
): string {
  const linePrefix = document.lineAt(position).text.slice(0, position.character)
  const identifiers = [...linePrefix.matchAll(/[A-Za-z_$][\w$]*/g)].map(
    match => match[0],
  )
  const query = identifiers.at(-1) ?? ''

  return query.length >= 2 ? query : ''
}

function formatSymbolSection(
  title: string,
  symbols: SymbolSummary[],
): string[] {
  if (symbols.length === 0) {
    return []
  }

  return [
    title,
    ...symbols.map(symbol => {
      const container = symbol.containerName ? ` in ${symbol.containerName}` : ''
      const path = vscode.workspace.asRelativePath(symbol.uri, false)

      return `- ${symbolKindName(symbol.kind)} ${symbol.name}${container} (${path}:${symbol.line})`
    }),
  ]
}

function symbolKindName(kind: vscode.SymbolKind): string {
  return vscode.SymbolKind[kind] ?? 'Symbol'
}

type CommentStyle =
  | { type: 'line'; prefix: string }
  | { type: 'block'; start: string; linePrefix: string; end: string }

function getCommentStyle(languageId: string): CommentStyle | undefined {
  if (
    [
      'bat',
      'dockerfile',
      'ignore',
      'ini',
      'makefile',
      'perl',
      'properties',
      'python',
      'r',
      'ruby',
      'shellscript',
      'toml',
      'yaml',
    ].includes(languageId)
  ) {
    return { type: 'line', prefix: '#' }
  }

  if (['html', 'markdown', 'xml'].includes(languageId)) {
    return { type: 'block', start: '<!--', linePrefix: ' ', end: '-->' }
  }

  if (['css', 'scss', 'less'].includes(languageId)) {
    return { type: 'block', start: '/*', linePrefix: ' * ', end: ' */' }
  }

  if (
    [
      'c',
      'cpp',
      'csharp',
      'dart',
      'go',
      'java',
      'javascript',
      'javascriptreact',
      'jsonc',
      'kotlin',
      'php',
      'rust',
      'scala',
      'swift',
      'typescript',
      'typescriptreact',
    ].includes(languageId)
  ) {
    return { type: 'line', prefix: '//' }
  }

  return undefined
}

function toCommentBlock(lines: string[], style: CommentStyle): string {
  const text = head(lines.join('\n'), maxSymbolContextLength)

  if (style.type === 'line') {
    return text
      .split('\n')
      .map(line => `${style.prefix} ${line}`.trimEnd())
      .join('\n')
  }

  return [
    style.start,
    ...text.split('\n').map(line => `${style.linePrefix}${line}`.trimEnd()),
    style.end,
  ].join('\n')
}

function getDocumentEnd(document: vscode.TextDocument): vscode.Position {
  const lastLine = document.lineAt(document.lineCount - 1)

  return new vscode.Position(lastLine.lineNumber, lastLine.text.length)
}

function tail(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(value.length - maxLength) : value
}

function head(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function normalizeEol(value: string, eol: vscode.EndOfLine): string {
  if (eol === vscode.EndOfLine.CRLF) {
    return value.replace(/\r?\n/g, '\r\n')
  }

  return value.replace(/\r\n/g, '\n')
}

function clampMaxTokens(value: number): number {
  if (!Number.isFinite(value)) {
    return 128
  }

  return Math.min(Math.max(Math.trunc(value), 1), 4096)
}
