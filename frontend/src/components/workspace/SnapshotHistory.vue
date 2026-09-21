<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { IconArchive, IconClockPause, IconFileDiff, IconHistory, IconPencil, IconSparkles, IconX } from '@tabler/icons-vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import DiffFileList from '@/components/workspace/DiffFileList.vue'
import type { GenerationFileDiff } from '@/lib/generation-diff'
import type { ProjectSnapshot } from '@/types/generation'

type EditableField = 'message' | 'description'

const props = defineProps<{
  snapshots: ProjectSnapshot[]
  loading: boolean
  error: string
  currentSnapshotId?: string
  restoringSnapshotId?: string
  expandedSnapshotId?: string
  compareDiff: GenerationFileDiff[]
  compareLoading: boolean
  compareError: string
  renamingSnapshotId?: string
  renameError?: string
}>()

const emit = defineEmits<{
  restore: [snapshot: ProjectSnapshot]
  compareVariation: [variationSetId: string]
  compare: [snapshot: ProjectSnapshot, index: number]
  editField: [snapshot: ProjectSnapshot, field: EditableField, value: string]
}>()

const kindLabels: Record<string, string> = {
  generation: 'Generation',
  manual: 'Manual edit',
  backup: 'Backup',
  partial: 'Partial',
}

const kindIcons: Record<string, typeof IconSparkles> = {
  generation: IconSparkles,
  manual: IconPencil,
  backup: IconArchive,
  partial: IconClockPause,
}

function kindLabel(snapshot: ProjectSnapshot) {
  return (snapshot.kind && kindLabels[snapshot.kind]) ?? snapshot.provider
}

function kindIcon(snapshot: ProjectSnapshot) {
  return (snapshot.kind && kindIcons[snapshot.kind]) ?? IconSparkles
}

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fullTimestamp(iso: string) {
  return new Date(iso).toLocaleString()
}

const selectedIndex = computed(() => props.snapshots.findIndex((snapshot) => snapshot.id === props.expandedSnapshotId))
const selectedSnapshot = computed(() => selectedIndex.value >= 0 ? props.snapshots[selectedIndex.value] : undefined)

function snapshotMessage(snapshot: ProjectSnapshot) {
  return snapshot.label || snapshot.prompt || snapshot.summary || 'Saved workspace state'
}

function fieldValue(snapshot: ProjectSnapshot, field: EditableField) {
  return field === 'message' ? snapshotMessage(snapshot) : snapshot.summary ?? ''
}

const editing = ref<{ snapshotId: string; field: EditableField }>()
const messageEditable = ref<HTMLElement>()
const descriptionEditable = ref<HTMLElement>()

function isEditing(snapshot: ProjectSnapshot, field: EditableField) {
  return editing.value?.snapshotId === snapshot.id && editing.value?.field === field
}

