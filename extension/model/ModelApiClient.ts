import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions'
import OpenAI from 'openai'

export interface ModelApiConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export type ChatStreamDelta =
  | { type: 'content'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'toolCalls'; toolCalls: ChatCompletionMessageToolCall[] }

interface ToolCallAccumulator {
  index: number
  id?: string
  name?: string
  arguments: string
}

export async function* streamChat(
  config: ModelApiConfig,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[] = [],
): AsyncGenerator<ChatStreamDelta> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  })

  const stream = await client.chat.completions.create({
    model: config.model,
    messages,
    tools: tools.length > 0 ? tools : undefined,
    stream: true,
    reasoning_effort: 'high',
    extra_body: {
      thinking: { type: 'enabled' },
    },
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming)

  const toolCalls = new Map<number, ToolCallAccumulator>()

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

    for (const toolCall of delta?.tool_calls ?? []) {
      const current = toolCalls.get(toolCall.index) ?? {
        index: toolCall.index,
        arguments: '',
      }

      if (toolCall.id) {
        current.id = toolCall.id
      }

      if (toolCall.function?.name) {
        current.name = toolCall.function.name
      }

      if (toolCall.function?.arguments) {
        current.arguments += toolCall.function.arguments
      }

      toolCalls.set(toolCall.index, current)
    }
  }

  if (toolCalls.size > 0) {
    yield {
      type: 'toolCalls',
      toolCalls: [...toolCalls.values()]
        .sort((left, right) => left.index - right.index)
        .map(toChatCompletionToolCall),
    }
  }
}

function toChatCompletionToolCall(
  toolCall: ToolCallAccumulator,
): ChatCompletionMessageToolCall {
  if (!toolCall.id || !toolCall.name) {
    throw new Error('Model returned an incomplete tool call.')
  }

  return {
    id: toolCall.id,
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: toolCall.arguments,
    },
  }
}
