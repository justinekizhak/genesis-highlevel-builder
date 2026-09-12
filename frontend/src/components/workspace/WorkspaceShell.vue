<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQueryClient } from '@tanstack/vue-query'
import {
  IconArrowLeft,
  IconBraces,
  IconChevronLeft,
  IconChevronRight,
  IconCode,
  IconEdit,
  IconFileDiff,
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
import Input from '@/components/ui/Input.vue'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buildSrcdoc } from '@/lib/srcdoc'
import { buildGenerationDiff, type GenerationFileDiff } from '@/lib/generation-diff'
import { animateEntrance, animateFeedback } from '@/lib/motion'
import { useIntegrationStatusQuery } from '@/composables/server-state'
import {
  generateApplication,
  initialDemoFiles,
  listApplicationSnapshots,
  loadApplicationState,
  restoreApplicationSnapshot,
  saveApplicationFiles,
  saveLocalApplicationState,
} from '@/services/generation'
import { useAuthStore } from '@/stores/auth'
import { useHighLevelStore } from '@/stores/highlevel'
import { useProjectsStore } from '@/stores/projects'
import type { ChatMessage, GeneratedFile, GenerationEvent, ProjectSnapshot } from '@/types/generation'
import { highLevelOperationSet, highLevelWriteOperationSet, type HighLevelOperation, type HighLevelParameters } from '@/types/highlevel'

const route = useRoute()
const router = useRouter()
const queryClient = useQueryClient()
const projectsStore = useProjectsStore()
const authStore = useAuthStore()
const highLevelStore = useHighLevelStore()
useIntegrationStatusQuery()
const MonacoEditor = defineAsyncComponent({
  loader: () => import('@guolao/vue-monaco-editor').then((module) => module.VueMonacoEditor),
  loadingComponent: { template: '<div class="editor-empty">Loading editor...</div>' },
})
const workspaceRoot = ref<HTMLElement>()
const files = ref<Record<string, GeneratedFile>>(structuredClone(initialDemoFiles))
const activePath = ref('app.js')
const openTabs = ref<string[]>(['app.js'])
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
const previewFrameKey = ref(0)
const bridgeError = ref('')
const diffOpen = ref(false)
const generationDiffs = ref<GenerationFileDiff[]>([])
const pendingWriteRequest = ref<{
  requestId: string
  operation: HighLevelOperation
  parameters: HighLevelParameters
}>()
const snapshotOpen = ref(false)
const snapshots = ref<ProjectSnapshot[]>([])
const snapshotLoading = ref(false)
const snapshotError = ref('')
const restoringSnapshotId = ref<string>()
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const currentGenerationId = ref<string>()
const currentSnapshotId = ref<string>()
const activeModel = ref(import.meta.env.VITE_FUNCTIONS_BASE_URL ? 'Model pending' : 'Local mock')
const mobilePanel = ref<'chat' | 'code' | 'preview'>('chat')
const chatCollapsed = ref(false)
const codeCollapsed = ref(false)
const previewCollapsed = ref(false)
const codeShare = ref(52)
const attentionOpen = ref(false)
const projectEditorOpen = ref(false)
const projectName = ref('')
const projectEditError = ref('')
const projectSaving = ref(false)
const streamSourceLabel = import.meta.env.VITE_FUNCTIONS_BASE_URL ? 'Firebase stream' : 'Local mock stream'
let controller: AbortController | undefined
let filesBeforeGeneration: Record<string, GeneratedFile> | undefined
let saveTimer: number | undefined
let chatSaveTimer: number | undefined
const bridgeRequests = new Set<string>()
let workspaceAnimation: { cancel?: () => void } | undefined

const writeConfirmationLabels: Partial<Record<HighLevelOperation, string>> = {
  'contacts.create': 'create a HighLevel contact',
  'contacts.update': 'update a HighLevel contact',
  'conversations.send': 'send a HighLevel message',
}
const writeConfirmationLabel = computed(() => (
  pendingWriteRequest.value
    ? writeConfirmationLabels[pendingWriteRequest.value.operation] ?? 'change HighLevel data'
    : 'change HighLevel data'
))

