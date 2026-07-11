import * as vscode from 'vscode'
import type { ModelProviderId } from '../types/model.js'

export function getProviderApiKey(
  config: vscode.WorkspaceConfiguration,
  providerId: ModelProviderId,
) {
  return config.get<string>(`apiKeys.${providerId}`)?.trim() ?? ''
}

export function getProviderBaseURL(
  config: vscode.WorkspaceConfiguration,
  providerId: ModelProviderId,
) {
  if (providerId !== 'openai-compatible') {
    return undefined
  }

  return config.get<string>(`baseURLs.${providerId}`)?.trim() ?? ''
}

export function parseReasoningEffort(
  value: string | undefined,
  errorMessage = 'Configure aria.api.reasoningEffort.',
) {
  switch (value) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value
    default:
      throw new Error(errorMessage)
  }
}
