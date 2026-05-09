<script setup lang="ts">
import { computed } from 'vue'
import markdown from '../utils/markdown.js'

const props = defineProps<{
  source: string
}>()

const renderedSource = computed(() => markdown.render(props.source))
</script>

<template>
  <div class="markdown" v-html="renderedSource" />
</template>

<style scoped>
.markdown {
  line-height: 1.5;
}

.markdown:deep(code) {
  font-family: ui-monospace, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background-color: var(--vscode-editor-background);
}

.markdown:deep(p),
.markdown:deep(pre),
.markdown:deep(ol),
.markdown:deep(ul) {
  margin-block-end: 0.5rem;
}

.markdown:deep(ol),
.markdown:deep(ul) {
  padding-inline-start: 2ch;

  p,
  ol,
  ul {
    margin-block-end: 0.25rem;
  }
}

.markdown:deep(pre) {
  width: 100%;
  padding: 6px 8px;
  border-radius: 4px;
  overflow-x: auto;
  scrollbar-width: none;
  background-color: var(--vscode-editor-background);

  & > code {
    background-color: unset;
  }
}
</style>
