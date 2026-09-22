<script setup lang="ts">
import { computed } from 'vue'
import type { VariationBrief, VariationRubric } from '@/types/generation'

const props = defineProps<{
  label: string
  gradingMode?: 'full' | 'deterministic_fallback'
  internalRank?: number
  requestedCount?: number
  eligibleCount?: number
  brief?: VariationBrief
  rubric?: VariationRubric
}>()

/** Criterion maxima mirror the fixed 100-point rubric in functions/src/generate/variation-types.ts. */
const rubricCriteria: Array<{ key: keyof Omit<VariationRubric, 'standout' | 'evidence'>; label: string; max: number }> = [
  { key: 'featureFidelity', label: 'Feature fidelity', max: 30 },
  { key: 'functionalCorrectness', label: 'Functional correctness', max: 25 },
  { key: 'robustness', label: 'Robustness', max: 15 },
  { key: 'usability', label: 'Usability', max: 10 },
  { key: 'accessibility', label: 'Accessibility', max: 10 },
  { key: 'responsiveness', label: 'Responsiveness', max: 5 },
  { key: 'maintainability', label: 'Maintainability', max: 5 },
]

const densityLabels: Record<VariationBrief['density'], string> = {
  compact: 'Compact',
  balanced: 'Balanced',
  spacious: 'Spacious',
}

const total = computed(() => {
  if (!props.rubric) return undefined
  return rubricCriteria.reduce((sum, criterion) => sum + props.rubric![criterion.key], 0)
})

const totalMax = rubricCriteria.reduce((sum, criterion) => sum + criterion.max, 0)

const contextLine = computed(() => {
  if (!props.requestedCount || !props.eligibleCount) return undefined
  const rank = props.internalRank ? ` It ranked #${props.internalRank} of those by total score.` : ''
  return `${props.eligibleCount} of ${props.requestedCount} independently generated candidates passed automated checks and were graded.${rank}`
})
</script>

<template>
  <div class="grading-details" :aria-label="`How ${label} was scored`">
    <p class="grading-mode" :data-mode="gradingMode ?? 'unknown'">
      <span v-if="gradingMode === 'full'">Scored by an independent AI rubric pass, blind to which brief or order produced each candidate.</span>
      <span v-else-if="gradingMode === 'deterministic_fallback'">The AI grader was unavailable for this set, so ranking fell back to automated structural checks only — no rubric scores below.</span>
      <span v-else>Grading details are unavailable for this set.</span>
    </p>

    <p v-if="contextLine" class="grading-context">{{ contextLine }}</p>

    <section v-if="rubric" class="grading-rubric" aria-label="Rubric scores">
      <h4>Rubric score{{ total !== undefined ? ` — ${total}/${totalMax}` : '' }}</h4>
      <ul class="rubric-list">
        <li v-for="criterion in rubricCriteria" :key="criterion.key" class="rubric-row">
          <span class="rubric-label">{{ criterion.label }}</span>
          <span class="rubric-bar" role="presentation">
            <span class="rubric-bar-fill" :style="{ width: `${(rubric[criterion.key] / criterion.max) * 100}%` }" />
          </span>
          <span class="rubric-score">{{ rubric[criterion.key] }}/{{ criterion.max }}</span>
        </li>
      </ul>

      <div v-if="rubric.evidence.length" class="rubric-evidence">
        <h4>Cited evidence</h4>
        <ul class="evidence-list">
          <li v-for="(item, index) in rubric.evidence" :key="index">
            <code>{{ item.path }}</code> — {{ item.detail }}
          </li>
        </ul>
      </div>
    </section>

    <section v-if="brief" class="grading-brief" aria-label="Design brief">
      <h4>Design brief this response was built from</h4>
      <dl class="brief-list">
        <div>
          <dt>Design intent</dt>
          <dd>{{ brief.designIntent }}</dd>
        </div>
        <div>
          <dt>Information architecture</dt>
          <dd>{{ brief.informationArchitecture }}</dd>
        </div>
        <div>
          <dt>Interaction model</dt>
          <dd>{{ brief.interactionModel }}</dd>
        </div>
        <div>
          <dt>Visual direction</dt>
          <dd>{{ brief.visualDirection }}</dd>
        </div>
        <div>
          <dt>Density</dt>
          <dd>{{ densityLabels[brief.density] }}</dd>
        </div>
      </dl>
      <ul v-if="brief.differentiators.length" class="differentiators-list">
        <li v-for="item in brief.differentiators" :key="item">{{ item }}</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.grading-details {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 4px 16px 16px;
  min-width: 0;
}

.grading-mode,
.grading-context {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-soft, #c5c4bd);
}

.grading-context {
  color: var(--text-muted, #9b9b93);
}

.grading-rubric h4,
.grading-brief h4 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #9b9b93);
}

.rubric-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 0 14px;
  padding: 0;
  list-style: none;
}

.rubric-row {
  display: grid;
  grid-template-columns: 148px minmax(0, 1fr) 48px;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.rubric-label { color: var(--text, #f2f1ed); }

.rubric-bar {
  display: block;
  height: 6px;
  border-radius: 999px;
  background: #262721;
  overflow: hidden;
}

.rubric-bar-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent, #dfb85f);
}

.rubric-score {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted, #9b9b93);
}

.evidence-list,
.differentiators-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-soft, #c5c4bd);
}

.evidence-list code {
  font-size: 12px;
  color: var(--text-muted, #9b9b93);
}

.brief-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0 0 12px;
}

.brief-list dt {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted, #9b9b93);
}

.brief-list dd {
  margin: 2px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-soft, #c5c4bd);
}

.differentiators-list li::before {
  content: '— ';
  color: var(--text-muted, #9b9b93);
}
</style>
