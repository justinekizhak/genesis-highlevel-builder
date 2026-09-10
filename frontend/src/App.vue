<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

onMounted(() => auth.initialize())
</script>

<template>
  <div v-if="auth.initializing" class="app-loading" role="status" aria-label="Loading Genesis">
    <div class="loading-mark">{ }</div>
    <div class="loading-line" />
  </div>
  <RouterView v-else />
</template>
