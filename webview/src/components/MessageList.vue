<script setup lang="ts">
import type { ChatMessage } from '../types/chat.js'

defineProps<{
  loading: boolean
  messages: ChatMessage[]
}>()

const scrollHost = defineModel<HTMLElement | null>('scrollHost', { required: true })
</script>

<template>
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
</template>
