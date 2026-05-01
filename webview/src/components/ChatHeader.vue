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
