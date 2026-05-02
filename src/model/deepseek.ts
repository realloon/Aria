import OpenAI from 'openai'
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions'
import { Model } from './abstract.js'
import type { ModelChatEvent, ModelChatInput } from './abstract.js'

export type ChatReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'

export interface DeepSeekChatInput extends ModelChatInput {
  reasoningEffort: ChatReasoningEffort
}

export const deepSeekBaseURL = 'https://api.deepseek.com/beta'

export interface ProviderModelOptions {
  baseURL: string
  reasoningMode: 'deepseek' | 'openai'
}

interface ToolCallAccumulator {
  index: number
  id?: string
  name?: string
  arguments: string
}

type AssistantMessageWithReasoning = ChatCompletionAssistantMessageParam & {
  reasoning_content?: string
}

interface ChatRequestOptions {
  reasoningEffort?: ChatReasoningEffort
  extraBody?: Record<string, unknown>
  systemPrompt?: string
}

export class DeepSeek extends Model<DeepSeekChatInput> {
  constructor(apiKey: string, systemPrompt?: string) {
    super(deepSeekBaseURL, apiKey, systemPrompt)
  }

  override async *chat(
    input: DeepSeekChatInput,
  ): AsyncGenerator<ModelChatEvent> {
    yield* runChat(this.client, this.messages, input, {
      ...getChatRequestOptions(
        { baseURL: deepSeekBaseURL, reasoningMode: 'deepseek' },
        input.reasoningEffort,
      ),
      systemPrompt: this.systemPrompt,
    })
  }
}

export class ProviderModel extends Model<DeepSeekChatInput> {
  private readonly options: ProviderModelOptions

  constructor(
    options: ProviderModelOptions,
    apiKey: string,
    systemPrompt?: string,
  ) {
    super(options.baseURL, apiKey, systemPrompt)
    this.options = options
  }

  override async *chat(
    input: DeepSeekChatInput,
  ): AsyncGenerator<ModelChatEvent> {
    yield* runChat(this.client, this.messages, input, {
      ...getChatRequestOptions(this.options, input.reasoningEffort),
      systemPrompt: this.systemPrompt,
    })
  }
}

function getChatRequestOptions(
  options: ProviderModelOptions,
  reasoningEffort: ChatReasoningEffort,
): Pick<ChatRequestOptions, 'reasoningEffort' | 'extraBody'> {
  if (options.reasoningMode === 'deepseek') {
    return {
      reasoningEffort,
      extraBody: {
        thinking: {
          type: reasoningEffort === 'none' ? 'disabled' : 'enabled',
        },
      },
    }
  }

  return {
    reasoningEffort: reasoningEffort === 'none' ? undefined : reasoningEffort,
  }
}

async function* runChat(
  client: OpenAI,
  messages: ChatCompletionMessageParam[],
  input: ModelChatInput,
  options: ChatRequestOptions = {},
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
    const result = yield* runChatRound(client, requestMessages, input, options)

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
  input: ModelChatInput,
  options: ChatRequestOptions,
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
      reasoning_effort: options.reasoningEffort,
      extra_body: options.extraBody,
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
    {
      signal: input.signal,
      maxRetries: 0,
    },
  )
  const toolCalls = new Map<number, ToolCallAccumulator>()
  let responseText = ''
  let reasoningText = ''

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta
    const content = delta?.content
    const reasoning = (delta as { reasoning_content?: string } | undefined)
      ?.reasoning_content

    if (reasoning) {
      reasoningText += reasoning
      yield { type: 'reasoning', text: reasoning }
    }

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
      reasoningContent: reasoningText,
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
  reasoningContent: string
  toolCalls: ChatCompletionMessageToolCall[]
}): ChatCompletionAssistantMessageParam {
  const message: AssistantMessageWithReasoning = {
    role: 'assistant',
    content: options.content || null,
  }

  if (options.reasoningContent) {
    message.reasoning_content = options.reasoningContent
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
