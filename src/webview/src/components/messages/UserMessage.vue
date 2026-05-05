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
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-focusBorder);
  border-radius: 4px;
  padding: 4px 6px;
}
</style>
