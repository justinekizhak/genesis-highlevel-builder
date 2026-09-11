<script setup lang="ts">
import { AlertDialogContent, AlertDialogOverlay, AlertDialogPortal } from 'reka-ui'
import { cn } from '@/lib/utils'

defineProps<{ class?: string }>()
</script>

<template>
  <AlertDialogPortal>
    <AlertDialogOverlay class="dialog-backdrop" />
    <AlertDialogContent :class="cn('project-dialog alert-dialog', $props.class)"><slot /></AlertDialogContent>
  </AlertDialogPortal>
</template>