const activeFile = computed(() => files.value[activePath.value])
const fileList = computed(() => Object.values(files.value))
const statusLabel = computed(() => {
  if (generationError.value) return 'Needs attention'
  if (isGenerating.value) return 'Generating'
  return 'Ready'
})
const projectId = computed(() => String(route.params.projectId ?? 'local-demo'))
const projectTitle = computed(() => projectsStore.projects.find((project) => project.id === projectId.value)?.name ?? 'Untitled project')
const workspaceStyle = computed(() => {
  const chat = chatCollapsed.value ? '44px' : 'minmax(250px, 330px)'
  if (codeCollapsed.value) return { gridTemplateColumns: `${chat} 44px minmax(320px, 1fr)` }
  if (previewCollapsed.value) return { gridTemplateColumns: `${chat} minmax(360px, 1fr) 44px` }
  return { gridTemplateColumns: `${chat} minmax(280px, ${codeShare.value}fr) 6px minmax(300px, ${100 - codeShare.value}fr)` }
})

function cloneFiles(source: Record<string, GeneratedFile>) {
  return Object.fromEntries(Object.entries(source).map(([path, file]) => [path, { ...file }]))
}

function renderPreview() {
  previewDocument.value = buildSrcdoc(files.value, { enableHighLevelBridge: highLevelStore.connection.connected })
}

function toggleCodePanel() {
  codeCollapsed.value = !codeCollapsed.value
  if (codeCollapsed.value) previewCollapsed.value = false
}

function togglePreviewPanel() {
  previewCollapsed.value = !previewCollapsed.value
  if (previewCollapsed.value) codeCollapsed.value = false
}

function startPanelResize(event: PointerEvent) {
  if (codeCollapsed.value || previewCollapsed.value) return
  const codePanel = workspaceRoot.value?.querySelector<HTMLElement>('.code-panel')
  const previewPanel = workspaceRoot.value?.querySelector<HTMLElement>('.preview-panel')
  const total = (codePanel?.offsetWidth ?? 0) + (previewPanel?.offsetWidth ?? 0)
  if (!total) return
  const startX = event.clientX
  const startShare = codeShare.value
  const move = (moveEvent: PointerEvent) => {
    codeShare.value = Math.min(75, Math.max(25, startShare + ((moveEvent.clientX - startX) / total) * 100))
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    document.body.classList.remove('is-resizing-panels')
  }
  document.body.classList.add('is-resizing-panels')
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop, { once: true })
}

function resizePanelsWithKeyboard(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  codeShare.value = Math.min(75, Math.max(25, codeShare.value + (event.key === 'ArrowRight' ? 3 : -3)))
}

function openProjectEditor() {
  projectName.value = projectTitle.value
  projectEditError.value = ''
  projectEditorOpen.value = true
}

async function saveProjectName() {
  const value = projectName.value.trim()
  if (!value || projectSaving.value) return
  projectSaving.value = true
  projectEditError.value = ''
  try {
    await projectsStore.update(projectId.value, { name: value })
    await queryClient.invalidateQueries({ queryKey: ['projects'] })
    projectEditorOpen.value = false
  } catch (error) {
    projectEditError.value = error instanceof Error ? error.message : 'Could not rename this project.'
  } finally {
    projectSaving.value = false
  }
}

function hydrateFiles(source: Record<string, string>) {
  files.value = Object.fromEntries(Object.entries(source).map(([path, content]) => [path, {
    path,
    content,
    language: path.endsWith('.js') ? 'javascript' : path.endsWith('.css') ? 'css' : 'html',
  }]))
  const firstPath = Object.keys(files.value)[0] ?? 'app.js'
  activePath.value = firstPath
  openTabs.value = [firstPath]
}

function openFile(path: string) {
  if (!openTabs.value.includes(path)) openTabs.value.push(path)
  activePath.value = path
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
    || (!['string', 'number', 'boolean', 'undefined'].includes(typeof value) && !Array.isArray(value))
    || (typeof value === 'string' && value.length > 5_000)
    || (Array.isArray(value) && (value.length > 20 || value.some((item) => typeof item !== 'string' || item.length > 500)))
  ))) return
  return {
    requestId: data.requestId,
    operation: data.operation as HighLevelOperation,
    parameters: raw as HighLevelParameters,
  }
}

function postBridgeResponse(requestId: string, response: { ok: true; data: unknown } | { ok: false; error: string }) {
  previewFrame.value?.contentWindow?.postMessage({
    channel: 'genesis.highlevel.v1', direction: 'response', requestId, ...response,
  }, '*')
}

