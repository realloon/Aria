import {
  deepSeekBaseURL,
  ProviderModel,
} from './deepseek.js'
import { OpenAICompatible } from './openai-compatible.js'

export type ModelProviderId = 'deepseek' | 'openai' | 'openai-compatible'

export interface ModelProvider {
  id: ModelProviderId
  label: string
  baseURL: string
  chatModel: string
  fimModel?: string
  reasoningMode: 'deepseek' | 'openai'
}

export const modelProviders = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: deepSeekBaseURL,
    chatModel: 'deepseek-v4-flash',
    fimModel: 'deepseek-v4-pro',
    reasoningMode: 'deepseek',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    chatModel: 'gpt-5.3-codex',
    reasoningMode: 'openai',
  },
  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI Compatible',
    baseURL: '',
    chatModel: 'gpt-5.3-codex',
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
