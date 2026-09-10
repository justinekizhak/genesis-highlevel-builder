<script setup lang="ts">
import { cn } from '@/lib/utils'

defineProps<{
  modelValue: string
  id?: string
  type?: string
  placeholder?: string
  autocomplete?: string
  required?: boolean
  minlength?: number
  class?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <input
    :id="id"
    :value="modelValue"
    :type="type ?? 'text'"
    :placeholder="placeholder"
    :autocomplete="autocomplete"
    :required="required"
    :minlength="minlength"
    :class="cn('h-10 w-full rounded-md border border-stone-700 bg-stone-950 px-3 text-sm text-stone-100 placeholder:text-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70', $props.class)"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
