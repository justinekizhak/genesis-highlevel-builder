<script setup lang="ts">
import { IconCalendarEvent, IconInbox, IconUsers } from '@tabler/icons-vue'

defineEmits<{ select: [prompt: string] }>()

const suggestions = [
  { label: 'Contact dashboard', icon: IconUsers, prompt: 'Build a contact dashboard with search and upcoming appointments' },
  { label: 'Conversation inbox', icon: IconInbox, prompt: 'Show recent conversations and unread messages' },
  { label: 'Calendar view', icon: IconCalendarEvent, prompt: 'Show this week\'s calendar availability and upcoming appointments' },
]
</script>

<template>
  <div class="suggestions" role="list" aria-label="Prompt suggestions">
    <button v-for="suggestion in suggestions" :key="suggestion.label" type="button" role="listitem" @click="$emit('select', suggestion.prompt)">
      <component :is="suggestion.icon" :size="14" />
      <span>{{ suggestion.label }}</span>
    </button>
  </div>
</template>
