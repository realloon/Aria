import OpenAI from 'openai'
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionReasoningEffort,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions'
import { Model } from './abstract.js'
import type { ModelChatEvent, ModelChatInput } from './abstract.js'

export type OpenAICompatibleReasoningEffort = ChatCompletionReasoningEffort

export interface OpenAICompatibleOptions {
  apiKey: string
  baseURL: string
  systemPrompt?: string
}

export interface OpenAICompatibleChatInput extends ModelChatInput {
  reasoningEffort?: OpenAICompatibleReasoningEffort
}

interface ToolCallAccumulator {
  index: number
  id?: string
  name?: string
  arguments: string
}

export class OpenAICompatible extends Model<OpenAICompatibleChatInput> {
  constructor(options: OpenAICompatibleOptions) {
    super(options.baseURL, options.apiKey, options.systemPrompt)
  }

  override async *chat(
    input: OpenAICompatibleChatInput,
  ): AsyncGenerator<ModelChatEvent> {
    yield* runOpenAICompatibleChat(this.client, this.messages, input, {
      systemPrompt: this.systemPrompt,
    })
  }
}

export async function* runOpenAICompatibleChat(
  client: OpenAI,
  messages: ChatCompletionMessageParam[],
  input: OpenAICompatibleChatInput,
  options: { systemPrompt?: string } = {},
): AsyncGenerator<ModelChatEvent> {
  const requestMessages = [...messages]
  const tools = input.tools ?? []

  if (options.systemPrompt) {
    requestMessages.unshift({ role: 'system', content: options.systemPrompt })
  }

  if (input.input) {
    messages.push({ role: 'user', content: input.input })
    requestMessages.push({ role: 'user', content: input.input })
  }

  if (tools.length > 0 && !input.executeTool) {
    throw new Error('Model.chat requires executeTool when tools are provided.')
  }

  if (tools.length > 0 && input.maxToolRounds === undefined) {
    throw new Error(
      'Model.chat requires maxToolRounds when tools are provided.',
    )
  }

  const maxRounds = tools.length > 0 ? input.maxToolRounds! : 1

  for (let round = 0; round < maxRounds; round += 1) {
    const result = yield* runChatRound(client, requestMessages, input)

    if (result.toolCalls.length === 0) {
      messages.push(result.assistantMessage)
      return
    }

    yield { type: 'toolCalls', toolCalls: result.toolCalls }

    if (!input.executeTool) {
      throw new Error('Model.chat requires executeTool to continue tool calls.')
    }

    if (round + 1 >= maxRounds) {
      throw new Error('Stopped after too many tool call rounds.')
    }

    const toolMessages = await Promise.all(
      result.toolCalls.map(async toolCall =>
        toToolMessage(toolCall, await input.executeTool!(toolCall)),
      ),
    )

    requestMessages.push(result.assistantMessage, ...toolMessages)
    messages.push(result.assistantMessage, ...toolMessages)
  }
}

async function* runChatRound(
  client: OpenAI,
  requestMessages: ChatCompletionMessageParam[],
  input: OpenAICompatibleChatInput,
): AsyncGenerator<
  ModelChatEvent,
  {
    assistantMessage: ChatCompletionAssistantMessageParam
    toolCalls: ChatCompletionMessageToolCall[]
  }
> {
  const tools = input.tools ?? []
  const stream = await client.chat.completions.create(
    {
      model: input.model,
      messages: requestMessages,
      tools: tools.length > 0 ? tools : undefined,
      parallel_tool_calls: tools.length > 0 ? true : undefined,
      stream: true,
      reasoning_effort: input.reasoningEffort,
    },
    {
      signal: input.signal,
      maxRetries: 0,
    },
  )
  const toolCalls = new Map<number, ToolCallAccumulator>()
  let responseText = ''

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta
    const content = delta?.content

    if (content) {
      responseText += content
      yield { type: 'content', text: content }
    }

    accumulateToolCalls(toolCalls, delta?.tool_calls ?? [])
  }

  const completedToolCalls = [...toolCalls.values()]
    .sort((left, right) => left.index - right.index)
    .map(toChatCompletionToolCall)

  return {
    assistantMessage: toAssistantMessage({
      content: responseText,
      toolCalls: completedToolCalls,
    }),
    toolCalls: completedToolCalls,
  }
}

function accumulateToolCalls(
  toolCalls: Map<number, ToolCallAccumulator>,
  deltas: Array<{
    index: number
    id?: string
    function?: { name?: string; arguments?: string }
  }>,
): void {
  for (const toolCall of deltas) {
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

function toAssistantMessage(options: {
  content: string
  toolCalls: ChatCompletionMessageToolCall[]
}): ChatCompletionAssistantMessageParam {
  const message: ChatCompletionAssistantMessageParam = {
    role: 'assistant',
    content: options.content || null,
  }

  if (options.toolCalls.length > 0) {
    message.tool_calls = options.toolCalls
  }

  return message
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

function toToolMessage(
  toolCall: ChatCompletionMessageToolCall,
  content: string,
): ChatCompletionToolMessageParam {
  return {
    role: 'tool',
    tool_call_id: toolCall.id,
    content,
  }
}
