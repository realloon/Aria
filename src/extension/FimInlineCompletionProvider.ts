import * as vscode from 'vscode'
import {
  completeFim,
  modelProviders,
  parseModelProviderId,
} from '../model/index.js'
import type { ModelProvider, ModelProviderId } from '../types/model.js'
import { getProviderApiKey } from '../utils/modelSettings.js'

const maxPrefixLength = 16_000
const maxSuffixLength = 8_000
const maxSymbolContextLength = 6_000
const maxDocumentSymbols = 12
const maxWorkspaceSymbols = 12
const maxRelatedStructures = 4
const maxRelatedSnippetLength = 1_200
const lspCommandTimeoutMs = 700

export interface FimContext {
  prefix: string
  suffix: string
}

export interface FimSettings {
  enabled: boolean
  maxTokens: number
  useWorkspaceSymbols: boolean
}

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

    const { prefix, suffix } = await buildFimContext(
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
      const completion = await completeFim({
        providerId: config.providerId,
        apiKey: config.apiKey,
        model: config.fimModel,
        prefix,
        suffix: suffix || undefined,
        maxTokens: config.maxTokens,
        signal: abortController.signal,
      })

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
        providerId: ModelProviderId
        fimModel: string
        maxTokens: number
        useWorkspaceSymbols: boolean
      }
    | undefined {
    const apiConfig = vscode.workspace.getConfiguration('aria.api')
    const settings = getFimSettings()

    if (!settings.enabled) {
      return undefined
    }

    let providerId: ModelProviderId

    try {
      providerId = parseModelProviderId(
        apiConfig.get<string>('provider')?.trim(),
      )
    } catch {
      return undefined
    }

    const apiKey = getProviderApiKey(apiConfig, providerId)
    const provider: ModelProvider = modelProviders[providerId]
    const fimModel = provider.fimModel

    if (!apiKey || !fimModel) {
      return undefined
    }

    return {
      apiKey,
      providerId,
      fimModel,
      maxTokens: settings.maxTokens,
      useWorkspaceSymbols: settings.useWorkspaceSymbols,
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

    const linePrefix = document
      .lineAt(position)
      .text.slice(0, position.character)

    if (!linePrefix.trim()) {
      return (
        position.line > 0 &&
        document.lineAt(position.line - 1).text.trim() !== ''
      )
    }

    return /[\w.)\]}>"'`]$/.test(linePrefix)
  }
}

export function getFimSettings(): FimSettings {
  const fimConfig = vscode.workspace.getConfiguration('aria.fim')

  return {
    enabled: fimConfig.get<boolean>('enabled') === true,
    maxTokens: clampMaxTokens(fimConfig.get<number>('maxTokens')),
    useWorkspaceSymbols: fimConfig.get<boolean>('useWorkspaceSymbols') === true,
  }
}

export async function buildFimContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  useWorkspaceSymbols: boolean,
): Promise<FimContext> {
  const documentSymbols = await getFlatDocumentSymbols(document)
  const currentStructure = getCurrentStructure(documentSymbols, position)
  const localContext = buildLocalFimWindow(document, position, currentStructure)
  const symbolContext = await getSymbolContext(
    document,
    position,
    useWorkspaceSymbols,
    documentSymbols,
    currentStructure,
  )
  const prefix = symbolContext
    ? `${symbolContext}${localContext.prefix}`
    : localContext.prefix

  return { prefix, suffix: localContext.suffix }
}

