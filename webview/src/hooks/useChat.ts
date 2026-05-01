import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { ChatMessage, ExtensionMessage } from '../types/chat.js'

const vscode = acquireVsCodeApi()

export function useChat() {
  const input = ref('')
  const loading = ref(false)
  const hasApiKey = ref(false)
  const model = ref('')
  const baseUrl = ref('')
  const messages = ref<ChatMessage[]>([
    {
      id: 1,
      role: 'system',
      text: 'Ask Aria about the current codebase, a design choice, or the next implementation step.',
    },
  ])
  const scrollHost = ref<HTMLElement | null>(null)

  const canSend = computed(() => input.value.trim().length > 0 && !loading.value)
  const statusText = computed(() => {
    if (!hasApiKey.value) {
      return 'API key required'
    }

    if (!model.value) {
      return 'Model not configured'
    }

    return model.value
  })

  function sendMessage(): void {
    const text = input.value.trim()

    if (!text || loading.value) {
      return
    }

    messages.value.push({
      id: Date.now(),
      role: 'user',
      text,
    })
    input.value = ''
    vscode.postMessage({ type: 'sendMessage', text })
    void scrollToEnd()
  }

  function setApiKey(): void {
    vscode.postMessage({ type: 'setApiKey' })
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
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
      case 'status':
        hasApiKey.value = message.hasApiKey
        model.value = message.model
        baseUrl.value = message.baseUrl
        return
      case 'assistantMessage':
        messages.value.push({
          id: Date.now(),
          role: 'assistant',
          text: message.text,
        })
        void scrollToEnd()
        return
      case 'error':
        messages.value.push({
          id: Date.now(),
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

  return {
    baseUrl,
    canSend,
    input,
    loading,
    messages,
    scrollHost,
    sendMessage,
    setApiKey,
    statusText,
    onKeydown,
  }
}
