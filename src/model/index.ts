export interface ModelApiConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export { streamChat } from './chat.js'
export type { ChatStreamDelta } from './chat.js'
export { completeFim } from './fim.js'
export type { FimCompletionInput } from './fim.js'
