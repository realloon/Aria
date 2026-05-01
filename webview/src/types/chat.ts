export interface ChatMessage {
  id: number
  role: 'user' | 'assistant' | 'system'
  text: string
}

export type ExtensionMessage =
  | { type: 'status'; hasApiKey: boolean; model: string; baseUrl: string }
  | { type: 'assistantMessage'; text: string }
  | { type: 'error'; message: string }
  | { type: 'loading'; loading: boolean }
