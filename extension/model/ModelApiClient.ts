import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import OpenAI from 'openai'

export interface ModelApiConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export async function completeChat(
  config: ModelApiConfig,
  messages: ChatCompletionMessageParam[],
): Promise<string> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  })

  const completion = await client.chat.completions.create({
    model: config.model,
    messages,
  })

  return completion.choices[0]?.message.content ?? ''
}
