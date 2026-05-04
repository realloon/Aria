import { OpenAI } from 'openai'
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions'
import { createModelClient, modelProviders } from './providers.js'
import type { ModelChatEvent, RunModelChatInput } from './types.js'

interface ToolCallAccumulator {
  index: number
  id?: string
  name?: string
  arguments: string
}

type AssistantMessageWithReasoning = ChatCompletionAssistantMessageParam & {
  reasoning_content?: string
}

interface ChatRoundResult {
  assistantMessage: ChatCompletionAssistantMessageParam
  toolCalls: ChatCompletionMessageToolCall[]
}

export async function runModelChat(
  input: RunModelChatInput,
): Promise<ChatCompletionMessageParam[]> {
  const client = createModelClient(input)
  const provider = modelProviders[input.providerId]
  const messages = [...input.messages]
  const requestMessages: ChatCompletionMessageParam[] = input.systemPrompt
    ? [{ role: 'system', content: input.systemPrompt }, ...messages]
    : [...messages]
  const tools = input.tools ?? []

  if (tools.length > 0 && !input.executeTool) {
    throw new Error(
      'runModelChat requires executeTool when tools are provided.',
    )
  }

  if (input.userText) {
    const userMessage: ChatCompletionMessageParam = {
      role: 'user',
      content: input.userText,
    }

    messages.push(userMessage)
    requestMessages.push(userMessage)
  }

  const maxRounds = tools.length > 0 ? (input.maxToolRounds ?? 5) : 1

  if (maxRounds < 1) {
    throw new Error('runModelChat requires at least one tool round.')
  }

  for (let round = 0; round < maxRounds; round += 1) {
    const result = await runChatRound(
      client,
      requestMessages,
      input,
      provider.reasoningMode === 'deepseek',
    )

    if (result.toolCalls.length === 0) {
      messages.push(result.assistantMessage)
      return messages
    }

    await emitEvent(input, {
      type: 'toolCalls',
      toolCalls: result.toolCalls,
    })

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

  return messages
}

async function runChatRound(
  client: OpenAI,
  requestMessages: ChatCompletionMessageParam[],
  input: RunModelChatInput,
  includeReasoning: boolean,
): Promise<ChatRoundResult> {
  const tools = input.tools ?? []
  const stream = await client.chat.completions.create(
    {
      model: input.model,
      messages: requestMessages,
      tools: tools.length > 0 ? tools : undefined,
      parallel_tool_calls: tools.length > 0 ? true : undefined,
      stream: true,
      reasoning_effort: input.reasoningEffort,
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
    const reasoning = includeReasoning
      ? (delta as { reasoning_content?: string } | undefined)?.reasoning_content
      : undefined

    if (reasoning) {
      reasoningText += reasoning
      await emitEvent(input, { type: 'reasoning', text: reasoning })
    }

    if (content) {
      responseText += content
      await emitEvent(input, { type: 'content', text: content })
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

async function emitEvent(
  input: RunModelChatInput,
  event: ModelChatEvent,
): Promise<void> {
  await input.onEvent?.(event)
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
