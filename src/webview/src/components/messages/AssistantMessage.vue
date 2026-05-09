<script setup lang="ts">
import type { ThoughtBlock } from '../../../../types/chat.js'
import MarkdownRenderer from '../MarkdownRenderer.vue'

defineProps<{
  thoughts?: ThoughtBlock[]
  text: string
}>()

function formatWorkSummary(thought: ThoughtBlock): string {
  const verb = thought.state === 'running' ? 'Working' : 'Worked'

  return `${verb} for ${formatDuration(thought)}`
}

function formatDuration(thought: ThoughtBlock): string {
  const durationMs = (thought.finishedAt ?? Date.now()) - thought.startedAt

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
    <div v-for="thought in thoughts" :key="thought.id" class="thought">
      <details v-if="thought.tools.length" class="work">
        <summary>{{ formatWorkSummary(thought) }}</summary>
        <MarkdownRenderer
          v-if="thought.reasoning"
          :source="thought.reasoning"
        />

        <ul class="tools">
          <li
            v-for="tool in thought.tools"
            :key="tool.id"
            class="tool"
            :class="`tool-${tool.state}`"
          >
            <span class="tool-status" aria-hidden="true" />
            <span class="tool-name">{{ tool.name }}</span>
          </li>
        </ul>
      </details>

      <details v-else-if="thought.reasoning" class="reasoning">
        <summary>
          {{ thought.state === 'running' ? 'Thinking' : 'Thought' }}
        </summary>
        <MarkdownRenderer :source="thought.reasoning" />
      </details>
    </div>

    <MarkdownRenderer :source="text" />
  </section>
</template>

<style scoped>
.thought {
  margin-bottom: 6px;
}

.reasoning,
.work {
  color: var(--vscode-descriptionForeground);
  margin-bottom: 4px;

  & summary {
    cursor: pointer;
    user-select: none;
    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }
  }

  & div {
    margin-top: 4px;
  }
}

.work .tools {
  margin-top: 6px;
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
