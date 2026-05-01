import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import OpenAI from 'openai'

export interface ModelApiConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export type ChatStreamDelta =
  | { type: 'content'; text: string }
  | { type: 'reasoning'; text: string }

export async function* streamChat(
  config: ModelApiConfig,
  messages: ChatCompletionMessageParam[],
): AsyncGenerator<ChatStreamDelta> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  })

  const stream = await client.chat.completions.create({
    model: config.model,
    messages,
    stream: true,
    reasoning_effort: 'high',
    extra_body: {
      thinking: { type: 'enabled' },
    },
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming)

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta
    const content = delta?.content
    const reasoning = (delta as { reasoning_content?: string } | undefined)
      ?.reasoning_content

    if (reasoning) {
      yield { type: 'reasoning', text: reasoning }
    }

    if (content) {
      yield { type: 'content', text: content }
    }
  }
}
