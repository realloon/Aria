import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import type {
  ChatMessage,
  ChatThreadSummary,
  ExtensionMessage,
} from '../types/chat.js'

const vscode = acquireVsCodeApi()

export function useChat() {
  const input = ref('')
  const loading = ref(false)
  const messages = ref<ChatMessage[]>([])
  const scrollHost = ref<HTMLElement | null>(null)
  const threads = ref<ChatThreadSummary[]>([])
  const activeThreadId = ref('')
  const userOptions = ref<string[]>([])

  const canSend = computed(() => input.value.trim().length > 0 && !loading.value)
  const threadControlsDisabled = computed(
    () => loading.value || userOptions.value.length > 0,
  )

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

  function createThread(): void {
    if (threadControlsDisabled.value) {
      return
    }

    vscode.postMessage({ type: 'newThread' })
  }

  function selectThread(threadId: string): void {
    if (threadControlsDisabled.value || threadId === activeThreadId.value) {
      return
    }

    vscode.postMessage({ type: 'selectThread', threadId })
  }

  function deleteThread(threadId: string): void {
    if (threadControlsDisabled.value || threads.value.length <= 1) {
      return
    }

    vscode.postMessage({ type: 'deleteThread', threadId })
  }

  function chooseOption(option: string): void {
    if (loading.value) {
      return
    }

    input.value = option
    sendMessage()
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
        activeThreadId.value = message.activeThreadId
        threads.value = message.threads
        messages.value = message.messages
        userOptions.value = []
        void scrollToEnd()
        return
      case 'assistantMessageStart':
        messages.value.push({
          id: createLocalId(),
          role: 'assistant',
          reasoning: '',
          text: '',
        })
        void scrollToEnd()
        return
      case 'assistantReasoningDelta': {
        const lastMessage = ensureAssistantMessage()

        lastMessage.reasoning = `${lastMessage.reasoning ?? ''}${message.text}`

        void scrollToEnd()
        return
      }
      case 'assistantMessageDelta': {
        const lastMessage = ensureAssistantMessage()

        lastMessage.text += message.text

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
      reasoning: '',
      text: '',
    }

    messages.value.push(assistantMessage)
    return assistantMessage
  }

  return {
    activeThreadId,
    canSend,
    input,
    loading,
    messages,
    scrollHost,
    threadControlsDisabled,
    threads,
    userOptions,
    chooseOption,
    createThread,
    deleteThread,
    selectThread,
    sendMessage,
  }
}

function createLocalId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
