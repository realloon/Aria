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

<style scoped>
.composer {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
}

.composer textarea {
  width: 100%;
  min-height: 74px;
  resize: vertical;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px;
  padding: 8px;
}

.composer textarea:focus {
  outline: 1px solid var(--vscode-focusBorder);
}
</style>
