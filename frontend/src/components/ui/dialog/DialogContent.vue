<script setup lang="ts">
import { DialogContent, DialogOverlay, DialogPortal } from 'reka-ui'
import { cn } from '@/lib/utils'

defineProps<{ class?: string }>()
</script>

<template>
  <DialogPortal>
    <DialogOverlay class="dialog-backdrop" />
    <DialogContent :class="cn('project-dialog', $props.class)"><slot /></DialogContent>
  </DialogPortal>
</template>
