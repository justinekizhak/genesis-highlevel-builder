import { onBeforeUnmount, onMounted } from 'vue'

export type ShortcutBinding = {
  keys: string
  description: string
}

type ShortcutHandler = (event: KeyboardEvent) => void | boolean

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

function matches(event: KeyboardEvent, combo: string) {
  const parts = combo.toLowerCase().split('+')
  const key = parts.at(-1)
  const needsMeta = parts.includes('mod')
  if (needsMeta && !(event.metaKey || event.ctrlKey)) return false
  if (!needsMeta && (event.metaKey || event.ctrlKey)) return false
  if (parts.includes('shift') !== event.shiftKey) return false
  return event.key.toLowerCase() === key
}

/**
 * Registers global keyboard shortcuts while this component is mounted. Bindings are skipped
 * while focus is inside a text input/textarea/contenteditable so typing never triggers them,
 * except for bindings explicitly marked allowWhileEditing (e.g. Escape, Cmd+Enter).
 */
export function useShortcuts(bindings: Array<ShortcutBinding & { handler: ShortcutHandler; allowWhileEditing?: boolean }>) {
  function onKeydown(event: KeyboardEvent) {
    for (const binding of bindings) {
      if (!matches(event, binding.keys)) continue
      if (isEditableTarget(event.target) && !binding.allowWhileEditing) continue
      const handled = binding.handler(event)
      if (handled !== false) event.preventDefault()
      return
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

  return { list: bindings.map(({ keys, description }) => ({ keys, description })) }
}
