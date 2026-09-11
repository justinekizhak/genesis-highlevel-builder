<script setup lang="ts">
import { DialogContent, DialogOverlay, DialogPortal } from 'reka-ui'
import { cn } from '@/lib/utils'

defineProps<{ class?: string }>()
</script>

<template>
  <DialogPortal>
    <DialogOverlay class="snapshot-backdrop" />
    <DialogContent :class="cn('snapshot-dialog', $props.class)">
      <slot />
    </DialogContent>
  </DialogPortal>
</template>
