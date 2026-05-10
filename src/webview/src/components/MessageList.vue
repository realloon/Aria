<script setup lang="ts">
import type { ChatMessage } from '../../../types/chat.js'
import AssistantMessage from './messages/AssistantMessage.vue'
import UserMessage from './messages/UserMessage.vue'

defineProps<{
  loading: boolean
  messages: ChatMessage[]
}>()

defineModel<HTMLElement | null>('scrollHost', { required: true })
</script>

<template>
  <section ref="scrollHost" class="message-list">
    <component
      v-for="message in messages"
      :key="message.id"
      :is="message.role === 'user' ? UserMessage : AssistantMessage"
      :trace="message.trace"
      :trace-started-at="message.traceStartedAt"
      :trace-finished-at="message.traceFinishedAt"
      :text="message.text"
    />
  </section>
</template>

<style scoped>
.message-list {
  flex-grow: 1;

  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;

  padding-right: 20px;
  margin-right: -20px;
  scrollbar-width: thin;

  padding-bottom: 8px;
}
</style>