async function executeBridgeRequest(request: NonNullable<typeof pendingWriteRequest.value>) {
  bridgeError.value = ''
  try {
    const data = await highLevelStore.execute(request.operation, request.parameters)
    postBridgeResponse(request.requestId, { ok: true, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'HighLevel request failed.'
    bridgeError.value = message
    postBridgeResponse(request.requestId, { ok: false, error: message })
  } finally {
    bridgeRequests.delete(request.requestId)
  }
}

async function handleHighLevelBridge(event: MessageEvent) {
  const request = parseBridgeRequest(event)
  if (!request || bridgeRequests.has(request.requestId) || bridgeRequests.size >= 8) return
  bridgeRequests.add(request.requestId)
  if (highLevelWriteOperationSet.has(request.operation)) {
    if (pendingWriteRequest.value) {
      postBridgeResponse(request.requestId, { ok: false, error: 'Another HighLevel change is awaiting confirmation.' })
      bridgeRequests.delete(request.requestId)
      return
    }
    pendingWriteRequest.value = request
    return
  }
  await executeBridgeRequest(request)
}

async function confirmHighLevelWrite() {
  const request = pendingWriteRequest.value
  pendingWriteRequest.value = undefined
  if (request) await executeBridgeRequest(request)
}

function cancelHighLevelWrite() {
  const request = pendingWriteRequest.value
  pendingWriteRequest.value = undefined
  if (!request) return
  postBridgeResponse(request.requestId, { ok: false, error: 'HighLevel change cancelled by the user.' })
  bridgeRequests.delete(request.requestId)
}

onMounted(async () => {
  window.addEventListener('message', handleHighLevelBridge)
  try {
    if (!projectsStore.projects.length) await queryClient.fetchQuery({
      queryKey: ['projects', authStore.user?.uid ?? 'signed-out'],
      queryFn: async () => {
        await projectsStore.load()
        return projectsStore.projects
      },
    }).catch(() => [])
    const state = await queryClient.fetchQuery({
      queryKey: ['project-state', projectId.value],
      queryFn: async () => loadApplicationState(projectId.value, await authStore.getIdToken(true)),
    })
    if (state?.files) {
      hydrateFiles(state.files)
      renderPreview()
      currentSnapshotId.value = state.snapshotId
    }
    if (state?.messages?.length) messages.value = state.messages
  } catch (error) {
    generationError.value = error instanceof Error ? error.message : 'Could not load this project.'
  }
  await nextTick()
  workspaceAnimation = await animateEntrance(workspaceRoot.value?.querySelectorAll('.panel') ?? [], { y: { from: 8 }, delay: 0 })
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleHighLevelBridge)
  if (saveTimer) window.clearTimeout(saveTimer)
  if (chatSaveTimer) window.clearTimeout(chatSaveTimer)
  controller?.abort()
  workspaceAnimation?.cancel?.()
})
watch(() => highLevelStore.connection.connected, renderPreview)
watch(messages, () => {
  if (import.meta.env.VITE_FUNCTIONS_BASE_URL) return
  if (chatSaveTimer) window.clearTimeout(chatSaveTimer)
  chatSaveTimer = window.setTimeout(() => saveLocalApplicationState(projectId.value, {
    snapshotId: currentSnapshotId.value,
    files: Object.fromEntries(Object.entries(files.value).map(([path, file]) => [path, file.content])),
    messages: messages.value,
  }), 120)
}, { deep: true })

function updateActiveFile(content: string) {
  if (!activeFile.value || isGenerating.value) return
  files.value[activePath.value] = { ...activeFile.value, content }
  currentSnapshotId.value = undefined
  saveStatus.value = 'saving'
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(persistManualFiles, 700)
}

async function persistManualFiles(): Promise<boolean> {
  try {
    const savedFiles = await saveApplicationFiles(projectId.value, files.value, await authStore.getIdToken(true))
    if (!import.meta.env.VITE_FUNCTIONS_BASE_URL) {
      saveLocalApplicationState(projectId.value, {
        snapshotId: currentSnapshotId.value,
        files: savedFiles,
        messages: messages.value,
      })
    }
    saveStatus.value = 'saved'
    renderPreview()
    return true
  } catch (error) {
    saveStatus.value = 'error'
    generationError.value = error instanceof Error ? error.message : 'Could not save the edited files.'
    return false
  }
}

async function openSnapshotHistory() {
  snapshotOpen.value = true
  snapshotLoading.value = true
  snapshotError.value = ''
  try {
    await queryClient.invalidateQueries({ queryKey: ['project-snapshots', projectId.value] })
    snapshots.value = await queryClient.fetchQuery({
      queryKey: ['project-snapshots', projectId.value],
      queryFn: async () => listApplicationSnapshots(projectId.value, await authStore.getIdToken(true)),
    })
  } catch (error) {
    snapshotError.value = error instanceof Error ? error.message : 'Could not load snapshot history.'
  } finally {
    snapshotLoading.value = false
  }
}

async function restoreSnapshot(snapshot: ProjectSnapshot) {
  if (snapshot.id === currentSnapshotId.value || restoringSnapshotId.value) return
  if (saveTimer) window.clearTimeout(saveTimer)
  restoringSnapshotId.value = snapshot.id
  snapshotError.value = ''
  try {
    const restored = await restoreApplicationSnapshot(projectId.value, snapshot.id, await authStore.getIdToken(true))
    hydrateFiles(restored.files)
    currentSnapshotId.value = restored.snapshotId
    await queryClient.invalidateQueries({ queryKey: ['project-state', projectId.value] })
    await queryClient.invalidateQueries({ queryKey: ['project-snapshots', projectId.value] })
    renderPreview()
    snapshotOpen.value = false
  } catch (error) {
    snapshotError.value = error instanceof Error ? error.message : 'Could not restore the snapshot.'
  } finally {
    restoringSnapshotId.value = undefined
  }
}

function handleEvent(event: GenerationEvent) {
  switch (event.type) {
    case 'generation_started':
      currentGenerationId.value = event.generationId
      activeModel.value = event.provider === 'openai' ? (event.model ?? 'OpenAI') : 'Local mock'
      break
    case 'token': {
      const last = messages.value.at(-1)
      if (last?.role === 'assistant' && last.id === currentGenerationId.value) last.content += event.delta
      else messages.value.push({ id: currentGenerationId.value ?? crypto.randomUUID(), role: 'assistant', content: event.delta })
      break
    }
    case 'file_start':
      files.value[event.path] = { path: event.path, language: event.language, content: '' }
      openFile(event.path)
      mobilePanel.value = 'code'
      break
    case 'file_delta': {
      const file = files.value[event.path]
      if (file) files.value[event.path] = { ...file, content: file.content + event.delta }
      break
    }
    case 'file_complete': {
      const file = files.value[event.path]
      if (!file || file.content.length !== event.size) {
        generationError.value = `The stream for ${event.path} ended unexpectedly. Partial output has been preserved.`
      }
      break
    }
    case 'snapshot_created':
      currentSnapshotId.value = event.snapshotId
      queryClient.invalidateQueries({ queryKey: ['project-snapshots', projectId.value] })
      break
    case 'complete':
      generationDiffs.value = filesBeforeGeneration ? buildGenerationDiff(filesBeforeGeneration, files.value) : []
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
      break
  }
}

async function submitPrompt(suggestion?: string) {
  const value = (suggestion ?? prompt.value).trim()
  if (!value || isGenerating.value) return
  if (saveTimer) window.clearTimeout(saveTimer)
  if ((saveStatus.value === 'saving' || saveStatus.value === 'error') && !await persistManualFiles()) return
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
      idToken: await authStore.getIdToken(true),
      signal: controller.signal,
      onEvent: handleEvent,
    })
  } catch (error) {
    if ((error as DOMException).name !== 'AbortError') {
      generationError.value = error instanceof Error ? error.message : 'Generation failed unexpectedly.'
    }
  } finally {
    isGenerating.value = false
    controller = undefined
    await nextTick()
  }
}

