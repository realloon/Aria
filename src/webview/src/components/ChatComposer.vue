<script setup lang="ts">
import { computed, useTemplateRef, nextTick } from 'vue'
import type { ChatModelOption } from '../../../types/chat.js'
import SendIcon from './icons/SendIcon.vue'

const props = defineProps<{
  canSend: boolean
  loading: boolean
  models: ChatModelOption[]
  options: string[]
  selectedModel: string
}>()

const emit = defineEmits<{
  choose: [option: string]
  send: []
  selectModel: [model: string]
}>()

const input = defineModel<string>({ required: true })
const textarea = useTemplateRef('textarea')
const selectedModelLabel = computed(
  () =>
    props.models.find(model => model.id === props.selectedModel)?.label ??
    props.selectedModel,
)

async function submit() {
  emit('send')
  await nextTick()
  textarea.value?.focus()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void submit()
  }
}

function selectModel(event: Event) {
  const select = event.target as HTMLSelectElement
  emit('selectModel', select.value)
}

function getModelSelectWidth(model: string) {
  return `calc(${model.length}ch + 20px)`
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <div v-if="props.options.length > 0" class="options">
      <button
        v-for="option in props.options"
        :key="option"
        type="button"
        class="option"
        :disabled="props.loading"
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
      :readonly="props.loading"
      @keydown="onKeydown"
    />

    <footer class="active-bar">
      <div v-if="props.models.length > 1" class="model-picker">
        <label class="model-select">
          <select
            :value="props.selectedModel"
            :disabled="props.loading"
            :aria-label="`Select model, current: ${selectedModelLabel}`"
            :style="{ width: getModelSelectWidth(selectedModelLabel) }"
            @change="selectModel"
          >
            <option
              v-for="model in props.models"
              :key="model.id"
              :value="model.id"
            >
              {{ model.label }}
            </option>
          </select>
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
        </label>
      </div>

      <button class="send-button" type="submit" :disabled="!props.canSend">
        <SendIcon />
      </button>
    </footer>
  </form>
</template>

<style scoped>
.composer {
  display: flex;
  flex-direction: column;
  outline: 1px solid var(--vscode-focusBorder);
  border-radius: 6px;
  margin-bottom: 6px;
}

.composer textarea {
  color: var(--vscode-input-foreground);
  background: transparent;
  padding-inline: 8px;
  padding-block-start: 8px;
  border: transparent;
  outline: none;
  resize: none;
}

.active-bar {
  display: flex;
  align-items: center;
  padding-inline: 8px 4px;
  padding-block-end: 4px;
}

.active-bar .model-picker {
  font-family: monospace;
  transform: translateX(-4px);
}

.active-bar .send-button {
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

  svg {
    width: 12px;
    height: 12px;
  }
}

.model-select {
  position: relative;
  display: flex;
  align-items: center;
  color: var(--vscode-descriptionForeground);
}

.model-select select {
  color: inherit;
  background: transparent;
  appearance: none;
  padding: 4px 16px 4px 4px;
  border: none;
  border-radius: 4px;
  outline: none;
  font-family: inherit;
  font-size: 0.875rem;
  cursor: pointer;
  max-width: 220px;

  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:hover:not(:disabled) {
    background: var(--vscode-toolbar-hoverBackground);
  }

  &:disabled {
    opacity: 0.5;
  }
}

.chevron {
  position: absolute;
  right: 4px;
  flex: none;
  width: 10px;
  height: 10px;
  display: block;
  color: inherit;
  pointer-events: none;
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;

  .option {
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
}
</style>
