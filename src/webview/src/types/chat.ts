export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  reasoning?: string
  text: string
}

export type ExtensionMessage =
  | {
      type: 'threadState'
      messages: ChatMessage[]
    }
  | { type: 'assistantMessageStart' }
  | { type: 'assistantReasoningDelta'; text: string }
  | { type: 'assistantMessageDelta'; text: string }
  | { type: 'askUser'; question: string; options: string[] }
  | { type: 'error'; message: string }
  | { type: 'loading'; loading: boolean }
