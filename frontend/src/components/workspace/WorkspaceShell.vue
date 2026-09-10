<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'
import {
  IconBraces,
  IconChevronDown,
  IconCode,
  IconExternalLink,
  IconFileCode,
  IconHistory,
  IconLayoutSidebarLeftCollapse,
  IconMessage,
  IconPlayerStop,
  IconPlus,
  IconRefresh,
  IconSend,
  IconSparkles,
} from '@tabler/icons-vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Textarea from '@/components/ui/Textarea.vue'
import { buildSrcdoc } from '@/lib/srcdoc'
import { generateApplication, initialDemoFiles, loadApplicationState, saveLocalApplicationState } from '@/services/generation'
import { useAuthStore } from '@/stores/auth'
import { useHighLevelStore } from '@/stores/highlevel'
import { useProjectsStore } from '@/stores/projects'
import type { ChatMessage, GeneratedFile, GenerationEvent } from '@/types/generation'
import { highLevelOperationSet, type HighLevelOperation, type HighLevelParameters } from '@/types/highlevel'

const route = useRoute()
const router = useRouter()
const projectsStore = useProjectsStore()
const authStore = useAuthStore()
const highLevelStore = useHighLevelStore()
const files = ref<Record<string, GeneratedFile>>(structuredClone(initialDemoFiles))
const activePath = ref('app.js')
const messages = ref<ChatMessage[]>([
  {
    id: 'welcome',
    role: 'assistant',
    content: 'Describe a HighLevel workflow or dashboard. I will generate a small, reviewable app and show each file as it is written.',
  },
])
const prompt = ref('')
const isGenerating = ref(false)
const generationError = ref('')
const previewDocument = ref(buildSrcdoc(files.value))
const previewFrame = ref<HTMLIFrameElement>()
const bridgeError = ref('')
const currentGenerationId = ref<string>()
const currentSnapshotId = ref<string>()
const activeModel = ref(import.meta.env.VITE_FUNCTIONS_BASE_URL ? 'Model pending' : 'Local mock')
const mobilePanel = ref<'chat' | 'code' | 'preview'>('chat')
const streamSourceLabel = import.meta.env.VITE_FUNCTIONS_BASE_URL ? 'Firebase stream' : 'Local mock stream'
let controller: AbortController | undefined
let filesBeforeGeneration: Record<string, GeneratedFile> | undefined
const bridgeRequests = new Set<string>()

const activeFile = computed(() => files.value[activePath.value])
const fileList = computed(() => Object.values(files.value))
const statusLabel = computed(() => {
  if (generationError.value) return 'Needs attention'
  if (isGenerating.value) return 'Generating'
  return 'Ready'
})
const projectId = computed(() => String(route.params.projectId ?? 'local-demo'))
const projectTitle = computed(() => projectsStore.projects.find((project) => project.id === projectId.value)?.name ?? 'Untitled project')

function cloneFiles(source: Record<string, GeneratedFile>) {
  return Object.fromEntries(Object.entries(source).map(([path, file]) => [path, { ...file }]))
}

function renderPreview() {
  previewDocument.value = buildSrcdoc(files.value, { enableHighLevelBridge: highLevelStore.connection.connected })
}

function parseBridgeRequest(event: MessageEvent) {
  if (event.source !== previewFrame.value?.contentWindow) return
  const data = event.data as Record<string, unknown> | null
  if (!data || data.channel !== 'genesis.highlevel.v1' || data.direction !== 'request') return
  if (typeof data.requestId !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(data.requestId)) return
  if (typeof data.operation !== 'string' || !highLevelOperationSet.has(data.operation)) return
  const raw = data.parameters
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return
  const entries = Object.entries(raw)
  if (entries.length > 20 || entries.some(([key, value]) => (
    !/^[A-Za-z][A-Za-z0-9]*$/.test(key)
    || !['string', 'number', 'undefined'].includes(typeof value)
    || (typeof value === 'string' && value.length > 500)
  ))) return
  return {
    requestId: data.requestId,
    operation: data.operation as HighLevelOperation,
    parameters: raw as HighLevelParameters,
  }
}

async function handleHighLevelBridge(event: MessageEvent) {
  const request = parseBridgeRequest(event)
  if (!request || bridgeRequests.has(request.requestId) || bridgeRequests.size >= 8) return
  bridgeRequests.add(request.requestId)
  bridgeError.value = ''
  try {
    const data = await highLevelStore.execute(request.operation, request.parameters)
    previewFrame.value?.contentWindow?.postMessage({
      channel: 'genesis.highlevel.v1', direction: 'response', requestId: request.requestId, ok: true, data,
    }, '*')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'HighLevel request failed.'
    bridgeError.value = message
    previewFrame.value?.contentWindow?.postMessage({
      channel: 'genesis.highlevel.v1', direction: 'response', requestId: request.requestId, ok: false, error: message,
    }, '*')
  } finally {
    bridgeRequests.delete(request.requestId)
  }
}

