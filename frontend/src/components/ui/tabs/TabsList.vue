<script setup lang="ts">
import { TabsList, type TabsListProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<TabsListProps & { class?: string }>()
</script>

<template>
  <TabsList v-bind="props" :class="cn('inline-flex items-center', props.class)">
    <slot />
  </TabsList>
</template>
