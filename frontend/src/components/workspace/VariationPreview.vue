<script setup lang="ts">
import { computed, ref } from 'vue'
import { IconArrowsMaximize, IconArrowsMinimize, IconChartDots, IconExternalLink, IconLoader2, IconShieldCheck } from '@tabler/icons-vue'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { buildSrcdoc } from '@/lib/srcdoc'
import { responseUiCopy } from '@/lib/variation-activity'
import VariationEvidence from '@/components/workspace/VariationEvidence.vue'
import VariationGradingDetails from '@/components/workspace/VariationGradingDetails.vue'
import type { VariationFinalist } from '@/types/generation'

const props = defineProps<{
  finalist: VariationFinalist
  label: string
  selecting: boolean
  busy: boolean
  bridgeEnabled?: boolean
  expanded?: boolean
  gradingMode?: 'full' | 'deterministic_fallback'
  requestedCount?: number
  eligibleCount?: number
}>()

const emit = defineEmits<{
  select: [candidateId: string]
  'toggle-expand': [candidateId: string]
  'open-preview': [finalist: VariationFinalist]
}>()
const evidenceOpen = ref(false)
const gradingDetailsOpen = ref(false)

// Finalist source is only ever rendered through the existing sandboxed srcdoc path.
const previewDocument = computed(() => buildSrcdoc(props.finalist.files, {
  enableHighLevelBridge: Boolean(props.bridgeEnabled),
}))
const displayStandout = computed(() => responseUiCopy(props.finalist.standout))

</script>

<template>
  <article class="variation-preview" :aria-label="label">
    <header class="variation-preview-header">
      <div>
        <h3>{{ label }}</h3>
      </div>
      <div class="variation-preview-header-actions" role="group" :aria-label="`${label} actions`">
        <div class="variation-insight-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="evidence-trigger"
            data-evidence-trigger
            :aria-label="`Why ${label} stands out`"
            :title="`Why ${label} stands out`"
            @click="evidenceOpen = true"
          >
            <IconChartDots :size="14" />
            <span class="action-label action-label-primary">Why it stands out</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="grading-details-trigger"
            data-grading-details-trigger
            :aria-label="`How ${label} was scored`"
            :title="`How ${label} was scored`"
            @click="gradingDetailsOpen = true"
          >
            <IconShieldCheck :size="14" />
            <span class="action-label action-label-secondary">Scoring details</span>
          </Button>
        </div>
        <span class="variation-action-divider" aria-hidden="true" />
        <div class="variation-preview-tools">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="preview-tool-trigger"
            data-open-new-tab
            :aria-label="`Open ${label} in a new tab`"
            :title="`Open ${label} in a new tab`"
            @click="emit('open-preview', finalist)"
          >
            <IconExternalLink :size="15" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="preview-tool-trigger"
            data-toggle-expand
            :aria-label="expanded ? `Restore split view` : `Expand ${label}`"
            :title="expanded ? 'Restore split view' : `Expand ${label}`"
            @click="emit('toggle-expand', finalist.candidateId)"
          >
            <IconArrowsMinimize v-if="expanded" :size="15" />
            <IconArrowsMaximize v-else :size="15" />
          </Button>
        </div>
      </div>
    </header>

    <div class="variation-preview-frame">
      <iframe
        :title="`${label} preview`"
        sandbox="allow-scripts allow-forms"
        :srcdoc="previewDocument"
      />
    </div>

    <div class="variation-preview-action">
      <Button
        type="button"
        data-select-finalist
        :disabled="busy"
        @click="emit('select', finalist.candidateId)"
      >
        <IconLoader2 v-if="selecting" :size="15" class="spin" aria-hidden="true" />
        <span>Use {{ label }}</span>
      </Button>
    </div>

    <Sheet v-model:open="evidenceOpen">
      <SheetContent class="response-evidence-sheet" side="right">
        <SheetHeader class="response-evidence-header">
          <SheetTitle>Why {{ label }} stands out</SheetTitle>
          <SheetDescription>The one thing that sets this response apart.</SheetDescription>
        </SheetHeader>
        <VariationEvidence :standout="displayStandout" :label="label" />
      </SheetContent>
    </Sheet>

    <Sheet v-model:open="gradingDetailsOpen">
      <SheetContent class="grading-details-sheet" side="right">
        <SheetHeader class="grading-details-header">
          <SheetTitle>How {{ label }} was scored</SheetTitle>
          <SheetDescription>The rubric, evidence, and design brief behind this response.</SheetDescription>
        </SheetHeader>
        <VariationGradingDetails
          :label="label"
          :grading-mode="gradingMode"
          :internal-rank="finalist.internalRank"
          :requested-count="requestedCount"
          :eligible-count="eligibleCount"
          :brief="finalist.brief"
          :rubric="finalist.rubric"
        />
      </SheetContent>
    </Sheet>
  </article>
