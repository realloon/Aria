<script setup lang="ts">
import ChatComposer from './components/ChatComposer.vue'
import ChatHeader from './components/ChatHeader.vue'
import MessageList from './components/MessageList.vue'
import { useChat } from './hooks/useChat.js'

const {
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
} = useChat()
</script>

<template>
  <main class="chat">
    <ChatHeader
      :base-url="baseUrl"
      :status-text="statusText"
      @set-api-key="setApiKey"
    />

    <MessageList
      v-model:scroll-host="scrollHost"
      :loading="loading"
      :messages="messages"
    />

    <ChatComposer
      v-model="input"
      :can-send="canSend"
      :loading="loading"
      @keydown="onKeydown"
      @send="sendMessage"
    />
  </main>
</template>

<style scoped>
.chat {
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: 100vh;
  min-width: 0;
}
</style>