async function getSymbolContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  useWorkspaceSymbols: boolean,
  documentSymbols: FlatSymbol[],
  currentStructure: FlatSymbol | undefined,
): Promise<string> {
  const commentStyle = getCommentStyle(document.languageId)

  if (!commentStyle) {
    return ''
  }

  const [documentSymbolSummaries, relatedStructures, workspaceSymbols] =
    await Promise.all([
      getDocumentSymbolSummaries(document, position, documentSymbols),
      currentStructure
        ? getRelatedStructureSummaries(document, currentStructure)
        : Promise.resolve([]),
      useWorkspaceSymbols
        ? getWorkspaceSymbolSummaries(document, position)
        : Promise.resolve([]),
    ])
  const currentFilePath = vscode.workspace.asRelativePath(document.uri, false)
  const lines = [
    ...formatSymbolSection(
      `${currentFilePath}(current)`,
      documentSymbolSummaries,
    ),
    ...formatRelatedStructureSection(relatedStructures),
    ...formatSymbolSection('Workspace matches', workspaceSymbols),
  ]

  if (lines.length === 0) {
    return ''
  }

  return `${toCommentBlock(['Relevant symbols:', ...lines], commentStyle)}\n`
}

function buildLocalFimWindow(
  document: vscode.TextDocument,
  position: vscode.Position,
  currentStructure: FlatSymbol | undefined,
): FimContext {
  const documentStart = new vscode.Position(0, 0)
  const documentEnd = getDocumentEnd(document)

  if (!currentStructure) {
    return {
      prefix: tail(
        document.getText(new vscode.Range(documentStart, position)),
        maxPrefixLength,
      ),
      suffix: head(
        document.getText(new vscode.Range(position, documentEnd)),
        maxSuffixLength,
      ),
    }
  }

  const prefixBeforeCursor = document.getText(
    new vscode.Range(documentStart, position),
  )
  const suffixAfterCursor = document.getText(
    new vscode.Range(position, documentEnd),
  )
  const structurePrefix = document.getText(
    new vscode.Range(currentStructure.range.start, position),
  )
  const structureSuffix = document.getText(
    new vscode.Range(position, currentStructure.range.end),
  )

  return {
    prefix:
      prefixBeforeCursor.length <= maxPrefixLength
        ? prefixBeforeCursor
        : buildWindowAroundStructurePrefix(
            document,
            currentStructure,
            structurePrefix,
          ),
    suffix:
      suffixAfterCursor.length <= maxSuffixLength
        ? suffixAfterCursor
        : buildWindowAroundStructureSuffix(
            document,
            currentStructure,
            structureSuffix,
          ),
  }
}

function buildWindowAroundStructurePrefix(
  document: vscode.TextDocument,
  currentStructure: FlatSymbol,
  structurePrefix: string,
): string {
  if (structurePrefix.length >= maxPrefixLength) {
    return tail(structurePrefix, maxPrefixLength)
  }

  const leadingContext = document.getText(
    new vscode.Range(new vscode.Position(0, 0), currentStructure.range.start),
  )

  return `${tail(
    leadingContext,
    maxPrefixLength - structurePrefix.length,
  )}${structurePrefix}`
}

function buildWindowAroundStructureSuffix(
  document: vscode.TextDocument,
  currentStructure: FlatSymbol,
  structureSuffix: string,
): string {
  if (structureSuffix.length >= maxSuffixLength) {
    return head(structureSuffix, maxSuffixLength)
  }

  const trailingContext = document.getText(
    new vscode.Range(currentStructure.range.end, getDocumentEnd(document)),
  )

  return `${structureSuffix}${head(
    trailingContext,
    maxSuffixLength - structureSuffix.length,
  )}`
}

async function getFlatDocumentSymbols(
  document: vscode.TextDocument,
): Promise<FlatSymbol[]> {
  const symbols = await withTimeout(
    vscode.commands.executeCommand<
      Array<vscode.DocumentSymbol | vscode.SymbolInformation> | undefined
    >('vscode.executeDocumentSymbolProvider', document.uri),
    lspCommandTimeoutMs,
  )

  return symbols?.length ? flattenSymbols(symbols) : []
}

