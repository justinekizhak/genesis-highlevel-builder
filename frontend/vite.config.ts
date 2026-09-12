/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('firebase')) return 'vendor-firebase'
          if (id.includes('monaco-editor') || id.includes('vue-monaco-editor')) return 'vendor-monaco'
          if (id.includes('animejs')) return 'vendor-motion'
          if (id.includes('@tabler/icons-vue')) return 'vendor-icons'
          if (id.includes('reka-ui') || id.includes('class-variance-authority') || id.includes('tailwind-merge') || id.includes('clsx')) return 'vendor-ui'
          if (id.includes('@tanstack')) return 'vendor-query'
          return 'vendor'
        },
      },
    },
  },
})
