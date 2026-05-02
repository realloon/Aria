import OpenAI from 'openai'
import type { CompletionCreateParamsNonStreaming } from 'openai/resources/completions'
import type { ModelApiConfig } from './index.js'

export interface FimCompletionInput {
  prefix: string
  suffix?: string
  maxTokens: number
}

export async function completeFim(
  config: ModelApiConfig,
  input: FimCompletionInput,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
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
      temperature: 0,
      stream: false,
    } satisfies CompletionCreateParamsNonStreaming,
    {
      signal: options.signal,
      timeout: 10_000,
      maxRetries: 0,
    },
  )

  return response.choices[0]?.text ?? ''
}
