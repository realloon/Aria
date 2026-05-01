import * as vscode from 'vscode'
import { completeFim } from '../model/ModelApiClient.js'

const maxPrefixLength = 16_000
const maxSuffixLength = 8_000

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

    const { prefix, suffix } = getFimContext(document, position)

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
    const baseUrl = toFimBaseUrl(configuredBaseUrl)

    if (!apiKey || !model || !baseUrl) {
      return undefined
    }

    return {
      apiKey,
      baseUrl,
      model,
      maxTokens: clampMaxTokens(fimConfig.get<number>('maxTokens') ?? 128),
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

function getFimContext(
  document: vscode.TextDocument,
  position: vscode.Position,
): { prefix: string; suffix: string } {
  const documentStart = new vscode.Position(0, 0)
  const documentEnd = getDocumentEnd(document)
  const prefix = tail(
    document.getText(new vscode.Range(documentStart, position)),
    maxPrefixLength,
  )
  const suffix = head(
    document.getText(new vscode.Range(position, documentEnd)),
    maxSuffixLength,
  )

  return { prefix, suffix }
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

function toFimBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')

  try {
    const url = new URL(trimmed)

    if (url.hostname === 'api.deepseek.com' && url.pathname !== '/beta') {
      return `${url.origin}/beta`
    }
  } catch {
    return trimmed
  }

  return trimmed
}
