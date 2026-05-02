<script setup lang="ts">
import { nextTick, ref } from 'vue'

const props = defineProps<{
  canSend: boolean
  loading: boolean
  models: string[]
  options: string[]
  selectedModel: string
}>()

const input = defineModel<string>({ required: true })
const textarea = ref<HTMLTextAreaElement | null>(null)
const modelMenuOpen = ref(false)

const emit = defineEmits<{
  choose: [option: string]
  send: []
  selectModel: [model: string]
}>()

async function submit(): Promise<void> {
  emit('send')
  modelMenuOpen.value = false
  await nextTick()
  textarea.value?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void submit()
  }
}

function toggleModelMenu(): void {
  if (props.loading) {
    return
  }

  modelMenuOpen.value = !modelMenuOpen.value
}

function closeModelMenu(): void {
  modelMenuOpen.value = false
}

function selectModel(model: string): void {
  emit('selectModel', model)
  closeModelMenu()
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <div v-if="options.length > 0" class="options">
      <button
        v-for="option in options"
        :key="option"
        type="button"
        class="option"
        :disabled="loading"
        @click="emit('choose', option)"
      >
        {{ option }}
      </button>
    </div>

    <textarea
      ref="textarea"
      v-model="input"
      rows="2"
      placeholder="Ask Aria..."
      :readonly="loading"
      @keydown="onKeydown"
    />

    <footer @focusout="closeModelMenu">
      <div v-if="models.length > 1" class="model-picker">
        <button
          type="button"
          class="model-trigger"
          aria-haspopup="menu"
          :aria-expanded="modelMenuOpen"
          :disabled="loading"
          @click="toggleModelMenu"
          @keydown.esc.stop.prevent="closeModelMenu"
        >
          <span>{{ selectedModel }}</span>
          <svg
            aria-hidden="true"
            class="chevron"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M4 6.5L8 10L12 6.5"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>

        <div
          v-if="modelMenuOpen"
          class="model-menu"
          role="menu"
          @keydown.esc.stop.prevent="closeModelMenu"
        >
          <button
            v-for="model in models"
            :key="model"
            type="button"
            role="menuitemradio"
            :aria-checked="model === selectedModel"
            class="model-option"
            @mousedown.prevent
            @click="selectModel(model)"
          >
            <span>{{ model }}</span>
            <span v-if="model === selectedModel" aria-hidden="true">✓</span>
          </button>
        </div>
      </div>

      <button
        class="send-button"
        type="submit"
        :disabled="!canSend"
        aria-label="Send message"
      >
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
  padding: 0;
  border: transparent;
  outline: none;
  resize: none;
}

.composer footer {
  display: flex;
  align-items: center;
}

.model-picker {
  font-family: monospace;
  position: relative;
  transform: translateX(-4px);
}

.model-trigger {
  display: flex;
  align-items: center;

  color: var(--vscode-descriptionForeground);
  background: transparent;
  padding: 4px;
  border: none;
  border-radius: 4px;
  font-size: 0.875rem;
}

.model-trigger span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-trigger:hover:not(:disabled),
.model-trigger[aria-expanded='true'] {
  color: var(--vscode-foreground);
  background: var(--vscode-toolbar-hoverBackground);
}

.model-trigger:disabled {
  opacity: 0.5;
}

.chevron {
  flex: none;
  width: 10px;
  height: 10px;
  display: block;
}

.model-menu {
  position: absolute;
  bottom: calc(100% + 2px);
  left: 0;
  z-index: 10;

  display: flex;
  flex-direction: column;
  padding: 1px;

  background: var(--vscode-dropdown-background);
  border: 1px solid var(--vscode-dropdown-border, var(--vscode-focusBorder));
  border-radius: 6px;
  box-shadow: 0 4px 12px rgb(0 0 0 / 28%);
}

.model-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;

  color: var(--vscode-dropdown-foreground);
  background: transparent;
  padding: 5px 7px;
  border: none;
  border-radius: 4px;
  font-size: 0.875rem;
  text-align: left;
}

.model-option span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-option:hover {
  background: var(--vscode-list-hoverBackground);
}

.send-button {
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

.options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.options .option {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
  padding: 4px 8px;
  border: none;
  border-radius: 4px;

  &:hover {
    background: var(--vscode-button-secondaryHoverBackground);
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
