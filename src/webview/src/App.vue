<script setup lang="ts">
import ChatComposer from './components/ChatComposer.vue'
import MessageList from './components/MessageList.vue'
import ThreadBar from './components/ThreadBar.vue'
import { useChat } from './hooks/useChat.js'

const {
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
} = useChat()
</script>

<template>
  <ThreadBar
    :active-thread-id="activeThreadId"
    :disabled="threadControlsDisabled"
    :threads="threads"
    @create="createThread"
    @delete="deleteThread"
    @select="selectThread"
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
    :options="userOptions"
    @choose="chooseOption"
    @send="sendMessage"
  />
</template>
