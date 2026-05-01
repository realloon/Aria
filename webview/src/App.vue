<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'

interface ChatMessage {
  id: number
  role: 'user' | 'assistant' | 'system'
  text: string
}

type ExtensionMessage =
  | { type: 'status'; hasApiKey: boolean; model: string; baseUrl: string }
  | { type: 'assistantMessage'; text: string }
  | { type: 'error'; message: string }
  | { type: 'loading'; loading: boolean }

const vscode = acquireVsCodeApi()
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

window.addEventListener('message', (event: MessageEvent<ExtensionMessage>) => {
  const message = event.data

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
})

onMounted(() => {
  vscode.postMessage({ type: 'ready' })
})
</script>

<template>
  <main class="chat">
    <header class="toolbar">
      <div>
        <h1>Aria</h1>
        <p :title="baseUrl">{{ statusText }}</p>
      </div>
      <div class="actions">
        <button type="button" title="Set API key" @click="setApiKey">
          Key
        </button>
      </div>
    </header>

    <section ref="scrollHost" class="messages" aria-label="Chat messages">
      <article
        v-for="message in messages"
        :key="message.id"
        class="message"
        :class="`message-${message.role}`"
      >
        <div class="role">{{ message.role }}</div>
        <p>{{ message.text }}</p>
      </article>
      <article v-if="loading" class="message message-assistant">
        <div class="role">assistant</div>
        <p>Thinking...</p>
      </article>
    </section>

    <form class="composer" @submit.prevent="sendMessage">
      <textarea
        v-model="input"
        rows="3"
        placeholder="Ask Aria..."
        :disabled="loading"
        @keydown="onKeydown"
      />
      <button type="submit" :disabled="!canSend">Send</button>
    </form>
  </main>
</template>
