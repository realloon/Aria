import { deepSeekBaseURL, ProviderModel } from './deepseek.js'
import { OpenAICompatible } from './openai-compatible.js'

export type ModelProviderId = 'openai' | 'openai-compatible' | 'deepseek'

export interface ModelProvider {
  id: ModelProviderId
  label: string
  baseURL: string
  chatModels: string[]
  fimModel?: string
  reasoningMode: 'openai' | 'deepseek'
}

export const modelProviders = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: deepSeekBaseURL,
    chatModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    fimModel: 'deepseek-v4-flash',
    reasoningMode: 'deepseek',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    chatModels: ['gpt-5.3-codex'],
    reasoningMode: 'openai',
  },
  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI Compatible',
    baseURL: '',
    chatModels: ['gpt-5.3-codex'],
    reasoningMode: 'openai',
  },
} as const satisfies Record<ModelProviderId, ModelProvider>

export function parseModelProviderId(
  value: string | undefined,
): ModelProviderId {
  switch (value) {
    case undefined:
    case '':
    case 'deepseek':
      return 'deepseek'
    case 'openai':
      return 'openai'
    case 'openai-compatible':
      return 'openai-compatible'
    default:
      throw new Error('Configure aria.api.provider before sending a message.')
  }
}

export function createProviderModel(
  providerId: ModelProviderId,
  apiKey: string,
  systemPrompt?: string,
  options: { baseURL?: string } = {},
): ProviderModel | OpenAICompatible {
  if (providerId === 'openai-compatible') {
    if (!options.baseURL) {
      throw new Error('Configure aria.api.baseURLs.openai-compatible.')
    }

    return new OpenAICompatible({
      apiKey,
      baseURL: options.baseURL,
      systemPrompt,
    })
  }

  return new ProviderModel(modelProviders[providerId], apiKey, systemPrompt)
}