onMounted(async () => {
  if (!projectsStore.projects.length) projectsStore.load()
  window.addEventListener('message', handleHighLevelBridge)
  try {
    const [state] = await Promise.all([
      loadApplicationState(projectId.value, await authStore.getIdToken()),
      highLevelStore.loadStatus(),
    ])
    if (state?.files) {
      files.value = Object.fromEntries(Object.entries(state.files).map(([path, content]) => [path, {
        path,
        content,
        language: path.endsWith('.js') ? 'javascript' : path.endsWith('.css') ? 'css' : 'html',
      }]))
      activePath.value = Object.keys(files.value)[0] ?? 'app.js'
      renderPreview()
      currentSnapshotId.value = state.snapshotId
    }
    if (state?.messages.length) messages.value = state.messages
  } catch (error) {
    generationError.value = error instanceof Error ? error.message : 'Could not load this project.'
  }
})

onBeforeUnmount(() => window.removeEventListener('message', handleHighLevelBridge))
watch(() => highLevelStore.connection.connected, renderPreview)

function updateActiveFile(content: string) {
  if (!activeFile.value || isGenerating.value) return
  files.value[activePath.value] = { ...activeFile.value, content }
}

function handleEvent(event: GenerationEvent) {
  switch (event.type) {
    case 'generation_started':
      currentGenerationId.value = event.generationId
      activeModel.value = event.provider === 'openai' ? (event.model ?? 'OpenAI') : 'Local mock'
      files.value = {}
      break
    case 'token': {
      const last = messages.value.at(-1)
      if (last?.role === 'assistant' && last.id === currentGenerationId.value) last.content += event.delta
      else messages.value.push({ id: currentGenerationId.value ?? crypto.randomUUID(), role: 'assistant', content: event.delta })
      break
    }
    case 'file_start':
      files.value[event.path] = { path: event.path, language: event.language, content: '' }
      activePath.value = event.path
      mobilePanel.value = 'code'
      break
    case 'file_delta': {
      const file = files.value[event.path]
      if (file) files.value[event.path] = { ...file, content: file.content + event.delta }
      break
    }
    case 'snapshot_created':
      currentSnapshotId.value = event.snapshotId
      break
    case 'complete':
      renderPreview()
      mobilePanel.value = 'preview'
      if (!import.meta.env.VITE_FUNCTIONS_BASE_URL) {
        saveLocalApplicationState(projectId.value, {
          snapshotId: currentSnapshotId.value,
          files: Object.fromEntries(Object.entries(files.value).map(([path, file]) => [path, file.content])),
          messages: messages.value,
        })
      }
      filesBeforeGeneration = undefined
      break
    case 'error':
      generationError.value = event.message
      if (filesBeforeGeneration) files.value = filesBeforeGeneration
      break
  }
}

async function submitPrompt(suggestion?: string) {
  const value = (suggestion ?? prompt.value).trim()
  if (!value || isGenerating.value) return
  prompt.value = ''
  generationError.value = ''
  isGenerating.value = true
  messages.value.push({ id: crypto.randomUUID(), role: 'user', content: value })
  filesBeforeGeneration = cloneFiles(files.value)
  controller = new AbortController()

  try {
    await generateApplication({
      prompt: value,
      projectId: projectId.value,
      currentFiles: filesBeforeGeneration ?? {},
      idToken: await authStore.getIdToken(),
      signal: controller.signal,
      onEvent: handleEvent,
    })
  } catch (error) {
    if ((error as DOMException).name !== 'AbortError') {
      generationError.value = error instanceof Error ? error.message : 'Generation failed unexpectedly.'
    }
    if (filesBeforeGeneration) files.value = filesBeforeGeneration
  } finally {
    isGenerating.value = false
    controller = undefined
    await nextTick()
  }
}

function stopGeneration() {
  controller?.abort()
  if (filesBeforeGeneration) files.value = filesBeforeGeneration
  filesBeforeGeneration = undefined
  isGenerating.value = false
}

