import { OpenAI } from 'openai'
import type { ModelProvider, ModelProviderId } from '../types/model.js'

export const modelProviders = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/beta',
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

export function parseModelProviderId(value: string | undefined) {
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

export function createModelClient(options: {
  providerId: ModelProviderId
  apiKey: string
  baseURL?: string
}) {
  const provider = modelProviders[options.providerId]
  const baseURL =
    options.providerId === 'openai-compatible'
      ? options.baseURL
      : provider.baseURL

  if (!baseURL) {
    if (options.providerId === 'openai-compatible') {
      throw new Error('Configure aria.api.baseURLs.openai-compatible.')
    }

    throw new Error(`Provider ${options.providerId} does not have a base URL.`)
  }

  return new OpenAI({ baseURL, apiKey: options.apiKey })
}
