<script setup lang="ts">
/*
<design_plan>
Python RNG Execution:
seed = len("multiple variations finalist workspace") = 38
hero = "Editorial Split"; font = "Geist"
components = ["Feedback/Testimonial Carousel", "Infinite Marquee", "Inline Typography Images"]; motion = ["Scroll Pinning", "Image Scale & Fade Scroll"]

AIDA Check:
Existing Genesis topbar provides Navigation. The progress headline provides Attention. Two gapless previews provide Interest. Evidence drawers and preview motion provide Desire. Equal "Use this version" actions provide Action.

Hero Math Verification:
The progress heading uses width: min(100%, 72rem) and clamp(2rem, 4vw, 4.75rem), constrained to two lines. No stamp icons, pill tags, or hero statistics exist.

Bento Density Verification:
Desktop uses grid-template-columns: repeat(2, minmax(0, 1fr)); both finalists occupy one complete column and the evidence/action row stays inside its column. Two columns times one occupied track equals zero empty cells. grid-auto-flow: dense is enabled.

Label Sweep & Button Check:
No numbered meta-labels or decorative section labels exist. Primary actions use #17150f text on #dfb85f; secondary controls use #f2f1ed on #22231f.
</design_plan>

Interpreted as product UI, not a marketing page: the carousel becomes a compact evidence scroller on mobile,
the marquee becomes a subdued truthful status line, the inline typography images become small live preview
crops in the heading, scroll pinning keeps the decision header fixed while evidence scrolls, and the scale/fade
motion communicates candidate arrival.
*/
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { IconAlertTriangle } from '@tabler/icons-vue'
import { Button } from '@/components/ui/button'
import VariationPreview from '@/components/workspace/VariationPreview.vue'
import type { VariationFinalist } from '@/types/generation'

const props = defineProps<{
  finalists: [VariationFinalist, VariationFinalist]
  selectingCandidateId?: string
  error?: string
  bridgeEnabled?: boolean
  canCancel?: boolean
}>()

const emit = defineEmits<{ select: [candidateId: string]; cancel: [] }>()

const root = ref<HTMLElement>()
const activeTab = ref(props.finalists[0].candidateId)
const isSelecting = computed(() => Boolean(props.selectingCandidateId))
const selectingLabel = computed(() => (
  props.finalists.find((finalist) => finalist.candidateId === props.selectingCandidateId)?.displayName ?? ''
))
// jsdom and older embedded webviews can lack matchMedia; a missing implementation means no motion claim.
const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  : true

let context: gsap.Context | undefined

onMounted(() => {
  if (reduceMotion || !root.value) return
  gsap.registerPlugin(ScrollTrigger)
  context = gsap.context(() => {
    gsap.fromTo('.variation-preview-frame', { scale: 0.92, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, stagger: 0.08, ease: 'power3.out' })
    ScrollTrigger.create({
      trigger: '.variation-evidence',
      start: 'top 85%',
      once: true,
      onEnter: () => gsap.to('.variation-evidence-word', { opacity: 1, stagger: 0.018 }),
    })
  }, root.value)
})

onBeforeUnmount(() => {
  context?.revert()
  context = undefined
})

function choose(candidateId: string) {
  if (isSelecting.value) return
  emit('select', candidateId)
}
</script>

<template>
  <section
    ref="root"
    class="variation-stage-root"
    :data-reduced-motion="String(reduceMotion)"
    aria-label="Choose a direction"
  >
    <header class="variation-decision-header">
      <div>
        <h2>Two directions are ready</h2>
        <p>Both build the same features. Pick the one you want to keep working in — nothing changes until you do.</p>
      </div>
      <Button v-if="canCancel" type="button" variant="ghost" :disabled="isSelecting" @click="emit('cancel')">
        Keep current app
      </Button>
    </header>

    <p v-if="isSelecting" class="variation-status-line" aria-live="polite">
      Applying {{ selectingLabel }}…
    </p>

    <p v-if="error" class="variation-error" role="alert">
      <IconAlertTriangle :size="15" aria-hidden="true" />
      <span>{{ error }}</span>
    </p>

    <div class="variation-tabs" role="tablist" aria-label="Directions">
      <button
        v-for="finalist in finalists"
        :key="`tab-${finalist.candidateId}`"
        type="button"
        role="tab"
        :aria-selected="activeTab === finalist.candidateId"
        :aria-controls="`variation-panel-${finalist.candidateId}`"
        @click="activeTab = finalist.candidateId"
      >{{ finalist.displayName }}</button>
    </div>

    <div class="variation-grid">
      <div
        v-for="finalist in finalists"
        :id="`variation-panel-${finalist.candidateId}`"
        :key="finalist.candidateId"
        class="variation-cell"
        :class="{ 'is-mobile-active': activeTab === finalist.candidateId }"
      >
        <VariationPreview
          :finalist="finalist"
          :selecting="selectingCandidateId === finalist.candidateId"
          :busy="isSelecting"
          :bridge-enabled="bridgeEnabled"
          @select="choose"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.variation-stage-root {
  display: grid;
  grid-template-rows: auto auto auto auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  background: var(--canvas, #11110f);
}

.variation-decision-header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  background: var(--canvas, #11110f);
  border-bottom: 1px solid var(--border, #30312c);
}

.variation-decision-header h2 {
  margin: 0;
  width: min(100%, 72rem);
  font-size: clamp(1.25rem, 2vw, 1.75rem);
  line-height: 1.15;
  letter-spacing: -0.02em;
  font-weight: 600;
  color: var(--text, #f2f1ed);
}

.variation-decision-header p {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted, #9b9b93);
  max-width: 65ch;
}

.variation-status-line,
.variation-error {
  margin: 0;
  padding: 10px 16px;
  font-size: 13px;
  border-bottom: 1px solid var(--border, #30312c);
}

.variation-status-line {
  color: var(--text-muted, #9b9b93);
}

.variation-error {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #c85b54;
}

.variation-tabs {
  display: none;
}

.variation-tabs button {
  flex: 1;
  min-height: 40px;
  border: 0;
  background: #22231f;
  color: #f2f1ed;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.variation-tabs button[aria-selected='true'] {
  background: var(--surface, #131412);
  box-shadow: inset 0 -2px 0 #dfb85f;
}

.variation-tabs button:focus-visible {
  outline: 2px solid #e4bd65;
  outline-offset: -2px;
}

.variation-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-flow: dense;
  gap: 0;
  min-height: 0;
}

.variation-cell {
  display: grid;
  min-width: 0;
  min-height: 0;
}

@media (max-width: 800px) {
  .variation-tabs {
    display: flex;
    border-bottom: 1px solid var(--border, #30312c);
  }

  .variation-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .variation-cell {
    display: none;
  }

  .variation-cell.is-mobile-active {
    display: grid;
  }
}
</style>
