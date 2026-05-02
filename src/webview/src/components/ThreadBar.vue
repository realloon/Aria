<script setup lang="ts">
import type { ChatThreadSummary } from '../types/chat.js'

const props = defineProps<{
  activeThreadId: string
  disabled: boolean
  threads: ChatThreadSummary[]
}>()

const emit = defineEmits<{
  create: []
  delete: [threadId: string]
  select: [threadId: string]
}>()

function selectThread(event: Event): void {
  const target = event.target as HTMLSelectElement
  emit('select', target.value)
}
</script>

<template>
  <header class="thread-bar">
    <select
      aria-label="Thread"
      :disabled="disabled"
      :value="activeThreadId"
      @change="selectThread"
    >
      <option
        v-for="thread in threads"
        :key="thread.id"
        :value="thread.id"
      >
        {{ thread.title }}
      </option>
    </select>

    <button
      type="button"
      title="New Thread"
      aria-label="New Thread"
      :disabled="disabled"
      @click="emit('create')"
    >
      +
    </button>

    <button
      type="button"
      title="Delete Thread"
      aria-label="Delete Thread"
      :disabled="disabled || props.threads.length <= 1"
      @click="emit('delete', activeThreadId)"
    >
      x
    </button>
  </header>
</template>

<style scoped>
.thread-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px 28px;
  gap: 6px;
  padding: 8px 0;
}

.thread-bar select,
.thread-bar button {
  height: 28px;
  border: 1px solid var(--vscode-dropdown-border, var(--vscode-focusBorder));
  border-radius: 4px;
}

.thread-bar select {
  min-width: 0;
  color: var(--vscode-dropdown-foreground);
  background: var(--vscode-dropdown-background);
  padding: 0 6px;
}

.thread-bar button {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  padding: 0;
}

.thread-bar button:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

.thread-bar button:disabled,
.thread-bar select:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
