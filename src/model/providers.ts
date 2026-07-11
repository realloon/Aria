import { OpenAI } from 'openai'
import type { ModelProvider, ModelProviderId } from '../types/model.js'

export const modelProviders = {
  deepseek: {
    baseURL: 'https://api.deepseek.com/beta',
    commitMessageModel: 'deepseek-v4-pro',
  },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    commitMessageModel: 'gpt-5.3-codex',
  },
  'openai-compatible': {
    baseURL: '',
    commitMessageModel: 'gpt-5.3-codex',
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
      throw new Error('Configure aria.api.provider.')
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
