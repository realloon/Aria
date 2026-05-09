export interface ToolActivity {
  id: string
  name: string
  state: 'running' | 'done'
}

export interface ThoughtBlock {
  id: string
  reasoning: string
  state: 'running' | 'done'
  tools: ToolActivity[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  thoughts?: ThoughtBlock[]
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
  | { type: 'assistantToolCallsStarted'; tools: ToolActivity[] }
  | { type: 'assistantToolCallDone'; id: string }
  | { type: 'askUser'; question: string; options: string[] }
  | { type: 'error'; message: string }
  | { type: 'loading'; loading: boolean }
