export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  reasoning?: string
  text: string
}

export type ExtensionMessage =
  | { type: 'assistantMessageStart' }
  | { type: 'assistantReasoningDelta'; text: string }
  | { type: 'assistantMessageDelta'; text: string }
  | { type: 'error'; message: string }
  | { type: 'loading'; loading: boolean }
