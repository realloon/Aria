<script setup lang="ts">
import MarkdownRenderer from '../MarkdownRenderer.vue'

defineProps<{
  reasoning?: string
  text: string
}>()
</script>

<template>
  <section>
    <details v-if="reasoning" class="reasoning">
      <summary>{{ text ? 'thought' : 'Thinking' }}</summary>
      <MarkdownRenderer :source="reasoning" />
    </details>

    <MarkdownRenderer :source="text" />
  </section>
</template>

<style scoped>
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
</style>
