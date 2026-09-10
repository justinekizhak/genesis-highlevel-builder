<script setup lang="ts">
import { cn } from '@/lib/utils'

defineProps<{ modelValue: string; placeholder?: string; disabled?: boolean; class?: string; ariaLabel?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; submit: [] }>()

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    emit('submit')
  }
}
</script>

<template>
  <textarea
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-label="ariaLabel"
    :class="cn('min-h-20 w-full resize-none rounded-md border border-stone-700 bg-stone-950 px-3 py-2.5 text-sm leading-5 text-stone-100 placeholder:text-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 disabled:opacity-50', $props.class)"
    @input="onInput"
    @keydown="onKeydown"
  />
</template>
