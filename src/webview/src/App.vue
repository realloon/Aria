<script setup lang="ts">
import ChatComposer from './components/ChatComposer.vue'
import MessageList from './components/MessageList.vue'
import { useChat } from './hooks/useChat.js'

const {
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
    :models="chatModels"
    :selected-model="selectedChatModel"
    :loading="loading"
    :options="userOptions"
    @choose="chooseOption"
    @select-model="selectChatModel"
    @send="sendMessage"
  />
</template>