function refreshPreview() {
  renderPreview()
}
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark"><IconBraces :size="18" :stroke-width="1.8" /></div>
        <div>
          <strong>Genesis</strong>
          <span>HighLevel builder</span>
        </div>
      </div>

      <button class="project-switcher" type="button" @click="router.push('/projects')">
        <span>{{ projectTitle }}</span>
        <IconChevronDown :size="15" />
      </button>

      <div class="topbar-actions">
        <Badge :class="isGenerating ? 'status-badge active' : 'status-badge'">{{ statusLabel }}</Badge>
        <Button variant="ghost" size="icon" aria-label="Open snapshot history">
          <IconHistory :size="17" />
        </Button>
        <Button variant="secondary" size="sm" @click="router.push('/projects')">
          <IconPlus :size="15" /> Projects
        </Button>
      </div>
    </header>

    <nav class="mobile-tabs" aria-label="Workspace panels">
      <button :class="{ active: mobilePanel === 'chat' }" @click="mobilePanel = 'chat'"><IconMessage :size="16" />Chat</button>
      <button :class="{ active: mobilePanel === 'code' }" @click="mobilePanel = 'code'"><IconCode :size="16" />Code</button>
      <button :class="{ active: mobilePanel === 'preview' }" @click="mobilePanel = 'preview'"><IconExternalLink :size="16" />Preview</button>
    </nav>

    <section class="workspace">
      <aside class="panel chat-panel" :class="{ 'mobile-active': mobilePanel === 'chat' }">
        <div class="panel-heading">
          <div>
            <span class="heading-label">Conversation</span>
            <h1>Build with HighLevel</h1>
          </div>
          <Button variant="ghost" size="icon" aria-label="Collapse conversation">
            <IconLayoutSidebarLeftCollapse :size="17" />
          </Button>
        </div>

        <div class="messages" aria-live="polite">
          <article v-for="message in messages" :key="message.id" class="message" :class="message.role">
            <span>{{ message.role === 'assistant' ? 'Genesis' : 'You' }}</span>
            <p>{{ message.content }}</p>
          </article>

          <div v-if="isGenerating" class="generation-progress">
            <IconSparkles :size="15" />
            <span>Writing {{ activePath }}</span>
          </div>

          <p v-if="generationError" class="error-message">{{ generationError }}</p>
        </div>

        <div class="suggestions">
          <button @click="submitPrompt('Build a contact dashboard with search and upcoming appointments')">Contact dashboard</button>
          <button @click="submitPrompt('Show recent conversations and unread messages')">Conversation inbox</button>
        </div>

        <form class="composer" @submit.prevent="submitPrompt()">
          <label for="prompt">Describe the app</label>
          <Textarea
            id="prompt"
            v-model="prompt"
            aria-label="Describe the HighLevel app to generate"
            placeholder="Build a contact dashboard with search..."
            :disabled="isGenerating"
            @submit="submitPrompt()"
          />
          <div class="composer-footer">
            <span>Enter to send, Shift + Enter for a new line</span>
            <Button v-if="isGenerating" type="button" variant="secondary" size="icon" aria-label="Stop generation" @click="stopGeneration">
              <IconPlayerStop :size="15" />
            </Button>
            <Button v-else type="submit" size="icon" aria-label="Generate app" :disabled="!prompt.trim()">
              <IconSend :size="16" />
            </Button>
          </div>
        </form>
      </aside>

      <section class="panel code-panel" :class="{ 'mobile-active': mobilePanel === 'code' }">
        <div class="panel-toolbar">
          <div class="toolbar-title"><IconCode :size="16" /><span>Code</span></div>
          <span v-if="isGenerating" class="read-only-label">Read only while generating</span>
        </div>
        <div class="code-body">
          <nav class="file-tree" aria-label="Generated files">
            <span class="tree-title">Files</span>
            <button
              v-for="file in fileList"
              :key="file.path"
              :class="{ active: file.path === activePath }"
              @click="activePath = file.path"
            >
              <IconFileCode :size="15" />
              <span>{{ file.path }}</span>
            </button>
            <p v-if="!fileList.length" class="tree-empty">Waiting for the first file...</p>
          </nav>
          <div class="editor-wrap">
            <div v-if="activeFile" class="editor-tab">
              <IconFileCode :size="14" />
              <span>{{ activePath }}</span>
            </div>
            <VueMonacoEditor
              v-if="activeFile"
              :value="activeFile.content"
              :language="activeFile.language"
              theme="vs-dark"
              :options="{
                automaticLayout: true,
                minimap: { enabled: false },
                fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
                fontSize: 13,
                lineHeight: 21,
                padding: { top: 16 },
                readOnly: isGenerating,
                scrollBeyondLastLine: false,
                renderLineHighlight: 'gutter',
              }"
              @update:value="updateActiveFile"
            />
            <div v-else class="editor-empty"><IconCode :size="30" /><p>Generated files will appear here.</p></div>
          </div>
        </div>
      </section>

      <section class="panel preview-panel" :class="{ 'mobile-active': mobilePanel === 'preview' }">
        <div class="panel-toolbar">
          <div class="toolbar-title"><IconExternalLink :size="16" /><span>Preview</span></div>
          <div class="preview-actions">
            <span class="preview-url">genesis.local</span>
            <Button variant="ghost" size="icon" aria-label="Refresh preview" @click="refreshPreview">
              <IconRefresh :size="16" />
            </Button>
          </div>
        </div>
        <div class="preview-stage">
          <div v-if="isGenerating" class="preview-mask">
            <IconSparkles :size="18" />
            <span>Preview updates when generation completes</span>
          </div>
          <iframe
            ref="previewFrame"
            title="Generated HighLevel application preview"
            sandbox="allow-scripts allow-forms"
            :srcdoc="previewDocument"
          />
        </div>
      </section>
    </section>

    <footer class="statusbar">
      <span>{{ fileList.length }} files</span>
      <span v-if="currentSnapshotId">Snapshot ready</span>
      <span>{{ highLevelStore.connection.connected ? 'HighLevel live' : 'HighLevel demo data' }}</span>
      <span v-if="bridgeError" class="error-message">{{ bridgeError }}</span>
      <span>{{ activeModel }} · {{ streamSourceLabel }}</span>
    </footer>
  </main>
</template>
