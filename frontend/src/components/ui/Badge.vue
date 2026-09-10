<script setup lang="ts">
import { cn } from '@/lib/utils'

defineProps<{ class?: string }>()
</script>

<template>
  <span :class="cn('inline-flex items-center rounded-md border border-stone-700 bg-stone-900 px-2 py-0.5 text-[11px] font-medium text-stone-300', $props.class)">
    <slot />
  </span>
</template>
