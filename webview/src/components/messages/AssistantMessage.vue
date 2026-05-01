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
  max-width: 100%;
}
</style>
