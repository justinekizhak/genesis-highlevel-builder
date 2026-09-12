<script setup lang="ts">
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { ShortcutBinding } from '@/composables/useShortcuts'

defineProps<{ open: boolean; shortcuts: ShortcutBinding[] }>()
defineEmits<{ 'update:open': [value: boolean] }>()

function keyLabel(combo: string) {
  return combo.split('+').map((part) => {
    if (part === 'mod') return navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'
    if (part === 'shift') return 'Shift'
    if (part === 'enter') return 'Enter'
    if (part === 'escape') return 'Esc'
    if (part === '/') return '/'
    return part.toUpperCase()
  })
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => $emit('update:open', value)">
    <DialogContent class="shortcuts-dialog" aria-describedby="shortcuts-description">
      <div class="dialog-heading">
        <div>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription id="shortcuts-description">Work the workspace without leaving the keyboard.</DialogDescription>
        </div>
      </div>
      <ul class="shortcuts-list">
        <li v-for="shortcut in shortcuts" :key="shortcut.keys" class="shortcuts-row">
          <span>{{ shortcut.description }}</span>
          <span class="shortcuts-keys">
            <kbd v-for="key in keyLabel(shortcut.keys)" :key="key">{{ key }}</kbd>
          </span>
        </li>
      </ul>
    </DialogContent>
  </Dialog>
</template>
