export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  reasoning?: string
  text: string
}

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'sendMessage'; text: string }
  | { type: 'selectChatModel'; model: string }

export type ExtensionMessage =
  | {
      type: 'threadState'
      messages: ChatMessage[]
    }
  | {
      type: 'chatModelState'
      models: string[]
      selectedModel: string
    }
  | { type: 'assistantMessageStart' }
  | { type: 'assistantReasoningDelta'; text: string }
  | { type: 'assistantMessageDelta'; text: string }
  | { type: 'askUser'; question: string; options: string[] }
  | { type: 'error'; message: string }
  | { type: 'loading'; loading: boolean }
