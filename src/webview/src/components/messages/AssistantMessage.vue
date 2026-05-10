<script setup lang="ts">
import { computed } from 'vue'
import type { ChatTraceItem } from '../../../../types/chat.js'
import MarkdownRenderer from '../MarkdownRenderer.vue'

const props = defineProps<{
  trace?: ChatTraceItem[]
  traceStartedAt?: number
  traceFinishedAt?: number
  text: string
}>()

const traceItems = computed(() => props.trace ?? [])

function formatTraceSummary() {
  if (!props.traceFinishedAt) {
    return 'Thinking'
  }

  const duration = getDurationMs()

  return duration < 1000 ? 'Thought' : `Thought for ${formatDuration(duration)}`
}

function getDurationMs() {
  const startedAt = props.traceStartedAt ?? Date.now()
  const finishedAt = props.traceFinishedAt ?? Date.now()

  return finishedAt - startedAt
}

function formatDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return '0s'
  }

  const totalSeconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes === 0) {
    return `${seconds}s`
  }

  return `${minutes}m ${seconds}s`
}
</script>

<template>
  <section>
    <details v-if="traceItems.length" class="reasoning">
      <summary>{{ formatTraceSummary() }}</summary>

      <div v-for="item in traceItems" :key="item.id" class="trace-item">
        <MarkdownRenderer
          v-if="item.type === 'reasoning'"
          :source="item.text ?? ''"
        />

        <ul v-if="item.type === 'tools'" class="tools">
          <li
            v-for="tool in item.tools ?? []"
            :key="tool.id"
            class="tool"
            :class="`tool-${tool.state}`"
          >
            <span class="tool-status" aria-hidden="true" />
            <span class="tool-name">{{ tool.name }}</span>
          </li>
        </ul>
      </div>
    </details>

    <MarkdownRenderer :source="text" />
  </section>
</template>

<style scoped>
.trace-item {
  margin-bottom: 6px;
}

.reasoning {
  color: var(--vscode-descriptionForeground);
  margin-bottom: 4px;

  & summary {
    display: flex;
    align-items: center;
    gap: 1ch;

    cursor: pointer;
    user-select: none;
    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }

    &::after {
      content: '';
      width: 0;
      height: 0;
      border-block: 4px solid transparent;
      border-right: 5px solid currentColor;
      transition: transform 120ms ease;
    }
  }

  &[open] summary::after {
    transform: rotate(-90deg);
  }

  & div {
    margin-top: 4px;
  }
}

.tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 0 6px;
  padding: 0;
  list-style: none;
  color: var(--vscode-descriptionForeground);
}

.tool {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.tool-status {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  border: 1px solid var(--vscode-descriptionForeground);
}

.tool-running .tool-status {
  border-color: var(--vscode-progressBar-background);
  background: var(--vscode-progressBar-background);
}

.tool-done .tool-status {
  background: var(--vscode-descriptionForeground);
}

.tool-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
