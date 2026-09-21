<script setup lang="ts">
import { computed } from 'vue'
import { IconCheck, IconLoader2, IconMinus } from '@tabler/icons-vue'
import { variationPhaseCopy } from '@/composables/useVariationGeneration'
import type { CandidateProgress, VariationPhase } from '@/types/generation'

const props = defineProps<{
  phase: VariationPhase
  candidates: Record<string, CandidateProgress>
  gradingMode?: 'full' | 'deterministic_fallback'
}>()

/** Copy is keyed to reducer phases only; nothing here can claim progress the server did not report. */
const headline = computed(() => variationPhaseCopy[props.phase])

const candidateStepCopy: Record<CandidateProgress['phase'], string> = {
  started: 'Starting',
  summary: 'Planning the layout',
  markup: 'Writing the markup',
  styles: 'Writing the styles',
  logic: 'Wiring the behavior',
  complete: 'Ready to compare',
  failed: "Didn't finish",
}

const ordered = computed(() => Object.values(props.candidates).sort((left, right) => left.index - right.index))

function stepLabel(candidate: CandidateProgress) {
  return candidateStepCopy[candidate.phase]
}
</script>

<template>
  <section class="variation-progress" aria-label="Preparing multiple directions">
    <h2 class="variation-progress-headline">{{ headline }}</h2>
    <p class="variation-progress-sub">
      Your project stays exactly as it is until you pick one.
    </p>

    <p v-if="gradingMode === 'deterministic_fallback'" class="variation-progress-note">
      Automated comparison was limited, so the two directions below are ranked on structural checks alone.
    </p>

    <ol class="variation-progress-list" aria-live="polite">
      <li
        v-for="(candidate, position) in ordered"
        :key="candidate.candidateId"
        data-candidate-status
        :class="{ 'is-done': candidate.phase === 'complete', 'is-failed': candidate.phase === 'failed' }"
      >
        <span class="status-icon" aria-hidden="true">
          <IconCheck v-if="candidate.phase === 'complete'" :size="15" />
          <IconMinus v-else-if="candidate.phase === 'failed'" :size="15" />
          <IconLoader2 v-else :size="15" class="spin" />
        </span>
        <span class="status-name">Direction {{ position + 1 }}</span>
        <span class="status-step">{{ stepLabel(candidate) }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.variation-progress {
  display: grid;
  align-content: start;
  gap: 12px;
  padding: clamp(24px, 5vw, 64px) 16px;
  width: min(100%, 72rem);
  margin-inline: auto;
  min-width: 0;
}

.variation-progress-headline {
  margin: 0;
  font-size: clamp(2rem, 4vw, 4.75rem);
  line-height: 1.05;
  letter-spacing: -0.02em;
  font-weight: 600;
  color: var(--text, #f2f1ed);
  max-width: 18ch;
}

.variation-progress-sub,
.variation-progress-note {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-muted, #9b9b93);
  max-width: 62ch;
}

.variation-progress-note {
  color: #efc973;
}

.variation-progress-list {
  display: grid;
  gap: 0;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--border, #30312c);
}

.variation-progress-list li {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 13px 4px;
  border-bottom: 1px solid var(--border, #30312c);
  font-size: 14px;
  color: var(--text-soft, #c5c4bd);
}

.status-icon {
  display: grid;
  place-items: center;
  color: var(--text-muted, #9b9b93);
}

.variation-progress-list li.is-done .status-icon { color: #85c98f; }
.variation-progress-list li.is-failed { color: var(--text-muted, #9b9b93); }

.status-step {
  font-size: 13px;
  color: var(--text-muted, #9b9b93);
}

.spin {
  animation: variation-progress-spin 900ms linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .spin { animation: none; }
}

@keyframes variation-progress-spin {
  to { transform: rotate(360deg); }
}
</style>
