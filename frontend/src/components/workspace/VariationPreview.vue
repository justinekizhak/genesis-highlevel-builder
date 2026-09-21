<script setup lang="ts">
import { computed, ref } from 'vue'
import { IconArrowsMaximize, IconArrowsMinimize, IconChartDots, IconExternalLink, IconLoader2 } from '@tabler/icons-vue'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { buildSrcdoc } from '@/lib/srcdoc'
import { responseUiCopy } from '@/lib/variation-activity'
import VariationEvidence from '@/components/workspace/VariationEvidence.vue'
import type { VariationFinalist } from '@/types/generation'

const props = defineProps<{
  finalist: VariationFinalist
  label: string
  selecting: boolean
  busy: boolean
  bridgeEnabled?: boolean
  expanded?: boolean
}>()

const emit = defineEmits<{
  select: [candidateId: string]
  'toggle-expand': [candidateId: string]
  'open-preview': [finalist: VariationFinalist]
}>()
const evidenceOpen = ref(false)

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
      <div class="variation-preview-header-actions">
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="evidence-trigger"
          data-evidence-trigger
          :aria-label="`Why ${label} stands out`"
          @click="evidenceOpen = true"
        >
          <IconChartDots :size="14" />
          <span>Why it stands out</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-open-new-tab
          :aria-label="`Open ${label} in a new tab`"
          :title="`Open ${label} in a new tab`"
          @click="emit('open-preview', finalist)"
        >
          <IconExternalLink :size="16" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-toggle-expand
          :aria-label="expanded ? `Restore split view` : `Expand ${label}`"
          :title="expanded ? 'Restore split view' : `Expand ${label}`"
          @click="emit('toggle-expand', finalist.candidateId)"
        >
          <IconArrowsMinimize v-if="expanded" :size="16" />
          <IconArrowsMaximize v-else :size="16" />
        </Button>
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
  </article>
</template>

<style scoped>
.variation-preview {
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 13px 14px;
  min-width: 0;
}

.variation-preview-header > div { min-width: 0; }

.variation-preview-header-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
}

.evidence-trigger {
  border-color: #35362f;
  background: #1a1b17;
  color: #c9b077;
  font-size: 12px;
}

.evidence-trigger:hover {
  border-color: #6a562d;
  background: #221f14;
  color: #efc973;
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

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}

@keyframes variation-spin {
  to { transform: rotate(360deg); }
}
</style>
