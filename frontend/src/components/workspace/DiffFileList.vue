<script setup lang="ts">
import type { GenerationFileDiff } from '@/lib/generation-diff'

defineProps<{ files: GenerationFileDiff[]; emptyMessage?: string }>()
</script>

<template>
  <p v-if="!files.length" class="snapshot-empty">{{ emptyMessage ?? 'No differences to show.' }}</p>
  <div v-else class="diff-files">
    <section v-for="file in files" :key="file.path" class="diff-file">
      <header><strong>{{ file.path }}</strong><span class="diff-added">+{{ file.added }}</span><span class="diff-removed">-{{ file.removed }}</span></header>
      <pre aria-label="Line-by-line diff"><code><span v-for="(line, index) in file.lines" :key="`${file.path}-${index}`" class="diff-line" :class="`diff-${line.kind}`"><i>{{ line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ' }}</i>{{ line.value || ' ' }}</span></code></pre>
    </section>
  </div>
</template>
