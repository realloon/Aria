import type { ModelApiConfig } from './index.js'
import OpenAI from 'openai'

export interface FimCompletionInput {
  prefix: string
  suffix?: string
  maxTokens: number
}

export async function completeFim(
  config: ModelApiConfig,
  input: FimCompletionInput,
  options: { signal?: AbortSignal } = {},
) {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  })

  const response = await client.completions.create(
    {
      model: config.model,
      prompt: input.prefix,
      suffix: input.suffix,
      max_tokens: input.maxTokens,
    },
    {
      signal: options.signal,
      timeout: 10_000,
      maxRetries: 0,
    },
  )

  return response.choices[0]?.text ?? ''
}
