import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { ChatMessage, ExtensionMessage } from '../types/chat.js'

const vscode = acquireVsCodeApi()

export function useChat() {
  const input = ref('')
  const loading = ref(false)
  const messages = ref<ChatMessage[]>([])
  const scrollHost = ref<HTMLElement | null>(null)
  const userOptions = ref<string[]>([])

  const canSend = computed(() => input.value.trim().length > 0 && !loading.value)
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
      case 'assistantMessageStart':
        messages.value.push({
          id: Date.now(),
          role: 'assistant',
          reasoning: '',
          text: '',
        })
        void scrollToEnd()
        return
      case 'assistantReasoningDelta': {
        const lastMessage = messages.value.at(-1)

        if (lastMessage?.role === 'assistant') {
          lastMessage.reasoning = `${lastMessage.reasoning ?? ''}${message.text}`
        }

        void scrollToEnd()
        return
      }
      case 'assistantMessageDelta': {
        const lastMessage = messages.value.at(-1)

        if (lastMessage?.role === 'assistant') {
          lastMessage.text += message.text
        }

        void scrollToEnd()
        return
      }
      case 'askUser':
        messages.value.push({
          id: Date.now(),
          role: 'assistant',
          text: message.question,
        })
        userOptions.value = message.options
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
    canSend,
    input,
    loading,
    messages,
    scrollHost,
    userOptions,
    chooseOption,
    sendMessage,
  }
}