function selectAllText(element: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function startEditing(snapshot: ProjectSnapshot, field: EditableField) {
  editing.value = { snapshotId: snapshot.id, field }
  nextTick(() => {
    const element = field === 'message' ? messageEditable.value : descriptionEditable.value
    if (!element) return
    element.focus()
    selectAllText(element)
  })
}

// Editable elements are v-once, so canceling just unmounts the DOM node without
// ever writing the unsaved text back into snapshot state.
function cancelEditing() {
  editing.value = undefined
}

function saveOnBlur(snapshot: ProjectSnapshot, field: EditableField, element: HTMLElement) {
  if (!isEditing(snapshot, field)) return
  editing.value = undefined
  const value = element.innerText.replace(/\s+/g, ' ').trim()
  if (value === fieldValue(snapshot, field)) return
  emit('editField', snapshot, field, value)
}

function discardOnEscape(event: KeyboardEvent) {
  // preventDefault so the dialog's own Escape-to-close handler (reka-ui's
  // DismissableLayer, which listens document-wide) doesn't also fire.
  event.preventDefault()
  cancelEditing()
  ;(event.target as HTMLElement).blur()
}

function pasteAsPlainText(event: ClipboardEvent) {
  event.preventDefault()
  const text = event.clipboardData?.getData('text/plain') ?? ''
  document.execCommand('insertText', false, text)
}
</script>

<template>
  <div v-if="loading" class="snapshot-workspace-state" role="status">
    <IconHistory :size="28" class="spin" />
    <strong>Loading snapshot history</strong>
    <span>Preparing saved versions and file changes.</span>
  </div>
  <p v-else-if="error" class="form-error snapshot-workspace-error" role="alert">{{ error }}</p>
  <div v-else-if="!snapshots.length" class="snapshot-workspace-state">
    <IconHistory :size="28" />
    <strong>No snapshots yet</strong>
    <span>Generate or edit an app to create the first saved version.</span>
  </div>
  <div v-else class="snapshot-browser">
    <aside class="snapshot-sidebar" aria-label="Saved versions">
      <div class="snapshot-sidebar-heading">
        <strong>Saved versions</strong>
        <span>{{ snapshots.length }}</span>
      </div>
      <TooltipProvider :delay-duration="150">
        <ol class="snapshot-list">
          <li v-for="(snapshot, index) in snapshots" :key="snapshot.id">
            <button
              type="button"
              class="snapshot-list-item"
              :class="{ 'is-selected': snapshot.id === props.expandedSnapshotId, 'is-current': snapshot.id === props.currentSnapshotId }"
              :aria-current="snapshot.id === props.currentSnapshotId ? 'true' : undefined"
              @click="snapshot.id !== props.expandedSnapshotId && emit('compare', snapshot, index)"
            >
              <Tooltip>
                <TooltipTrigger as="span" class="snapshot-list-marker" :class="`kind-${snapshot.kind}`">
                  <component :is="kindIcon(snapshot)" :size="13" :stroke-width="2" />
                </TooltipTrigger>
                <TooltipContent side="top">{{ kindLabel(snapshot) }}</TooltipContent>
              </Tooltip>
              <span class="snapshot-list-content">
                <Badge v-if="snapshot.id === props.currentSnapshotId" class="snapshot-current-badge">Current</Badge>
                <strong>{{ snapshotMessage(snapshot) }}</strong>
                <span class="snapshot-list-footer">
                  <time :title="fullTimestamp(snapshot.createdAt)">{{ relativeTime(snapshot.createdAt) }}</time>
                  <span>{{ snapshot.fileCount }} files</span>
                </span>
              </span>
            </button>
          </li>
        </ol>
      </TooltipProvider>
    </aside>

    <section v-if="selectedSnapshot" class="snapshot-detail">
      <header class="snapshot-detail-header">
        <div class="snapshot-detail-copy">
          <div class="snapshot-detail-meta">
            <IconFileDiff :size="16" />
            <time :title="fullTimestamp(selectedSnapshot.createdAt)">{{ fullTimestamp(selectedSnapshot.createdAt) }}</time>
            <span>{{ kindLabel(selectedSnapshot) }}</span>
          </div>
          <div v-if="isEditing(selectedSnapshot, 'message')" class="snapshot-field-edit">
            <h3
              v-once
              ref="messageEditable"
              class="snapshot-message-heading is-editing"
              contenteditable
              role="textbox"
              aria-label="Snapshot title"
              @blur="saveOnBlur(selectedSnapshot, 'message', $event.target as HTMLElement)"
              @keydown.enter.prevent="($event.target as HTMLElement).blur()"
              @keydown.escape="discardOnEscape"
              @paste="pasteAsPlainText"
            >{{ fieldValue(selectedSnapshot, 'message') }}</h3>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Discard changes"
              title="Discard changes"
              @mousedown.prevent="cancelEditing"
            >
              <IconX :size="16" />
            </Button>
          </div>
          <h3
            v-else
            class="snapshot-message-heading"
            title="Double-click to rename"
            @dblclick="startEditing(selectedSnapshot, 'message')"
          >
            {{ snapshotMessage(selectedSnapshot) }}
          </h3>

          <p v-if="props.renameError" class="form-error snapshot-workspace-error" role="alert">{{ props.renameError }}</p>

          <div v-if="isEditing(selectedSnapshot, 'description')" class="snapshot-field-edit snapshot-field-edit-block">
            <p
              v-once
              ref="descriptionEditable"
              class="snapshot-detail-description is-editing"
              contenteditable
              role="textbox"
              aria-label="Snapshot description"
              @blur="saveOnBlur(selectedSnapshot, 'description', $event.target as HTMLElement)"
              @keydown.enter.exact.prevent="($event.target as HTMLElement).blur()"
              @keydown.escape="discardOnEscape"
              @paste="pasteAsPlainText"
            >{{ fieldValue(selectedSnapshot, 'description') }}</p>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Discard changes"
              title="Discard changes"
              @mousedown.prevent="cancelEditing"
            >
              <IconX :size="16" />
            </Button>
          </div>
          <p
            v-else
            class="snapshot-detail-description"
            :class="{ 'is-empty': !selectedSnapshot.summary }"
            title="Double-click to edit"
            @dblclick="startEditing(selectedSnapshot, 'description')"
          >
            {{ selectedSnapshot.summary || 'Add a description…' }}
          </p>
        </div>
        <Button
          v-if="selectedSnapshot.variationSetId"
          size="sm"
          variant="secondary"
          data-compare-finalist
          @click="emit('compareVariation', selectedSnapshot.variationSetId)"
        >
          Compare finalist
        </Button>
        <Button
          size="sm"
          :disabled="selectedSnapshot.id === props.currentSnapshotId || Boolean(props.restoringSnapshotId)"
          @click="emit('restore', selectedSnapshot)"
        >
          {{ props.restoringSnapshotId === selectedSnapshot.id ? 'Restoring…' : selectedSnapshot.id === props.currentSnapshotId ? 'Current version' : 'Restore version' }}
        </Button>
      </header>

      <div class="snapshot-diff-canvas">
        <p v-if="compareLoading" class="snapshot-empty">Loading comparison…</p>
        <p v-else-if="compareError" class="form-error snapshot-workspace-error" role="alert">{{ compareError }}</p>
        <DiffFileList
          v-else
          :files="compareDiff"
          :empty-message="selectedIndex === snapshots.length - 1 ? 'This is the first snapshot. There is no earlier version to compare.' : 'No file changes between these two snapshots.'"
        />
      </div>
    </section>

    <section v-else class="snapshot-detail-empty">
      <IconFileDiff :size="28" />
      <strong>Select a saved version</strong>
      <span>Choose a version to inspect its request, result, and file changes.</span>
    </section>
  </div>
</template>
