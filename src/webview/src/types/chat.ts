export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  reasoning?: string
  text: string
}

export interface ChatThreadSummary {
  id: string
  title: string
  updatedAt: number
}

export type ExtensionMessage =
  | {
      type: 'threadState'
      activeThreadId: string
      threads: ChatThreadSummary[]
      messages: ChatMessage[]
    }
  | { type: 'assistantMessageStart' }
  | { type: 'assistantReasoningDelta'; text: string }
  | { type: 'assistantMessageDelta'; text: string }
  | { type: 'askUser'; question: string; options: string[] }
  | { type: 'error'; message: string }
  | { type: 'loading'; loading: boolean }
