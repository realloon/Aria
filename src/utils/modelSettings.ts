import * as vscode from 'vscode'
import { modelProviders } from '../model/index.js'
import type {
  ChatReasoningEffort,
  ModelProvider,
  ModelProviderId,
} from '../types/model.js'

export const chatModelStateKey = 'aria.chatModel'

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
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value
    default:
      throw new Error(errorMessage)
  }
}

export function getSelectedChatModel(
  context: vscode.ExtensionContext,
  providerId: ModelProviderId,
) {
  const provider: ModelProvider = modelProviders[providerId]
  const selectedModels =
    context.workspaceState.get<Record<string, string>>(chatModelStateKey) ?? {}
  const selectedModel = selectedModels[providerId]

  return selectedModel && provider.chatModels.includes(selectedModel)
    ? selectedModel
    : provider.chatModels[0]!
}
