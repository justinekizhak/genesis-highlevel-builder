<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    variant?: 'default' | 'secondary' | 'ghost'
    size?: 'default' | 'icon' | 'sm'
    disabled?: boolean
    type?: 'button' | 'submit'
    class?: string
    ariaLabel?: string
  }>(),
  { variant: 'default', size: 'default', type: 'button' },
)

const classes = computed(() =>
  cn(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium transition-[background-color,color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 disabled:pointer-events-none disabled:opacity-45 active:translate-y-px',
    props.variant === 'default' && 'bg-amber-300 text-stone-950 hover:bg-amber-200',
    props.variant === 'secondary' && 'border border-stone-700 bg-stone-900 text-stone-100 hover:bg-stone-800',
    props.variant === 'ghost' && 'text-stone-400 hover:bg-stone-800 hover:text-stone-100',
    props.size === 'default' && 'h-9 px-4',
    props.size === 'sm' && 'h-8 px-3 text-xs',
    props.size === 'icon' && 'size-8',
    props.class,
  ),
)
</script>

<template>
  <button :type="type" :disabled="disabled" :class="classes" :aria-label="ariaLabel">
    <slot />
  </button>
</template>
