export interface ToolActivity {
  id: string
  name: string
  state: 'running' | 'done'
}

export interface ChatTraceItem {
  id: string
  type: 'reasoning' | 'tools'
  text?: string
  tools?: ToolActivity[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  trace?: ChatTraceItem[]
  traceStartedAt?: number
  traceFinishedAt?: number
  text: string
}

export interface ChatModelOption {
  id: string
  label: string
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
      models: ChatModelOption[]
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
