import type {
  ChatCompletionFunctionTool,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionReasoningEffort,
} from 'openai/resources/chat/completions'

export type ModelProviderId = 'openai' | 'openai-compatible' | 'deepseek'

export type ChatReasoningEffort = Exclude<
  ChatCompletionReasoningEffort,
  'none' | null
>

export interface ModelProvider {
  id: ModelProviderId
  label: string
  baseURL: string
  chatModels: string[]
  chatModelDisplayNames?: Record<string, string>
  fimModel?: string
  reasoningMode: 'openai' | 'deepseek'
}

export type ModelChatEvent =
  | { type: 'content'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'toolCalls'; toolCalls: ChatCompletionMessageFunctionToolCall[] }

export interface RunModelChatInput {
  providerId: ModelProviderId
  apiKey: string
  baseURL?: string
  model: string
  systemPrompt?: string
  messages: ChatCompletionMessageParam[]
  userText: string
  reasoningEffort: ChatReasoningEffort
  onEvent?(event: ModelChatEvent): void | Promise<void>
  signal?: AbortSignal
  toolConfig?: {
    tools: ChatCompletionFunctionTool[]
    executeTool(toolCall: ChatCompletionMessageFunctionToolCall): Promise<string>
  }
}

export interface CompleteFimInput {
  providerId: ModelProviderId
  apiKey: string
  baseURL?: string
  model: string
  prefix: string
  suffix?: string
  maxTokens: number
  signal?: AbortSignal
}
