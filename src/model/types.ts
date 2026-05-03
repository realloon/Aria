import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions'

export type ModelProviderId = 'openai' | 'openai-compatible' | 'deepseek'

export type ChatReasoningEffort =
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'

export interface ModelProvider {
  id: ModelProviderId
  label: string
  baseURL: string
  chatModels: string[]
  fimModel?: string
  reasoningMode: 'openai' | 'deepseek'
}

export type ModelChatEvent =
  | { type: 'content'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'toolCalls'; toolCalls: ChatCompletionMessageToolCall[] }

export interface RunModelChatInput {
  providerId: ModelProviderId
  apiKey: string
  baseURL?: string
  model: string
  systemPrompt?: string
  messages: ChatCompletionMessageParam[]
  userText: string
  reasoningEffort: ChatReasoningEffort
  tools?: ChatCompletionTool[]
  executeTool?(toolCall: ChatCompletionMessageToolCall): Promise<string>
  maxToolRounds?: number
  onEvent?(event: ModelChatEvent): void | Promise<void>
  signal?: AbortSignal
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
