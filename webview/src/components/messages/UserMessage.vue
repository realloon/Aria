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
  align-self: end;

  width: fit-content;
  background: var(--vscode-editor-background);
  border-radius: 8px;
  padding: 6px 8px;
}
</style>
