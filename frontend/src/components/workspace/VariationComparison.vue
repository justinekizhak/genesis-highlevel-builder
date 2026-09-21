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
import VariationPreview from '@/components/workspace/VariationPreview.vue'
import { responseUiCopy } from '@/lib/variation-activity'
import type { VariationFinalist } from '@/types/generation'

const props = defineProps<{
  finalists: [VariationFinalist, VariationFinalist]
  selectingCandidateId?: string
  error?: string
  bridgeEnabled?: boolean
  canCancel?: boolean
  activeResponse?: 1 | 2
}>()

const emit = defineEmits<{
  select: [candidateId: string]
  cancel: []
  'open-preview': [finalist: VariationFinalist]
}>()

const root = ref<HTMLElement>()
const responseGrid = ref<HTMLElement>()
const responseShare = ref(50)
const expandedCandidateId = ref<string>()
const isSelecting = computed(() => Boolean(props.selectingCandidateId))
const selectingLabel = computed(() => (
  props.finalists.findIndex((finalist) => finalist.candidateId === props.selectingCandidateId) + 1
))
const displayError = computed(() => responseUiCopy(props.error ?? ''))
const responseGridStyle = computed(() => ({
  '--response-one-share': `${responseShare.value}fr`,
  '--response-two-share': `${100 - responseShare.value}fr`,
}))
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
    gsap.fromTo('.variation-cell', { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.65, stagger: 0.1, ease: 'power3.out' })
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

function toggleExpand(candidateId: string) {
  expandedCandidateId.value = expandedCandidateId.value === candidateId ? undefined : candidateId
}

function startResponseResize(event: PointerEvent) {
  const total = (responseGrid.value?.offsetWidth ?? 0) - 6
  if (total <= 0) return
  const startX = event.clientX
  const startShare = responseShare.value
  const move = (moveEvent: PointerEvent) => {
    responseShare.value = Math.min(75, Math.max(25, startShare + ((moveEvent.clientX - startX) / total) * 100))
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    document.body.classList.remove('is-resizing-panels')
  }
  document.body.classList.add('is-resizing-panels')
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop, { once: true })
  window.addEventListener('pointercancel', stop, { once: true })
}

function resizeResponsesWithKeyboard(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  responseShare.value = Math.min(75, Math.max(25, responseShare.value + (event.key === 'ArrowRight' ? 3 : -3)))
}
</script>

<template>
  <section
    ref="root"
    class="variation-stage-root"
    :data-reduced-motion="String(reduceMotion)"
    aria-label="Choose a response"
  >
    <p v-if="isSelecting" class="variation-status-line" aria-live="polite">
      Applying Response {{ selectingLabel }}…
    </p>

    <p v-if="error" class="variation-error" role="alert">
      <IconAlertTriangle :size="15" aria-hidden="true" />
      <span>{{ displayError }}</span>
    </p>

    <div
      ref="responseGrid"
      class="variation-grid"
      :class="{ 'is-expanded': Boolean(expandedCandidateId) }"
      :style="responseGridStyle"
    >
      <template v-for="(finalist, index) in finalists" :key="finalist.candidateId">
        <div
          v-if="!expandedCandidateId || expandedCandidateId === finalist.candidateId"
          :id="`variation-panel-${finalist.candidateId}`"
          class="variation-cell"
          data-response-panel
          :aria-label="`Response ${index + 1}`"
          :class="{ 'is-mobile-active': !activeResponse || activeResponse === index + 1 }"
        >
          <VariationPreview
            :finalist="finalist"
            :label="`Response ${index + 1}`"
            :selecting="selectingCandidateId === finalist.candidateId"
            :busy="isSelecting"
            :bridge-enabled="bridgeEnabled"
            :expanded="expandedCandidateId === finalist.candidateId"
            @select="choose"
            @toggle-expand="toggleExpand"
            @open-preview="emit('open-preview', $event)"
          />
        </div>
        <div
          v-if="index === 0 && !expandedCandidateId"
          class="response-resizer"
          role="separator"
          aria-label="Resize response previews"
          aria-orientation="vertical"
          aria-valuemin="25"
          aria-valuemax="75"
          :aria-valuenow="Math.round(responseShare)"
          tabindex="0"
          @pointerdown.prevent="startResponseResize"
          @keydown="resizeResponsesWithKeyboard"
        ><span /></div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.variation-stage-root {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: var(--canvas, #11110f);
}

.variation-status-line,
.variation-error {
  margin: 0;
  padding: 10px 16px;
  font-size: 13px;
  border-bottom: 1px solid var(--border, #30312c);
}

.variation-status-line {
  grid-row: 1;
  color: var(--text-muted, #9b9b93);
}

.variation-error {
  grid-row: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #c85b54;
}

.variation-grid {
  grid-row: 3;
  display: grid;
  grid-template-columns: minmax(280px, var(--response-one-share)) 6px minmax(280px, var(--response-two-share));
  grid-auto-flow: dense;
  gap: 0;
  min-height: 0;
  height: 100%;
}

.variation-grid.is-expanded {
  grid-template-columns: minmax(0, 1fr);
}

.response-resizer {
  position: relative;
  z-index: 3;
  min-width: 6px;
  cursor: col-resize;
  background: #0d0e0c;
  touch-action: none;
}

.response-resizer::before {
  position: absolute;
  inset: 0 2px;
  content: '';
  background: var(--border, #30312c);
  transition: background-color 120ms ease;
}

.response-resizer:hover::before,
.response-resizer:focus-visible::before { background: var(--accent, #dfb85f); }

.variation-cell {
  display: grid;
  min-width: 0;
  min-height: 0;
}

@media (max-width: 1020px) {
  .variation-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .response-resizer { display: none; }

  .variation-cell {
    display: none;
  }

  .variation-cell.is-mobile-active {
    display: grid;
  }
}
</style>
