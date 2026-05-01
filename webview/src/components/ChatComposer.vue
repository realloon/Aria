<script setup lang="ts">
import { nextTick, ref } from 'vue'

defineProps<{
  canSend: boolean
  loading: boolean
}>()

const input = defineModel<string>({ required: true })
const textarea = ref<HTMLTextAreaElement | null>(null)

const emit = defineEmits<{
  send: []
}>()

async function submit(): Promise<void> {
  emit('send')
  await nextTick()
  textarea.value?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void submit()
  }
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <textarea
      ref="textarea"
      v-model="input"
      rows="2"
      placeholder="Ask Aria..."
      :readonly="loading"
      @keydown="onKeydown"
    />

    <footer>
      <button type="submit" :disabled="!canSend" aria-label="Send message">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M8 13V3M8 3L4 7M8 3L12 7"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </footer>
  </form>
</template>

<style scoped>
.composer {
  display: flex;
  flex-direction: column;
  padding: 8px;
  border: 1px solid var(--vscode-focusBorder);
  border-radius: 6px;
  margin-bottom: 6px;
}

.composer textarea {
  color: var(--vscode-input-foreground);
  background: transparent;
  /* padding: 8px 42px 34px 8px; */
  border: transparent;
  outline: none;
  resize: none;
}

.composer button {
  display: flex;
  justify-content: center;
  align-items: center;

  width: 22px;
  height: 22px;

  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);

  padding: 0;
  border: none;
  border-radius: 50%;
  margin-left: auto;

  &:hover {
    background: var(--vscode-button-hoverBackground);
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
}

.composer svg {
  width: 12px;
  height: 12px;
}
</style>
