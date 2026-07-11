import { OpenAI } from 'openai'
import type { ChatCompletionReasoningEffort } from 'openai/resources/chat/completions'

export const deepseek = {
  baseURL: 'https://api.deepseek.com/beta',
  commitMessageModel: 'deepseek-v4-pro',
} as const

export type ReasoningEffort = Exclude<ChatCompletionReasoningEffort, 'none' | null>

export function createModelClient(apiKey: string) {
  return new OpenAI({ baseURL: deepseek.baseURL, apiKey })
}
