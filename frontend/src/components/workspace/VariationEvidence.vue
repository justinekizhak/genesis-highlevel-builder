<script setup lang="ts">
defineProps<{
  standout: string
  label: string
}>()
</script>

<template>
  <div class="variation-evidence" :aria-label="`What stands out about ${label}`">
    <p v-if="standout" class="variation-standout variation-evidence-word">{{ standout }}</p>
  </div>
</template>

<style scoped>
.variation-evidence {
  padding: 12px 16px 16px;
  min-width: 0;
}

.variation-standout {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-soft, #c5c4bd);
}
</style>
