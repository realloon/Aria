import { OpenAI } from 'openai'
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions'
import { createModelClient, modelProviders } from './providers.js'
import type { ModelChatEvent, RunModelChatInput } from '../types/model.js'

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
  finishReason?: NonNullable<ChatCompletionChunk.Choice['finish_reason']>
  toolCalls: ChatCompletionMessageFunctionToolCall[]
}

export async function runModelChat(input: RunModelChatInput) {
  const client = createModelClient(input)
  const provider = modelProviders[input.providerId]
  const messages = [...input.messages]
  const requestMessages: ChatCompletionMessageParam[] = input.systemPrompt
    ? [{ role: 'system', content: input.systemPrompt }, ...messages]
    : [...messages]

  if (input.userText) {
    const userMessage: ChatCompletionMessageParam = {
      role: 'user',
      content: input.userText,
    }

    messages.push(userMessage)
    requestMessages.push(userMessage)
  }

  const toolConfig = input.toolConfig

  while (true) {
    const result = await runChatRound(
      client,
      requestMessages,
      input,
      provider.reasoningMode === 'deepseek',
    )

    if (
      result.finishReason !== 'tool_calls' ||
      result.toolCalls.length === 0 ||
      !toolConfig
    ) {
      messages.push(result.assistantMessage)
      return messages
    }

    await emitEvent(input, {
      type: 'toolCalls',
      toolCalls: result.toolCalls,
    })

    const toolMessages = await Promise.all(
      result.toolCalls.map(async toolCall =>
        toToolMessage(toolCall, await toolConfig.executeTool(toolCall)),
      ),
    )

    requestMessages.push(result.assistantMessage, ...toolMessages)
    messages.push(result.assistantMessage, ...toolMessages)
  }
}

async function runChatRound(
  client: OpenAI,
  requestMessages: ChatCompletionMessageParam[],
  input: RunModelChatInput,
  includeReasoning: boolean,
) {
  const tools = input.toolConfig?.tools
  const request: ChatCompletionCreateParamsStreaming = {
    model: input.model,
    messages: requestMessages,
    tools: tools?.length ? tools : undefined,
    parallel_tool_calls: tools?.length ? true : undefined,
    stream: true,
    reasoning_effort: input.reasoningEffort,
  }
  const stream = await client.chat.completions.create(request, {
    signal: input.signal,
    maxRetries: 0,
  })
  const toolCalls = new Map<number, ToolCallAccumulator>()
  let finishReason: ChatCompletionChunk.Choice['finish_reason'] = null
  let responseText = ''
  let reasoningText = ''

  for await (const chunk of stream) {
    const choice = chunk.choices[0]
    const delta = choice?.delta
    const content = delta?.content
    const reasoning = includeReasoning
      ? (delta as { reasoning_content?: string } | undefined)?.reasoning_content
      : undefined

    if (choice?.finish_reason) {
      finishReason = choice.finish_reason
    }

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
    finishReason: finishReason ?? undefined,
    toolCalls: completedToolCalls,
  }
}

async function emitEvent(input: RunModelChatInput, event: ModelChatEvent) {
  await input.onEvent?.(event)
}

function accumulateToolCalls(
  toolCalls: Map<number, ToolCallAccumulator>,
  deltas: ChatCompletionChunk.Choice.Delta.ToolCall[],
) {
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
  toolCalls: ChatCompletionMessageFunctionToolCall[]
}) {
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
): ChatCompletionMessageFunctionToolCall {
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
  toolCall: ChatCompletionMessageFunctionToolCall,
  content: string,
): ChatCompletionToolMessageParam {
  return {
    role: 'tool',
    tool_call_id: toolCall.id,
    content,
  }
}
