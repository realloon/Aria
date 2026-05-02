import { createDeepSeek } from '@ai-sdk/deepseek'
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions'
import type { ModelApiConfig } from './index.js'

export type ChatStreamDelta =
  | { type: 'content'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'toolCalls'; toolCalls: ChatCompletionMessageToolCall[] }

type DeepSeekPromptMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: DeepSeekTextPart[] }
  | { role: 'assistant'; content: DeepSeekAssistantPart[] }
  | { role: 'tool'; content: DeepSeekToolResultPart[] }

interface DeepSeekTextPart {
  type: 'text'
  text: string
}

type DeepSeekAssistantPart =
  | DeepSeekTextPart
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }

interface DeepSeekToolResultPart {
  type: 'tool-result'
  toolCallId: string
  toolName: string
  output: { type: 'text'; value: string }
}

interface DeepSeekFunctionTool {
  type: 'function'
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export async function* streamChat(
  config: ModelApiConfig,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[] = [],
): AsyncGenerator<ChatStreamDelta> {
  const deepseek = createDeepSeek({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || undefined,
  })
  const model = deepseek.chat(config.model)

  const { stream } = await model.doStream({
    prompt: toDeepSeekPrompt(messages),
    tools: tools.length > 0 ? tools.flatMap(toDeepSeekTool) : undefined,
    toolChoice: tools.length > 0 ? { type: 'auto' } : undefined,
    providerOptions: {
      deepseek: {
        thinking: { type: 'enabled' },
      },
    },
  })
  const toolCalls: ChatCompletionMessageToolCall[] = []

  const reader = stream.getReader()

  try {
    while (true) {
      const { done, value: part } = await reader.read()

      if (done) {
        break
      }

      switch (part.type) {
        case 'reasoning-delta':
          yield { type: 'reasoning', text: part.delta }
          break
        case 'text-delta':
          yield { type: 'content', text: part.delta }
          break
        case 'tool-call':
          toolCalls.push({
            id: part.toolCallId,
            type: 'function',
            function: {
              name: part.toolName,
              arguments: part.input,
            },
          })
          break
        case 'error':
          throw part.error instanceof Error
            ? part.error
            : new Error('Model stream failed.')
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (toolCalls.length > 0) {
    yield { type: 'toolCalls', toolCalls }
  }
}

function toDeepSeekPrompt(
  messages: ChatCompletionMessageParam[],
): DeepSeekPromptMessage[] {
  const toolNamesById = new Map<string, string>()
  const prompt: DeepSeekPromptMessage[] = []

  for (const message of messages) {
    switch (message.role) {
      case 'system':
        prompt.push({
          role: 'system',
          content: stringifyContent(message.content),
        })
        break
      case 'user':
        prompt.push({
          role: 'user',
          content: [{ type: 'text', text: stringifyContent(message.content) }],
        })
        break
      case 'assistant': {
        const content: DeepSeekAssistantPart[] = []
        const text = stringifyContent(message.content)
        const reasoning = (message as { reasoning_content?: string })
          .reasoning_content

        if (reasoning) {
          content.push({ type: 'reasoning', text: reasoning })
        }

        if (text) {
          content.push({ type: 'text', text })
        }

        for (const toolCall of message.tool_calls ?? []) {
          if (toolCall.type !== 'function') {
            continue
          }

          toolNamesById.set(toolCall.id, toolCall.function.name)
          content.push({
            type: 'tool-call',
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            input: parseToolArguments(toolCall.function.arguments),
          })
        }

        prompt.push({ role: 'assistant', content })
        break
      }
      case 'tool':
        prompt.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: message.tool_call_id,
              toolName:
                toolNamesById.get(message.tool_call_id) ?? 'unknown_tool',
              output: {
                type: 'text',
                value: stringifyContent(message.content),
              },
            },
          ],
        })
        break
    }
  }

  return prompt
}

function toDeepSeekTool(tool: ChatCompletionTool): DeepSeekFunctionTool[] {
  if (tool.type !== 'function') {
    return []
  }

  return [
    {
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      inputSchema: tool.function.parameters ?? { type: 'object' },
    },
  ]
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!content) {
    return ''
  }

  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (
          part &&
          typeof part === 'object' &&
          'text' in part &&
          typeof part.text === 'string'
        ) {
          return part.text
        }

        return JSON.stringify(part)
      })
      .join('')
  }

  return JSON.stringify(content)
}

function parseToolArguments(argsJson: string): unknown {
  try {
    return JSON.parse(argsJson) as unknown
  } catch {
    return {}
  }
}
