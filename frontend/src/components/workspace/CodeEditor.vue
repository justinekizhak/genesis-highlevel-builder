<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useThrottleFn } from '@vueuse/core'
import { monaco } from '@/lib/monaco'
import { getOrCreateModel } from '@/lib/models'

const props = defineProps<{
  path: string
  readOnly: boolean
  /** Bumped by the parent on every streamed delta and applied edit, so the view can follow along. */
  followTick: number
  streamingPath?: string
  /** Where a set of line edits just landed, for files revised rather than written start to finish. */
  editTarget?: { path: string; line: number }
}>()
const emit = defineEmits<{ change: [content: string] }>()

const containerEl = ref<HTMLElement>()
let editor: monaco.editor.IStandaloneCodeEditor | undefined
let editCaret: monaco.editor.IEditorDecorationsCollection | undefined

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
// Immediate, not the default: with `smoothScrolling` enabled Monaco routes a smooth reveal through
// an animation that never runs for programmatic calls, so the scroll is silently dropped. The
// option still applies to the reader's own scrolling.
const revealWritePosition = useThrottleFn(
  (lineNumber: number) => editor?.revealLine(lineNumber, monaco.editor.ScrollType.Immediate),
  100,
)

function syncModel() {
  if (!editor) return
  const model = getOrCreateModel(props.path)
  if (editor.getModel() !== model) editor.setModel(model)
}

onMounted(() => {
  if (!containerEl.value) return
  editor = monaco.editor.create(containerEl.value, {
    theme: 'vs-dark',
    fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
    fontSize: 13,
    lineHeight: 21,
    padding: { top: 16 },
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'gutter',
    readOnly: props.readOnly,
    cursorSmoothCaretAnimation: reducedMotion.matches ? 'off' : 'on',
    smoothScrolling: !reducedMotion.matches,
  })
  editCaret = editor.createDecorationsCollection([])
  editor.onDidChangeModelContent(() => {
    // Streaming writes go through the model directly; only echo back the user's own edits.
    if (props.readOnly) return
    emit('change', editor?.getValue() ?? '')
  })
  syncModel()
})

onBeforeUnmount(() => {
  editor?.dispose()
  editor = undefined
})

watch(() => props.path, syncModel)
watch(() => props.readOnly, (readOnly) => {
  editor?.updateOptions({ readOnly })
  if (!readOnly) editCaret?.clear()
})

/**
 * End of the last line that actually has text. A streamed chunk usually ends with a newline, which
 * puts the true end position on an empty trailing line — and Monaco renders nothing for a
 * zero-width decoration there, since it has no text span to attach the class to.
 */
function writePosition(model: monaco.editor.ITextModel) {
  let lineNumber = model.getLineCount()
  while (lineNumber > 1 && model.getLineLength(lineNumber) === 0) lineNumber -= 1
  return { lineNumber, column: model.getLineMaxColumn(lineNumber) }
}

watch(() => props.followTick, () => {
  const model = editor?.getModel()
  if (!model) return
  let lineNumber: number
  let column: number
  if (props.streamingPath === props.path) {
    ({ lineNumber, column } = writePosition(model))
  } else if (props.editTarget?.path === props.path) {
    lineNumber = Math.min(props.editTarget.line, model.getLineCount())
    column = model.getLineMaxColumn(lineNumber)
  } else {
    return
  }
  // A decoration rather than the editor's own cursor: Monaco hides that one whenever the editor
  // lacks focus, and focus stays in the chat composer while a generation runs.
  editCaret?.set([{
    range: new monaco.Range(lineNumber, column, lineNumber, column),
    options: { className: 'ai-edit-caret' },
  }])
  void revealWritePosition(lineNumber)
})
</script>

<template>
  <div ref="containerEl" class="code-editor-surface" />
</template>
