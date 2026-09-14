/**
 * Monaco text-model registry. Models live independently of any mounted editor, so a generation can
 * keep writing into files that are not currently on screen.
 *
 * Streaming appends through `applyEdits` rather than replacing the whole value: an incremental edit
 * leaves the cursor, selection, scroll position and undo stack intact, which is what lets the editor
 * follow the write position. `setValue` resets all four on every call.
 */
import { monaco } from '@/lib/monaco'

const models = new Map<string, monaco.editor.ITextModel>()

export function getModel(path: string) {
  return models.get(path) ?? null
}

export function getOrCreateModel(path: string, content = '', language = 'html') {
  const existing = models.get(path)
  if (existing && !existing.isDisposed()) return existing
  const model = monaco.editor.createModel(content, language)
  models.set(path, model)
  return model
}

/** Replaces content as a single undoable edit, so the undo stack survives. */
export function setModelValue(path: string, content: string) {
  const model = getOrCreateModel(path, content)
  if (model.getValue() === content) return model
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null)
  return model
}

export function appendToModel(path: string, text: string) {
  const model = getOrCreateModel(path)
  const end = model.getFullModelRange().getEndPosition()
  model.applyEdits([{ range: new monaco.Range(end.lineNumber, end.column, end.lineNumber, end.column), text }])
  return model
}

export function disposeModel(path: string) {
  models.get(path)?.dispose()
  models.delete(path)
}

export function disposeAllModels() {
  for (const model of models.values()) model.dispose()
  models.clear()
}
