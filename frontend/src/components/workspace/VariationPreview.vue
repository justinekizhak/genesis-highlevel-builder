<script setup lang="ts">
import { computed } from 'vue'
import { IconLoader2 } from '@tabler/icons-vue'
import { Button } from '@/components/ui/button'
import { buildSrcdoc } from '@/lib/srcdoc'
import VariationEvidence from '@/components/workspace/VariationEvidence.vue'
import type { VariationFinalist } from '@/types/generation'

const props = defineProps<{
  finalist: VariationFinalist
  selecting: boolean
  busy: boolean
  bridgeEnabled?: boolean
}>()

const emit = defineEmits<{ select: [candidateId: string] }>()

// Finalist source is only ever rendered through the existing sandboxed srcdoc path.
const previewDocument = computed(() => buildSrcdoc(props.finalist.files, {
  enableHighLevelBridge: Boolean(props.bridgeEnabled),
}))
</script>

<template>
  <article class="variation-preview" :aria-label="finalist.displayName">
    <header class="variation-preview-header">
      <h3>{{ finalist.displayName }}</h3>
      <p>{{ finalist.summary }}</p>
    </header>

    <div class="variation-preview-frame">
      <iframe
        :title="`${finalist.displayName} preview`"
        sandbox="allow-scripts allow-forms"
        :srcdoc="previewDocument"
      />
    </div>

    <VariationEvidence :strengths="finalist.strengths" :risks="finalist.risks" :label="finalist.displayName" />

    <div class="variation-preview-action">
      <Button
        type="button"
        data-select-finalist
        :disabled="busy"
        @click="emit('select', finalist.candidateId)"
      >
        <IconLoader2 v-if="selecting" :size="15" class="spin" aria-hidden="true" />
        <span>Use {{ finalist.displayName }}</span>
      </Button>
    </div>
  </article>
</template>

<style scoped>
.variation-preview {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  min-width: 0;
  min-height: 0;
  background: var(--surface, #131412);
  border-left: 1px solid var(--border, #30312c);
}

.variation-preview:first-child {
  border-left: 0;
}

.variation-preview-header {
  padding: 16px 16px 12px;
  display: grid;
  gap: 4px;
  min-width: 0;
}

.variation-preview-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text, #f2f1ed);
}

.variation-preview-header p {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-muted, #9b9b93);
  max-width: 60ch;
}

.variation-preview-frame {
  min-height: 0;
  background: var(--surface-sunken, #0a0b0a);
  border-block: 1px solid var(--border, #30312c);
}

.variation-preview-frame iframe {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 260px;
  border: 0;
}

.variation-preview-action {
  padding: 0 16px 16px;
}

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
