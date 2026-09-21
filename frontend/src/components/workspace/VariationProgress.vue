<script setup lang="ts">
import { computed } from 'vue'
import { IconLoader2 } from '@tabler/icons-vue'
import { variationPhaseCopy } from '@/composables/useVariationGeneration'
import type { CandidateProgress, VariationPhase } from '@/types/generation'

const props = defineProps<{
  phase: VariationPhase
  candidates: Record<string, CandidateProgress>
  gradingMode?: 'full' | 'deterministic_fallback'
  gradingProgress?: { completedCount: number; totalCount: number }
  activeResponse?: 1 | 2
}>()

/** Copy is keyed to reducer phases only; nothing here can claim progress the server did not report. */
const headline = computed(() => variationPhaseCopy[props.phase])

const completedCount = computed(() => Object.values(props.candidates).filter((candidate) => candidate.phase === 'complete').length)

const footerDetail = computed(() => (
  props.phase === 'grading' && props.gradingProgress
    ? `${props.gradingProgress.completedCount} of ${props.gradingProgress.totalCount} scored`
    : `${completedCount.value} of 4 generated`
))
</script>

<template>
  <section class="variation-progress" aria-label="Preparing response previews" aria-live="polite">
    <article
      v-for="position in 2"
      :key="position"
      data-response-placeholder
      class="response-placeholder"
      :class="{ 'is-mobile-active': !activeResponse || activeResponse === position }"
      :aria-label="`Response ${position} preview is loading`"
    >
      <header>
        <span>Response {{ position }}</span>
        <span class="response-loading-status"><IconLoader2 :size="14" class="spin" />Preparing preview</span>
      </header>
      <div class="response-placeholder-canvas" aria-hidden="true">
        <span class="skeleton skeleton-nav" />
        <span class="skeleton skeleton-title" />
        <span class="skeleton skeleton-copy" />
        <span class="skeleton skeleton-card" />
        <span class="skeleton skeleton-card is-short" />
      </div>
      <footer>
        <span>{{ headline }}</span>
        <span>{{ footerDetail }}</span>
      </footer>
    </article>
    <p v-if="gradingMode === 'deterministic_fallback'" class="variation-progress-note">
      Automated comparison was limited, so the final responses are ranked using structural checks.
    </p>
  </section>
</template>

<style scoped>
.variation-progress {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-flow: dense;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: var(--surface-sunken, #0a0b0a);
}

.response-placeholder {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--border, #30312c);
  background: var(--surface, #131412);
}

.response-placeholder:first-child { border-left: 0; }

.response-placeholder header,
.response-placeholder footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border, #30312c);
  color: var(--text, #f2f1ed);
  font-size: 13px;
  font-weight: 600;
}

.response-placeholder footer {
  border-top: 1px solid var(--border, #30312c);
  border-bottom: 0;
  color: var(--text-muted, #9b9b93);
  font-size: 11px;
  font-weight: 400;
}

.response-loading-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #d8b35e;
  font-size: 11px;
  font-weight: 500;
}

.response-placeholder-canvas {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: 28px 56px 34px minmax(110px, 1fr);
  gap: 14px;
  align-content: start;
  margin: 14px;
  padding: clamp(24px, 4vw, 54px);
  overflow: hidden;
  border: 1px solid #34352f;
  border-radius: 10px;
  background: #10110f;
}

.skeleton {
  display: block;
  border-radius: 6px;
  background: linear-gradient(100deg, #1b1c18 20%, #292820 45%, #1b1c18 70%);
  background-size: 220% 100%;
  animation: skeleton-shift 1.8s linear infinite;
}

.skeleton-nav { grid-column: 1 / -1; width: 36%; }
.skeleton-title { grid-column: 1 / -1; width: 78%; }
.skeleton-copy { grid-column: 1 / -1; width: 58%; }
.skeleton-card { min-height: 100%; }
.skeleton-card.is-short { opacity: .72; }

.variation-progress-note {
  position: absolute;
  right: 20px;
  bottom: 58px;
  left: 20px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #5d4b27;
  border-radius: 8px;
  background: #201b11;
  color: #efc973;
  font-size: 11px;
}

.spin {
  animation: variation-progress-spin 900ms linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .spin { animation: none; }
  .skeleton { animation: none; }
}

@keyframes variation-progress-spin {
  to { transform: rotate(360deg); }
}

@keyframes skeleton-shift {
  to { background-position: -220% 0; }
}

@media (max-width: 1020px) {
  .variation-progress { grid-template-columns: minmax(0, 1fr); }
  .response-placeholder { display: none; border-left: 0; }
  .response-placeholder.is-mobile-active { display: grid; }
}
</style>
