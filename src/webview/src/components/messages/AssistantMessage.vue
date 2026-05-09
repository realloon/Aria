<script setup lang="ts">
import type { ThoughtBlock } from '../../../../types/chat.js'
import MarkdownRenderer from '../MarkdownRenderer.vue'

defineProps<{
  thoughts?: ThoughtBlock[]
  text: string
}>()
</script>

<template>
  <section>
    <div
      v-for="thought in thoughts"
      :key="thought.id"
      class="thought"
    >
      <details v-if="thought.reasoning" class="reasoning">
        <summary>{{ thought.state === 'running' ? 'Thinking' : 'Thought' }}</summary>
        <MarkdownRenderer :source="thought.reasoning" />
      </details>

      <ul v-if="thought.tools.length" class="tools">
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
    </div>

    <MarkdownRenderer :source="text" />
  </section>
</template>

<style scoped>
.thought {
  margin-bottom: 6px;
}

.reasoning {
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
