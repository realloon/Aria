import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import type {
  ChatMessage,
  ExtensionMessage,
  ThoughtBlock,
} from '../../../types/chat.js'

const vscode = acquireVsCodeApi()

export function useChat() {
  const input = ref('')
  const loading = ref(false)
  const messages = ref<ChatMessage[]>([])
  const chatModels = ref<string[]>([])
  const selectedChatModel = ref('')
  const scrollHost = ref<HTMLElement | null>(null)
  const userOptions = ref<string[]>([])

  const canSend = computed(() => input.value.trim().length > 0 && !loading.value)

  function sendMessage(): void {
    const text = input.value.trim()

    if (!text || loading.value) {
      return
    }

    messages.value.push({
      id: createLocalId(),
      role: 'user',
      text,
    })
    userOptions.value = []
    input.value = ''
    vscode.postMessage({ type: 'sendMessage', text })
    void scrollToEnd()
  }

  function chooseOption(option: string): void {
    if (loading.value) {
      return
    }

    input.value = option
    sendMessage()
  }

  function selectChatModel(model: string): void {
    if (loading.value || model === selectedChatModel.value) {
      return
    }

    selectedChatModel.value = model
    vscode.postMessage({ type: 'selectChatModel', model })
  }

  async function scrollToEnd(): Promise<void> {
    await nextTick()
    scrollHost.value?.scrollTo({
      top: scrollHost.value.scrollHeight,
      behavior: 'smooth',
    })
  }

  function handleExtensionMessage(event: MessageEvent): void {
    const message = event.data as ExtensionMessage

    switch (message.type) {
      case 'threadState':
        messages.value = message.messages
        userOptions.value = []
        void scrollToEnd()
        return
      case 'chatModelState':
        chatModels.value = message.models
        selectedChatModel.value = message.selectedModel
        return
      case 'assistantMessageStart':
        messages.value.push({
          id: createLocalId(),
          role: 'assistant',
          thoughts: [],
          text: '',
        })
        void scrollToEnd()
        return
      case 'assistantReasoningDelta': {
        const lastMessage = ensureAssistantMessage()
        const thought = ensureCurrentThought(lastMessage)

        thought.reasoning += message.text

        void scrollToEnd()
        return
      }
      case 'assistantMessageDelta': {
        const lastMessage = ensureAssistantMessage()

        finishCurrentThought(lastMessage)
        lastMessage.text += message.text

        void scrollToEnd()
        return
      }
      case 'assistantToolCallsStarted': {
        const lastMessage = ensureAssistantMessage()
        const thought = ensureCurrentThought(lastMessage)

        thought.tools = [...thought.tools, ...message.tools]
        thought.state = 'done'

        void scrollToEnd()
        return
      }
      case 'assistantToolCallDone': {
        const lastMessage = ensureAssistantMessage()
        const tool = lastMessage.thoughts
          ?.flatMap(thought => thought.tools)
          .find(item => item.id === message.id)

        if (tool) {
          tool.state = 'done'
        }

        void scrollToEnd()
        return
      }
      case 'askUser':
        messages.value.push({
          id: createLocalId(),
          role: 'assistant',
          text: message.question,
        })
        userOptions.value = message.options
        void scrollToEnd()
        return
      case 'error':
        messages.value.push({
          id: createLocalId(),
          role: 'assistant',
          text: message.message,
        })
        void scrollToEnd()
        return
      case 'loading':
        loading.value = message.loading
        void scrollToEnd()
        return
    }
  }

  onMounted(() => {
    window.addEventListener('message', handleExtensionMessage)
    vscode.postMessage({ type: 'ready' })
  })

  onUnmounted(() => {
    window.removeEventListener('message', handleExtensionMessage)
  })

  function ensureAssistantMessage(): ChatMessage {
    const lastMessage = messages.value.at(-1)

    if (lastMessage?.role === 'assistant') {
      return lastMessage
    }

    const assistantMessage: ChatMessage = {
      id: createLocalId(),
      role: 'assistant',
      thoughts: [],
      text: '',
    }

    messages.value.push(assistantMessage)
    return assistantMessage
  }

  return {
    canSend,
    chatModels,
    input,
    loading,
    messages,
    selectedChatModel,
    scrollHost,
    userOptions,
    chooseOption,
    selectChatModel,
    sendMessage,
  }
}

function ensureCurrentThought(message: ChatMessage): ThoughtBlock {
  message.thoughts ??= []

  const lastThought = message.thoughts.at(-1)

  if (lastThought && lastThought.tools.length === 0) {
    return lastThought
  }

  const thought = {
    id: createLocalId(),
    reasoning: '',
    state: 'running' as const,
    tools: [],
  }

  message.thoughts.push(thought)
  return thought
}

function finishCurrentThought(message: ChatMessage): void {
  const lastThought = message.thoughts?.at(-1)

  if (lastThought) {
    lastThought.state = 'done'
  }
}

function createLocalId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
