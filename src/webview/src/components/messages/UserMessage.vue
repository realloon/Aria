<script setup lang="ts">
defineProps<{
  text: string
}>()
</script>

<template>
  <article class="message">
    <p>{{ text }}</p>
  </article>
</template>

<style scoped>
.message {
  font-family: system-ui;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-focusBorder);
  border-radius: 8px;
  padding: 6px 8px;
}
</style>