function stopGeneration() {
  controller?.abort()
  filesBeforeGeneration = undefined
  isGenerating.value = false
  generationError.value = 'Generation stopped. Partial output has been preserved in the editor.'
}

function refreshPreview() {
  renderPreview()
  previewFrameKey.value += 1
  nextTick(() => {
    if (previewFrame.value) animateFeedback(previewFrame.value)
  })
}

function openPreviewInNewTab() {
  bridgeError.value = ''
  const blob = new Blob([buildSrcdoc(files.value)], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const opened = window.open(url, '_blank')
  if (opened) opened.opener = null
  else bridgeError.value = 'The preview tab was blocked. Allow pop-ups for this site and try again.'
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
</script>

<template>
  <main ref="workspaceRoot" class="app-shell">
    <header class="topbar">
      <div class="brand">
        <Button variant="ghost" size="icon" aria-label="Back to projects" title="Back to projects" @click="router.push('/projects')">
          <IconArrowLeft :size="17" />
        </Button>
        <div class="brand-mark"><IconBraces :size="18" :stroke-width="1.8" /></div>
        <div>
          <strong>Genesis</strong>
          <span>HighLevel builder</span>
        </div>
      </div>

      <button class="project-switcher" type="button" title="Rename project" @click="openProjectEditor">
        <span>{{ projectTitle }}</span>
        <IconEdit :size="14" />
      </button>

      <div class="topbar-actions">
        <button
          v-if="generationError"
          class="status-badge status-button attention"
          type="button"
          aria-label="Show issue details"
          @click="attentionOpen = true"
        >{{ statusLabel }}</button>
        <Badge v-else :class="isGenerating ? 'status-badge active' : 'status-badge'">{{ statusLabel }}</Badge>
        <Button v-if="generationDiffs.length" variant="ghost" size="sm" @click="diffOpen = true">
          <IconFileDiff :size="16" />Changes
        </Button>
        <Button variant="ghost" size="icon" aria-label="Open snapshot history" @click="openSnapshotHistory">
          <IconHistory :size="17" />
        </Button>
        <Button variant="secondary" size="sm" @click="router.push('/projects')">
          <IconPlus :size="15" /> Projects
        </Button>
      </div>
    </header>

    <Tabs v-model="mobilePanel" class="mobile-tabs" aria-label="Workspace panels">
      <TabsList class="mobile-tab-list">
        <TabsTrigger value="chat"><IconMessage :size="16" />Chat</TabsTrigger>
        <TabsTrigger value="code"><IconCode :size="16" />Code</TabsTrigger>
        <TabsTrigger value="preview"><IconExternalLink :size="16" />Preview</TabsTrigger>
      </TabsList>
    </Tabs>

    <section class="workspace" :style="workspaceStyle">
      <aside class="panel chat-panel" :class="{ 'mobile-active': mobilePanel === 'chat', 'is-collapsed': chatCollapsed }">
        <Button
          v-if="chatCollapsed"
          class="collapsed-panel-button"
          variant="ghost"
          size="icon"
          aria-label="Expand conversation"
          title="Expand conversation"
          @click="chatCollapsed = false"
        ><IconMessage :size="17" /></Button>
        <div class="panel-heading">
          <div>
            <span class="heading-label">Conversation</span>
            <h1>Build with HighLevel</h1>
          </div>
          <Button variant="ghost" size="icon" aria-label="Collapse conversation" title="Collapse conversation" @click="chatCollapsed = true">
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

      <section class="panel code-panel" :class="{ 'mobile-active': mobilePanel === 'code', 'is-collapsed': codeCollapsed }">
        <Button
          v-if="codeCollapsed"
          class="collapsed-panel-button"
          variant="ghost"
          size="icon"
          aria-label="Expand code editor"
          title="Expand code editor"
          @click="codeCollapsed = false"
        ><IconCode :size="17" /></Button>
        <div class="panel-toolbar">
          <div class="toolbar-title"><IconCode :size="16" /><span>Code</span></div>
          <div class="panel-toolbar-actions">
            <span v-if="isGenerating" class="read-only-label">Read only while generating</span>
            <span v-else-if="saveStatus === 'saving'" class="read-only-label">Saving edit...</span>
            <span v-else-if="saveStatus === 'saved'" class="read-only-label">Saved</span>
            <span v-else-if="saveStatus === 'error'" class="read-only-label error-message">Save failed</span>
            <Button variant="ghost" size="icon" aria-label="Collapse code editor" title="Collapse code editor" @click="toggleCodePanel">
              <IconChevronLeft :size="16" />
            </Button>
          </div>
        </div>
        <div class="code-body">
          <nav class="file-tree" aria-label="Generated files">
            <span class="tree-title">Files</span>
            <button
              v-for="file in fileList"
              :key="file.path"
              :class="{ active: file.path === activePath }"
              @click="openFile(file.path)"
            >
              <IconFileCode :size="15" />
              <span>{{ file.path }}</span>
            </button>
            <p v-if="!fileList.length" class="tree-empty">Waiting for the first file...</p>
          </nav>
          <div class="editor-wrap">
            <Tabs v-if="activeFile" v-model="activePath" class="editor-tabs-root">
              <TabsList class="editor-tabs" aria-label="Open files">
                <TabsTrigger v-for="path in openTabs" :key="path" :value="path" class="editor-tab">
                  <IconFileCode :size="14" />
                  <span>{{ path }}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <MonacoEditor
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

      <div
        v-if="!codeCollapsed && !previewCollapsed"
        class="panel-resizer"
        role="separator"
        aria-label="Resize code editor and preview"
        aria-orientation="vertical"
        tabindex="0"
        @pointerdown.prevent="startPanelResize"
        @keydown="resizePanelsWithKeyboard"
      ><span /></div>

      <section class="panel preview-panel" :class="{ 'mobile-active': mobilePanel === 'preview', 'is-collapsed': previewCollapsed }">
        <Button
          v-if="previewCollapsed"
          class="collapsed-panel-button"
          variant="ghost"
          size="icon"
          aria-label="Expand preview"
          title="Expand preview"
          @click="previewCollapsed = false"
        ><IconExternalLink :size="17" /></Button>
        <div class="panel-toolbar">
          <div class="toolbar-title"><IconExternalLink :size="16" /><span>Preview</span></div>
          <div class="preview-actions">
            <span class="preview-url">genesis.local</span>
            <Button variant="ghost" size="icon" aria-label="Open preview in new tab" title="Open preview in new tab" @click="openPreviewInNewTab">
              <IconExternalLink :size="16" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Refresh preview" @click="refreshPreview">
              <IconRefresh :size="16" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Collapse preview" title="Collapse preview" @click="togglePreviewPanel">
              <IconChevronRight :size="16" />
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
            :key="previewFrameKey"
            title="Generated HighLevel application preview"
            sandbox="allow-scripts allow-forms"
            :srcdoc="previewDocument"
          />
        </div>
      </section>
    </section>

    <Sheet v-model:open="snapshotOpen">
        <SheetContent aria-describedby="snapshot-description">
        <div class="dialog-heading">
          <div>
            <SheetTitle id="snapshot-title">Snapshot history</SheetTitle>
            <SheetDescription id="snapshot-description">Every successful generation can be restored.</SheetDescription>
          </div>
          <SheetClose as-child>
            <Button variant="ghost" size="icon" aria-label="Close snapshot history">×</Button>
          </SheetClose>
        </div>
        <p v-if="snapshotLoading" class="snapshot-empty">Loading snapshots…</p>
        <p v-else-if="snapshotError" class="form-error" role="alert">{{ snapshotError }}</p>
        <p v-else-if="!snapshots.length" class="snapshot-empty">No snapshots yet. Generate an app to create the first one.</p>
        <div v-else class="snapshot-list">
          <article v-for="snapshot in snapshots" :key="snapshot.id" class="snapshot-row">
            <div>
              <div class="snapshot-meta">
                <strong>{{ new Date(snapshot.createdAt).toLocaleString() }}</strong>
                <Badge v-if="snapshot.id === currentSnapshotId">Current</Badge>
                <Badge v-else>{{ snapshot.kind === 'partial' ? 'Partial' : snapshot.kind === 'backup' ? 'Backup' : snapshot.provider }}</Badge>
              </div>
              <p v-if="snapshot.prompt"><strong>Request:</strong> {{ snapshot.prompt }}</p>
              <p v-if="snapshot.summary"><strong>Result:</strong> {{ snapshot.summary }}</p>
              <span>{{ snapshot.fileCount }} files, {{ snapshot.provider }}</span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              :disabled="snapshot.id === currentSnapshotId || Boolean(restoringSnapshotId)"
              @click="restoreSnapshot(snapshot)"
            >
              {{ restoringSnapshotId === snapshot.id ? 'Restoring…' : 'Restore' }}
            </Button>
          </article>
        </div>
        </SheetContent>
    </Sheet>

    <Sheet v-model:open="attentionOpen">
      <SheetContent aria-describedby="attention-description">
        <div class="dialog-heading">
          <div>
            <SheetTitle>Workspace needs attention</SheetTitle>
            <SheetDescription id="attention-description">Details from the latest failed operation.</SheetDescription>
          </div>
          <SheetClose as-child><Button variant="ghost" size="icon" aria-label="Close issue details">×</Button></SheetClose>
        </div>
        <div class="attention-detail" role="alert">
          <strong>What happened</strong>
          <p>{{ generationError }}</p>
          <span v-if="generationError.includes('401') || generationError.toLowerCase().includes('sign in')">
            Refresh your sign-in first. If the message names OPENAI_API_KEY, update that Firebase secret and redeploy the generation function.
          </span>
        </div>
      </SheetContent>
    </Sheet>

    <Dialog v-model:open="projectEditorOpen">
      <DialogContent aria-describedby="rename-project-description">
        <form @submit.prevent="saveProjectName">
          <div class="dialog-heading">
            <div>
              <DialogTitle>Rename project</DialogTitle>
              <DialogDescription id="rename-project-description">Change the name shown in the workspace and project list.</DialogDescription>
            </div>
            <DialogClose as-child><Button type="button" variant="ghost" size="icon" aria-label="Close rename dialog">×</Button></DialogClose>
          </div>
          <label for="workspace-project-name">Project name</label>
          <Input id="workspace-project-name" v-model="projectName" required autofocus />
          <p v-if="projectEditError" class="form-error" role="alert">{{ projectEditError }}</p>
          <div class="dialog-actions">
            <DialogClose as-child><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" :disabled="projectSaving || !projectName.trim()">{{ projectSaving ? 'Saving' : 'Save name' }}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    <Sheet v-model:open="diffOpen">
      <SheetContent class="diff-dialog" aria-describedby="diff-description">
        <div class="dialog-heading">
          <div>
            <SheetTitle>Generation changes</SheetTitle>
            <SheetDescription id="diff-description">Line changes from the files that existed before the latest generation.</SheetDescription>
          </div>
          <SheetClose as-child><Button variant="ghost" size="icon" aria-label="Close generation changes">×</Button></SheetClose>
        </div>
        <p v-if="!generationDiffs.length" class="snapshot-empty">Generate a revision to see its changes.</p>
        <div v-else class="diff-files">
          <section v-for="file in generationDiffs" :key="file.path" class="diff-file">
            <header><strong>{{ file.path }}</strong><span class="diff-added">+{{ file.added }}</span><span class="diff-removed">-{{ file.removed }}</span></header>
            <pre aria-label="Line-by-line generation diff"><code><span v-for="(line, index) in file.lines" :key="`${file.path}-${index}`" class="diff-line" :class="`diff-${line.kind}`"><i>{{ line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ' }}</i>{{ line.value || ' ' }}</span></code></pre>
          </section>
        </div>
      </SheetContent>
    </Sheet>

    <AlertDialog :open="Boolean(pendingWriteRequest)" @update:open="(open) => { if (!open) cancelHighLevelWrite() }">
      <AlertDialogContent aria-describedby="highlevel-write-description">
        <AlertDialogTitle>Confirm HighLevel change</AlertDialogTitle>
        <AlertDialogDescription id="highlevel-write-description">
          This generated app wants to {{ writeConfirmationLabel }}. This changes data in the connected location and cannot be simulated in the preview.
        </AlertDialogDescription>
        <div class="dialog-actions">
          <AlertDialogCancel as-child><Button variant="ghost" @click="cancelHighLevelWrite">Cancel</Button></AlertDialogCancel>
          <AlertDialogAction as-child><Button @click="confirmHighLevelWrite">Confirm change</Button></AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>

    <footer class="statusbar">
      <span>{{ fileList.length }} files</span>
      <span v-if="currentSnapshotId">Snapshot ready</span>
      <span>{{ highLevelStore.connection.connected ? 'HighLevel live' : 'HighLevel demo data' }}</span>
      <span v-if="bridgeError" class="error-message">{{ bridgeError }}</span>
      <span>{{ activeModel }} / {{ streamSourceLabel }}</span>
    </footer>
  </main>
</template>