function getCurrentStructure(
  symbols: FlatSymbol[],
  position: vscode.Position,
): FlatSymbol | undefined {
  return symbols
    .filter(
      symbol => isStructureKind(symbol.kind) && symbol.range.contains(position),
    )
    .sort((left, right) => rangeSize(left.range) - rangeSize(right.range))[0]
}

async function getDocumentSymbolSummaries(
  document: vscode.TextDocument,
  position: vscode.Position,
  flattened: FlatSymbol[],
): Promise<SymbolSummary[]> {
  if (!flattened.length) {
    return []
  }

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

async function getRelatedStructureSummaries(
  document: vscode.TextDocument,
  currentStructure: FlatSymbol,
): Promise<RelatedStructureSummary[]> {
  const position = currentStructure.selectionRange.start
  const [implementations, definitions, typeDefinitions, references] =
    await Promise.all([
      getLspLocations(
        'vscode.executeImplementationProvider',
        document,
        position,
      ),
      getLspLocations('vscode.executeDefinitionProvider', document, position),
      getLspLocations(
        'vscode.executeTypeDefinitionProvider',
        document,
        position,
      ),
      getReferenceLocations(document, position),
    ])
  const candidates = [
    ...implementations.map(location => ({
      relation: 'Implementation',
      location,
    })),
    ...definitions.map(location => ({ relation: 'Definition', location })),
    ...typeDefinitions.map(location => ({
      relation: 'Type definition',
      location,
    })),
    ...references.map(location => ({ relation: 'Reference', location })),
  ]
  const summaries = await Promise.all(
    uniqueRelatedLocations(candidates, document.uri, currentStructure.range)
      .slice(0, maxRelatedStructures * 2)
      .map(candidate =>
        toRelatedStructureSummary(candidate.relation, candidate.location),
      ),
  )

  return summaries
    .filter(summary => summary !== undefined)
    .slice(0, maxRelatedStructures)
}

async function getLspLocations(
  command: string,
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<vscode.Location[]> {
  const result = await withTimeout(
    vscode.commands.executeCommand<
      Array<vscode.Location | vscode.LocationLink>
    >(command, document.uri, position),
    lspCommandTimeoutMs,
  )

  return (result ?? []).map(toLocation)
}

async function getReferenceLocations(
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<vscode.Location[]> {
  const result = await withTimeout(
    vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      document.uri,
      position,
      { includeDeclaration: false },
    ),
    lspCommandTimeoutMs,
  )

  return result ?? []
}

async function toRelatedStructureSummary(
  relation: string,
  location: vscode.Location,
): Promise<RelatedStructureSummary | undefined> {
  try {
    const document = await vscode.workspace.openTextDocument(location.uri)
    const symbols = await getFlatDocumentSymbols(document)
    const structure =
      getCurrentStructure(symbols, location.range.start) ??
      symbols
        .filter(symbol => symbol.range.contains(location.range.start))
        .sort(
          (left, right) => rangeSize(left.range) - rangeSize(right.range),
        )[0]

    if (!structure) {
      return undefined
    }

    return {
      ...toSymbolSummary(structure, document.uri),
      relation,
      code: compactSnippet(document.getText(structure.range)),
    }
  } catch {
    return undefined
  }
}

async function getWorkspaceSymbolSummaries(
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<SymbolSummary[]> {
  const query = getWorkspaceSymbolQuery(document, position)

  if (!query) {
    return []
  }

  const symbols = await withTimeout(
    vscode.commands.executeCommand<vscode.SymbolInformation[] | undefined>(
      'vscode.executeWorkspaceSymbolProvider',
      query,
    ),
    lspCommandTimeoutMs,
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
  selectionRange: vscode.Range
  uri?: vscode.Uri
}

interface SymbolSummary {
  name: string
  kind: vscode.SymbolKind
  containerName?: string
  uri: vscode.Uri
  line: number
}

interface RelatedLocationCandidate {
  relation: string
  location: vscode.Location
}

interface RelatedStructureSummary extends SymbolSummary {
  relation: string
  code: string
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
        selectionRange: symbol.selectionRange,
      })
      flattened.push(...flattenSymbols(symbol.children, symbol.name))
      continue
    }

    flattened.push({
      name: symbol.name,
      kind: symbol.kind,
      containerName: symbol.containerName,
      range: symbol.location.range,
      selectionRange: symbol.location.range,
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

function isStructureKind(kind: vscode.SymbolKind): boolean {
  return [
    vscode.SymbolKind.Class,
    vscode.SymbolKind.Constructor,
    vscode.SymbolKind.Enum,
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Interface,
    vscode.SymbolKind.Method,
    vscode.SymbolKind.Module,
    vscode.SymbolKind.Namespace,
    vscode.SymbolKind.Struct,
  ].includes(kind)
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

function uniqueRelatedLocations(
  candidates: RelatedLocationCandidate[],
  currentUri: vscode.Uri,
  currentRange: vscode.Range,
): RelatedLocationCandidate[] {
  const seen = new Set<string>()
  const unique: RelatedLocationCandidate[] = []

  for (const candidate of candidates) {
    const uri = candidate.location.uri.toString()
    const range = candidate.location.range

    if (uri === currentUri.toString() && currentRange.contains(range.start)) {
      continue
    }

    const key = `${uri}:${range.start.line}:${range.start.character}`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    unique.push(candidate)
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

    if (
      seen.has(key) ||
      symbol.location.uri.toString() === currentUri.toString()
    ) {
      continue
    }

    seen.add(key)
    unique.push(symbol)
  }

  return unique
}

function toSymbolSummary(
  symbol: FlatSymbol,
  fallbackUri: vscode.Uri,
): SymbolSummary {
  return {
    name: symbol.name,
    kind: symbol.kind,
    containerName: symbol.containerName,
    uri: symbol.uri ?? fallbackUri,
    line: symbol.range.start.line + 1,
  }
}

function toWorkspaceSymbolSummary(
  symbol: vscode.SymbolInformation,
): SymbolSummary {
  return {
    name: symbol.name,
    kind: symbol.kind,
    containerName: symbol.containerName,
    uri: symbol.location.uri,
    line: symbol.location.range.start.line + 1,
  }
}

function toLocation(
  location: vscode.Location | vscode.LocationLink,
): vscode.Location {
  if ('uri' in location) {
    return location
  }

  return new vscode.Location(
    location.targetUri,
    location.targetSelectionRange ?? location.targetRange,
  )
}

async function withTimeout<T>(
  promise: Thenable<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>(resolve =>
        setTimeout(() => resolve(undefined), timeoutMs),
      ),
    ])
  } catch {
    return undefined
  }
}

function compactSnippet(code: string): string {
  return head(code.trim(), maxRelatedSnippetLength)
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
      const container = symbol.containerName
        ? ` in ${symbol.containerName}`
        : ''
      const path = vscode.workspace.asRelativePath(symbol.uri, false)

      return `- ${symbolKindName(symbol.kind)} ${symbol.name}${container} (${path}:${symbol.line})`
    }),
  ]
}

function formatRelatedStructureSection(
  summaries: RelatedStructureSummary[],
): string[] {
  if (summaries.length === 0) {
    return []
  }

  return [
    'Related structures',
    ...summaries.flatMap(summary => {
      const path = vscode.workspace.asRelativePath(summary.uri, false)
      const header = `- ${summary.relation}: ${symbolKindName(summary.kind)} ${summary.name} (${path}:${summary.line})`
      const codeLines = summary.code.split('\n').map(line => `  ${line}`)

      return [header, ...codeLines]
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
  return value.length > maxLength
    ? value.slice(value.length - maxLength)
    : value
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

function clampMaxTokens(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error('Configure aria.fim.maxTokens before using FIM.')
  }

  return Math.min(Math.max(Math.trunc(value), 1), 4096)
}
