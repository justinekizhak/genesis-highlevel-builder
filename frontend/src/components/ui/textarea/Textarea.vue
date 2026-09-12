<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { useVModel } from "@vueuse/core"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
  defaultValue?: string | number
  modelValue?: string | number
}>()

const emits = defineEmits<{
  (e: "update:modelValue", payload: string | number): void
}>()

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
})
</script>

<template>
  <textarea
    v-model="modelValue"
    data-slot="textarea"
    :class="cn('border-input placeholder:text-[#777870] focus-visible:border-ring focus-visible:ring-ring/20 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive flex field-sizing-content min-h-20 w-full rounded-[10px] border bg-[#111210] px-3.5 py-3 text-base text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.025)] transition-[border-color,box-shadow,background-color] outline-none hover:border-[#4a4b44] focus-visible:bg-[#151613] focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 md:text-[13px]', props.class)"
  />
</template>
