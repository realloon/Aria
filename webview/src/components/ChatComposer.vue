<script setup lang="ts">
defineProps<{
  canSend: boolean
  loading: boolean
}>()

const input = defineModel<string>({ required: true })

defineEmits<{
  keydown: [event: KeyboardEvent]
  send: []
}>()
</script>

<template>
  <form class="composer" @submit.prevent="$emit('send')">
    <textarea
      v-model="input"
      rows="3"
      placeholder="Ask Aria..."
      :disabled="loading"
      @keydown="$emit('keydown', $event)"
    />
    <button type="submit" :disabled="!canSend">Send</button>
  </form>
</template>
