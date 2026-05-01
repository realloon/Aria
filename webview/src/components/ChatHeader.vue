<script setup lang="ts">
defineProps<{
  baseUrl: string
  statusText: string
}>()

defineEmits<{
  setApiKey: []
}>()
</script>

<template>
  <header class="toolbar">
    <div>
      <h1>Aria</h1>
      <p :title="baseUrl">{{ statusText }}</p>
    </div>
    <div class="actions">
      <button type="button" title="Set API key" @click="$emit('setApiKey')">
        Key
      </button>
    </div>
  </header>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
}

.toolbar h1 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.toolbar p {
  margin: 2px 0 0;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}

.actions {
  display: flex;
  gap: 6px;
}
</style>
