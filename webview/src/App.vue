<script setup lang="ts">
import ChatComposer from './components/ChatComposer.vue'
import MessageList from './components/MessageList.vue'
import { useChat } from './hooks/useChat.js'

const {
  canSend,
  input,
  loading,
  messages,
  scrollHost,
  sendMessage,
} = useChat()
</script>

<template>
  <MessageList
    v-model:scroll-host="scrollHost"
    :loading="loading"
    :messages="messages"
  />

  <ChatComposer
    v-model="input"
    :can-send="canSend"
    :loading="loading"
    @send="sendMessage"
  />
</template>
