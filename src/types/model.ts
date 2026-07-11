import type {
  ChatCompletionReasoningEffort,
} from 'openai/resources/chat/completions'

export type ModelProviderId = 'openai' | 'openai-compatible' | 'deepseek'

export type ReasoningEffort = Exclude<
  ChatCompletionReasoningEffort,
  'none' | null
>

export interface ModelProvider {
  baseURL: string
  commitMessageModel: string
}