</template>

<style scoped>
.variation-preview {
  container-type: inline-size;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: var(--surface, #131412);
  border-left: 1px solid var(--border, #30312c);
}

.variation-preview:first-child {
  border-left: 0;
}

.variation-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 12px 14px;
  min-width: 0;
}

.variation-preview-header > div { min-width: 0; }

.variation-preview-header-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 5px;
  padding: 3px;
  border: 1px solid #30312c;
  border-radius: 11px;
  background: linear-gradient(180deg, rgb(32 33 29 / 92%), rgb(22 23 20 / 96%));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.035), 0 8px 22px rgb(0 0 0 / 0.14);
}

.variation-insight-actions,
.variation-preview-tools {
  display: flex;
  align-items: center;
  gap: 3px;
}

.variation-action-divider {
  width: 1px;
  height: 18px;
  margin: 0 2px;
  background: #383933;
}

.evidence-trigger {
  border-color: #5a4a2a;
  background: #292315;
  color: #e6c374;
  font-size: 12px;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.045);
}

.evidence-trigger:hover {
  transform: translateY(-1px);
  border-color: #8a7039;
  background: #342a18;
  color: #f1cf7e;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.07), 0 5px 14px rgb(0 0 0 / 0.2);
}

.grading-details-trigger {
  border-color: transparent;
  background: transparent;
  color: #aaa9a1;
  font-size: 12px;
}

.grading-details-trigger:hover {
  transform: translateY(-1px);
  border-color: #41423b;
  background: #292a25;
  color: #e2e1da;
}

.preview-tool-trigger {
  border: 1px solid transparent;
  border-radius: 7px;
  color: #8d8e86;
}

.preview-tool-trigger:hover {
  transform: translateY(-1px);
  border-color: #41423b;
  background: #292a25;
  color: #f2f1ed;
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.16);
}

.evidence-trigger:focus-visible,
.grading-details-trigger:focus-visible,
.preview-tool-trigger:focus-visible {
  border-color: #cda952;
  box-shadow: 0 0 0 2px #11120f, 0 0 0 4px rgb(223 184 95 / 0.48);
}

.variation-preview-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text, #f2f1ed);
}

.variation-preview-header p {
  display: -webkit-box;
  margin: 4px 0 0;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-muted, #9b9b93);
  max-width: 60ch;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.variation-preview-frame {
  min-height: 0;
  margin: 0 12px 12px;
  overflow: hidden;
  border: 1px solid var(--border, #30312c);
  border-radius: 10px;
  background: var(--surface-sunken, #0a0b0a);
}

.variation-preview-frame iframe {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 260px;
  border: 0;
}

.variation-preview-action {
  padding: 12px 16px 16px;
  border-top: 1px solid var(--border, #30312c);
}

.response-evidence-sheet {
  width: min(460px, 92vw);
  padding: 22px;
  overflow-y: auto;
  background: #111210;
}

.response-evidence-header { padding-right: 32px; }

.grading-details-sheet {
  width: min(560px, 94vw);
  max-width: 560px;
  padding: 22px;
  overflow-y: auto;
  background: #111210;
}

.grading-details-header { padding-right: 32px; }

.variation-preview-action :deep(button) {
  width: 100%;
  min-height: 40px;
  background: #dfb85f;
  color: #17150f;
}

.variation-preview-action :deep(button:hover:not(:disabled)) {
  background: #e7c36f;
}

.spin {
  animation: variation-spin 900ms linear infinite;
}

@container (max-width: 650px) {
  .action-label-secondary { display: none; }

  .grading-details-trigger {
    width: 32px;
    padding-inline: 0;
  }
}

@container (max-width: 510px) {
  .variation-preview-header { gap: 8px; }
  .action-label-primary { display: none; }

  .evidence-trigger {
    width: 32px;
    padding-inline: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }

  .evidence-trigger,
  .grading-details-trigger,
  .preview-tool-trigger {
    transition: none;
  }

  .evidence-trigger:hover,
  .grading-details-trigger:hover,
  .preview-tool-trigger:hover {
    transform: none;
  }
}

@keyframes variation-spin {
  to { transform: rotate(360deg); }
}
</style>
