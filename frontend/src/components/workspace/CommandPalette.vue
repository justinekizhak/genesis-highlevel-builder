<script setup lang="ts">
import {
  IconCode,
  IconDownload,
  IconExternalLink,
  IconHistory,
  IconKeyboard,
  IconLogout,
  IconMessage,
  IconPencil,
  IconPlayerStop,
  IconPlus,
} from '@tabler/icons-vue'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'

const props = defineProps<{ open: boolean; isGenerating: boolean; canExport: boolean }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  goToProjects: []
  renameProject: []
  openSnapshotHistory: []
  downloadZip: []
  openShortcuts: []
  stopGeneration: []
  focusComposer: []
  toggleChatPanel: []
  toggleCodePanel: []
  togglePreviewPanel: []
  signOut: []
}>()

function run(action: () => void) {
  action()
  emit('update:open', false)
}
</script>

<template>
  <CommandDialog :open="open" @update:open="(value) => emit('update:open', value)">
    <CommandInput placeholder="Type a command..." />
    <CommandList>
      <CommandEmpty>No matching command.</CommandEmpty>
      <CommandGroup heading="Workspace">
        <CommandItem value="Focus prompt composer" @select="run(() => emit('focusComposer'))">
          <IconMessage :size="15" />Focus prompt composer
        </CommandItem>
        <CommandItem v-if="props.isGenerating" value="Stop generation" @select="run(() => emit('stopGeneration'))">
          <IconPlayerStop :size="15" />Stop generation
        </CommandItem>
        <CommandItem value="Open snapshot history" @select="run(() => emit('openSnapshotHistory'))">
          <IconHistory :size="15" />Open snapshot history
        </CommandItem>
        <CommandItem value="Rename project" @select="run(() => emit('renameProject'))">
          <IconPencil :size="15" />Rename project
        </CommandItem>
        <CommandItem v-if="props.canExport && !props.isGenerating" value="Download project ZIP" @select="run(() => emit('downloadZip'))">
          <IconDownload :size="15" />Download project ZIP
        </CommandItem>
      </CommandGroup>
      <CommandGroup heading="Panels">
        <CommandItem value="Toggle chat panel" @select="run(() => emit('toggleChatPanel'))">
          <IconMessage :size="15" />Toggle chat panel
        </CommandItem>
        <CommandItem value="Toggle code panel" @select="run(() => emit('toggleCodePanel'))">
          <IconCode :size="15" />Toggle code panel
        </CommandItem>
        <CommandItem value="Toggle preview panel" @select="run(() => emit('togglePreviewPanel'))">
          <IconExternalLink :size="15" />Toggle preview panel
        </CommandItem>
      </CommandGroup>
      <CommandGroup heading="General">
        <CommandItem value="Go to projects" @select="run(() => emit('goToProjects'))">
          <IconPlus :size="15" />Go to projects
        </CommandItem>
        <CommandItem value="Keyboard shortcuts" @select="run(() => emit('openShortcuts'))">
          <IconKeyboard :size="15" />Keyboard shortcuts
        </CommandItem>
        <CommandItem value="Sign out" @select="run(() => emit('signOut'))">
          <IconLogout :size="15" />Sign out
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </CommandDialog>
</template>
