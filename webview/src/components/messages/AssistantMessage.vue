<script setup lang="ts">
import MarkdownIt from 'markdown-it'
import { computed } from 'vue'

const props = defineProps<{
  reasoning?: string
  text: string
}>()

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
})

const renderedReasoning = computed(() =>
  props.reasoning ? markdown.render(props.reasoning) : '',
)
const renderedText = computed(() => markdown.render(props.text))
</script>

<template>
  <section>
    <details v-if="reasoning" class="reasoning">
      <summary>{{ text ? 'thought' : 'Thinking' }}</summary>
      <div class="markdown" v-html="renderedReasoning" />
    </details>

    <div class="markdown" v-html="renderedText" />
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

.markdown {
  line-height: 1.55;
  overflow-wrap: anywhere;

  :deep(p),
  :deep(ul),
  :deep(ol),
  :deep(pre),
  :deep(blockquote) {
    margin: 0 0 8px;
  }

  :deep(p:last-child),
  :deep(ul:last-child),
  :deep(ol:last-child),
  :deep(pre:last-child),
  :deep(blockquote:last-child) {
    margin-bottom: 0;
  }

  :deep(pre) {
    overflow-x: auto;
    padding: 8px;
    background: var(--vscode-textCodeBlock-background);
    border-radius: 4px;
  }

  :deep(code) {
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
  }

  :deep(:not(pre) > code) {
    padding: 1px 3px;
    background: var(--vscode-textCodeBlock-background);
    border-radius: 3px;
  }

  :deep(blockquote) {
    padding-left: 8px;
    color: var(--vscode-descriptionForeground);
    border-left: 2px solid var(--vscode-textBlockQuote-border);
  }

  :deep(a) {
    color: var(--vscode-textLink-foreground);
  }
}
</style>
