import { createModelClient } from './providers.js'
import type { CompleteFimInput } from './types.js'

export async function completeFim(input: CompleteFimInput): Promise<string> {
  const client = createModelClient(input)
  const response = await client.completions.create(
    {
      model: input.model,
      prompt: input.prefix,
      suffix: input.suffix,
      max_tokens: input.maxTokens,
    },
    {
      signal: input.signal,
      timeout: 10_000,
      maxRetries: 0,
    },
  )

  return response.choices[0]?.text ?? ''
}
