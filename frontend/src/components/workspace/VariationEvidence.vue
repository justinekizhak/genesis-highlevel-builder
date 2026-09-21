<script setup lang="ts">
import { computed } from 'vue'
import { IconAlertTriangle, IconCheck } from '@tabler/icons-vue'

const props = defineProps<{
  strengths: string[]
  risks: string[]
  label: string
}>()

// Restrained progressive disclosure: three each is the most a reader compares side by side.
const visibleStrengths = computed(() => props.strengths.slice(0, 3))
const visibleRisks = computed(() => props.risks.slice(0, 3))
</script>

<template>
  <div class="variation-evidence" :aria-label="`What stands out about ${label}`">
    <ul v-if="visibleStrengths.length" class="evidence-list">
      <li v-for="strength in visibleStrengths" :key="strength">
        <IconCheck :size="14" aria-hidden="true" />
        <span class="variation-evidence-word">{{ strength }}</span>
      </li>
    </ul>
    <ul v-if="visibleRisks.length" class="evidence-list is-risk">
      <li v-for="risk in visibleRisks" :key="risk">
        <IconAlertTriangle :size="14" aria-hidden="true" />
        <span class="variation-evidence-word">{{ risk }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.variation-evidence {
  display: grid;
  gap: 10px;
  padding: 12px 16px 16px;
  min-width: 0;
}

.evidence-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.evidence-list li {
  display: grid;
  grid-template-columns: 16px 1fr;
  align-items: start;
  gap: 8px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-soft, #c5c4bd);
}

.evidence-list svg {
  margin-top: 2px;
  color: #85c98f;
}

.evidence-list.is-risk svg {
  color: #efc973;
}

.evidence-list.is-risk li {
  color: var(--text-muted, #9b9b93);
}

@media (max-width: 800px) {
  .variation-evidence {
    grid-auto-flow: column;
    grid-auto-columns: minmax(220px, 1fr);
    overflow-x: auto;
    scroll-snap-type: x proximity;
  }

  .evidence-list {
    scroll-snap-align: start;
  }
}
</style>
