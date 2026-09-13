<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQueryClient } from '@tanstack/vue-query'
import { collection, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore'
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBraces,
  IconChevronLeft,
  IconChevronRight,
  IconChevronDown,
  IconCode,
  IconCommand,
  IconDownload,
  IconEdit,
  IconFileDiff,
  IconExternalLink,
  IconFileCode,
  IconHistory,
  IconLayoutSidebarLeftCollapse,
  IconLoader2,
  IconMessage,
  IconPlayerStop,
  IconRefresh,
  IconSend,
  IconSparkles,
  IconX,
} from '@tabler/icons-vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { renderChatMarkdown } from '@/lib/markdown'
import { requireFirestore } from '@/services/firebase'
import { hlEventLabel } from '@/lib/highlevel-events'
import { buildSrcdoc } from '@/lib/srcdoc'
import { buildGenerationDiff, firstChangedLine, type GenerationFileDiff } from '@/lib/generation-diff'
import { buildProjectArchive, projectArchiveFilename } from '@/lib/project-archive'
import { animateEntrance, animateFeedback } from '@/lib/motion'
import { useIntegrationStatusQuery } from '@/composables/server-state'
import { useTypewriter } from '@/composables/typewriter'
import { useTextPacer } from '@/composables/textPacer'
import { useDiffReveal } from '@/composables/useDiffReveal'
import DiffFileList from '@/components/workspace/DiffFileList.vue'
import CommandPalette from '@/components/workspace/CommandPalette.vue'
import ShortcutsDialog from '@/components/workspace/ShortcutsDialog.vue'
import SnapshotHistory from '@/components/workspace/SnapshotHistory.vue'
import SuggestionChips from '@/components/workspace/SuggestionChips.vue'
import { useShortcuts } from '@/composables/useShortcuts'
import {
  cancelApplicationGeneration,
  generateApplication,
  listApplicationSnapshots,
  loadApplicationState,
  loadSnapshotFiles,
  restoreApplicationSnapshot,
  saveApplicationFiles,
  updateSnapshotField,
} from '@/services/generation'
import { useAuthStore } from '@/stores/auth'
import { useHighLevelStore } from '@/stores/highlevel'
import { useProjectsStore } from '@/stores/projects'
import {
  generationModels,
  isGenerationModel,
  type ChatMessage,
  type GeneratedFile,
  type GenerationEvent,
  type GenerationModel,
  type ProjectSnapshot,
} from '@/types/generation'
import { highLevelOperationSet, type HighLevelOperation, type HighLevelParameters } from '@/types/highlevel'

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
const MonacoDiffEditor = defineAsyncComponent({
  loader: () => import('@guolao/vue-monaco-editor').then((module) => module.VueMonacoDiffEditor),
  loadingComponent: { template: '<div class="editor-empty">Loading editor...</div>' },
})
const workspaceRoot = ref<HTMLElement>()
const messagesContainer = ref<HTMLElement>()
const files = ref<Record<string, GeneratedFile>>({})
const activePath = ref('')
const openTabs = ref<string[]>([])
const messageTypewriter = useTypewriter()
const typingMessageId = ref<string>()
const fileTypewriter = useTextPacer()
const streamingFilePath = ref<string>()
const messages = ref<ChatMessage[]>([
  {
    id: 'welcome',
    role: 'assistant',
    content: 'Describe a HighLevel workflow or dashboard. I will generate a small, reviewable app and show each file as it is written.',
  },
])
const prompt = ref('')
const selectedModel = ref<GenerationModel>('gpt-5.4-mini')
const isLoadingProject = ref(true)
const isGenerating = ref(false)
const isStopping = ref(false)
const generationError = ref('')
const previewDocument = ref(buildSrcdoc(files.value))
const previewFrame = ref<HTMLIFrameElement>()
const previewFrameKey = ref(0)
const bridgeError = ref('')
const hlLiveEvent = ref<{ label: string } | undefined>()
let hlLiveEventTimer: number | undefined
let stopHlEventsListener: (() => void) | undefined
const diffOpen = ref(false)
const generationDiffs = ref<GenerationFileDiff[]>([])
const lastGenerationBefore = ref<Record<string, GeneratedFile>>()
const showInlineDiff = ref(false)
type BridgeResponse = { ok: true; data: unknown } | { ok: false; error: string }
type BridgeRequest = {
  requestId: string
  operation: HighLevelOperation
  parameters: HighLevelParameters
  sourceId: string
  respond: (response: BridgeResponse) => void
}
const snapshotOpen = ref(false)
const snapshots = ref<ProjectSnapshot[]>([])
const snapshotLoading = ref(false)
const snapshotError = ref('')
const restoringSnapshotId = ref<string>()
const expandedSnapshotId = ref<string>()
const snapshotCompareDiff = ref<GenerationFileDiff[]>([])
const snapshotCompareLoading = ref(false)
const snapshotCompareError = ref('')
const snapshotFilesCache = new Map<string, Record<string, string>>()
const renamingSnapshotId = ref<string>()
const snapshotRenameError = ref('')
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const stoppedNotice = ref('')
const filesTouchedThisGeneration = ref<string[]>([])
const currentGenerationId = ref<string>()
const currentSnapshotId = ref<string>()
const mobilePanel = ref<'chat' | 'code' | 'preview'>('chat')
const chatCollapsed = ref(false)
const codeCollapsed = ref(false)
const previewCollapsed = ref(false)
const chatWidth = ref(330)
const codeShare = ref(52)
const attentionOpen = ref(false)
const commandPaletteOpen = ref(false)
const shortcutsOpen = ref(false)
const projectEditorOpen = ref(false)
const projectName = ref('')
const projectEditError = ref('')
const projectSaving = ref(false)
const hasOpenOverlay = computed(() => (
  snapshotOpen.value
  || attentionOpen.value
  || projectEditorOpen.value
  || diffOpen.value
  || commandPaletteOpen.value
  || shortcutsOpen.value
))
let controller: AbortController | undefined
let filesBeforeGeneration: Record<string, GeneratedFile> | undefined
const refinementPaths = new Set<string>()
const refinementBuffers = new Map<string, string>()
const diffReveals = new Map<string, ReturnType<typeof useDiffReveal>>()
let saveTimer: number | undefined
let savedIndicatorTimer: number | undefined
let cancelFallbackTimer: number | undefined
const bridgeRequests = new Set<string>()
let workspaceAnimation: { cancel?: () => void } | undefined
let codeEditor: { revealLineInCenter: (lineNumber: number) => void } | undefined

const activeFile = computed(() => files.value[activePath.value])
const fileList = computed(() => Object.values(files.value))
const activeFileDiff = computed(() => generationDiffs.value.find((file) => file.path === activePath.value))
const activeFileDisplayContent = computed(() => {
  if (!activeFile.value) return ''
  if (streamingFilePath.value !== activePath.value) return activeFile.value.content
  return activeFile.value.content.slice(0, fileTypewriter.revealedLength.value)
})
const statusLabel = computed(() => {
  if (generationError.value) return 'Needs attention'
  if (isStopping.value) return 'Stopping'
  if (isGenerating.value) return 'Generating'
  return 'Ready'
})
const projectId = computed(() => String(route.params.projectId ?? 'local-demo'))
const projectTitle = computed(() => projectsStore.projects.find((project) => project.id === projectId.value)?.name ?? 'Untitled project')
const workspaceStyle = computed(() => {
  const chat = chatCollapsed.value ? 'minmax(44px, 44px)' : `minmax(250px, ${chatWidth.value}px)`
  const chatResizer = chatCollapsed.value ? 'minmax(0px, 0fr)' : 'minmax(6px, 0fr)'
  const code = codeCollapsed.value
    ? 'minmax(44px, 0fr)'
    : previewCollapsed.value
      ? 'minmax(360px, 100fr)'
      : `minmax(280px, ${codeShare.value}fr)`
  const resizer = codeCollapsed.value || previewCollapsed.value ? 'minmax(0px, 0fr)' : 'minmax(6px, 0fr)'
  const preview = previewCollapsed.value
    ? 'minmax(44px, 0fr)'
    : codeCollapsed.value
      ? 'minmax(320px, 100fr)'
      : `minmax(300px, ${100 - codeShare.value}fr)`
  return { gridTemplateColumns: `${chat} ${chatResizer} ${code} ${resizer} ${preview}` }
})

function cloneFiles(source: Record<string, GeneratedFile>) {
  return Object.fromEntries(Object.entries(source).map(([path, file]) => [path, { ...file }]))
}

function renderPreview() {
  previewDocument.value = buildSrcdoc(files.value, { enableHighLevelBridge: highLevelStore.connection.connected })
}

function toggleChatPanel() {
  chatCollapsed.value = !chatCollapsed.value
}

function focusComposer() {
  chatCollapsed.value = false
  mobilePanel.value = 'chat'
  nextTick(() => document.getElementById('prompt')?.focus())
}

function toggleCodePanel() {
  codeCollapsed.value = !codeCollapsed.value
  if (codeCollapsed.value) previewCollapsed.value = false
}

function togglePreviewPanel() {
  previewCollapsed.value = !previewCollapsed.value
  if (previewCollapsed.value) codeCollapsed.value = false
}

function maxChatPanelWidth() {
  const workspace = workspaceRoot.value?.querySelector<HTMLElement>('.workspace')
  const availableWidth = workspace?.offsetWidth ?? 0
  return Math.max(250, Math.min(520, availableWidth - 592))
}

function startChatPanelResize(event: PointerEvent) {
  if (chatCollapsed.value) return
  const maxWidth = maxChatPanelWidth()
  const startX = event.clientX
  const startWidth = chatWidth.value
  const move = (moveEvent: PointerEvent) => {
    chatWidth.value = Math.min(maxWidth, Math.max(250, startWidth + moveEvent.clientX - startX))
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    document.body.classList.remove('is-resizing-panels')
  }
  document.body.classList.add('is-resizing-panels')
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop, { once: true })
  window.addEventListener('pointercancel', stop, { once: true })
}

function resizeChatPanelWithKeyboard(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  chatWidth.value = Math.min(maxChatPanelWidth(), Math.max(250, chatWidth.value + (event.key === 'ArrowRight' ? 16 : -16)))
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
  showInlineDiff.value = !isGenerating.value && generationDiffs.value.some((file) => file.path === path)
}

function handleEditorMount(editor: { revealLineInCenter: (lineNumber: number) => void }) {
  codeEditor = editor
}

function scrollToFirstChange(path: string, before: string, after: string) {
  const line = firstChangedLine(before, after)
  if (line === undefined || activePath.value !== path) return
  nextTick(() => {
    if (activePath.value === path) codeEditor?.revealLineInCenter(line)
  })
}

function parseBridgeRequest(data: Record<string, unknown> | null, sourceId: string, respond: BridgeRequest['respond']) {
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
    sourceId,
    respond,
  }
}

function postBridgeResponse(request: BridgeRequest, response: BridgeResponse) {
  request.respond(response)
}

async function executeBridgeRequest(request: BridgeRequest) {
  bridgeError.value = ''
  try {
    const data = await highLevelStore.execute(request.operation, request.parameters)
    postBridgeResponse(request, { ok: true, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'HighLevel request failed.'
    bridgeError.value = message
    postBridgeResponse(request, { ok: false, error: message })
  } finally {
    bridgeRequests.delete(request.requestId)
  }
}

async function processHighLevelBridgeMessage(
  data: Record<string, unknown> | null,
  sourceId: string,
  respond: BridgeRequest['respond'],
) {
  const request = parseBridgeRequest(data, sourceId, respond)
  if (!request || bridgeRequests.has(request.requestId) || bridgeRequests.size >= 8) return
  bridgeRequests.add(request.requestId)
  await executeBridgeRequest(request)
}

async function handleHighLevelBridge(event: MessageEvent) {
  if (event.source !== previewFrame.value?.contentWindow) return
  const respond: BridgeRequest['respond'] = (response) => {
    previewFrame.value?.contentWindow?.postMessage({
      channel: 'genesis.highlevel.v1', direction: 'response', requestId: event.data?.requestId, ...response,
    }, '*')
  }
  await processHighLevelBridgeMessage(event.data as Record<string, unknown> | null, 'iframe', respond)
}

function forwardHighLevelEvent(hlEvent: { type: string; payload: unknown }) {
  hlLiveEvent.value = { label: hlEventLabel(hlEvent.type) }
  window.clearTimeout(hlLiveEventTimer)
  hlLiveEventTimer = window.setTimeout(() => { hlLiveEvent.value = undefined }, 6000)
  previewFrame.value?.contentWindow?.postMessage({
    channel: 'genesis.highlevel.v1', direction: 'event', event: hlEvent,
  }, '*')
}

function startHlEventsListener() {
  const uid = authStore.user?.uid
  if (!uid) return
  const eventsQuery = query(
    collection(requireFirestore(), 'users', uid, 'hlEvents'),
    where('createdAt', '>', Timestamp.now()),
    orderBy('createdAt', 'asc'),
  )
  stopHlEventsListener = onSnapshot(eventsQuery, (snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type !== 'added') continue
      const data = change.doc.data()
      forwardHighLevelEvent({ type: data.type, payload: data.payload })
    }
  }, (error) => console.error('Could not watch HighLevel events', error))
}

onMounted(async () => {
  window.addEventListener('message', handleHighLevelBridge)
  startHlEventsListener()
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
      queryFn: async () => loadApplicationState(projectId.value, await authStore.getIdToken()),
    })
    if (state?.files) {
      hydrateFiles(state.files)
      renderPreview()
      currentSnapshotId.value = state.snapshotId
    }
    if (state?.messages?.length) messages.value = state.messages
  } catch (error) {
    generationError.value = error instanceof Error ? error.message : 'Could not load this project.'
  } finally {
    isLoadingProject.value = false
  }
  await nextTick()
  workspaceAnimation = await animateEntrance(workspaceRoot.value?.querySelectorAll('.panel') ?? [], { y: { from: 8 }, delay: 0 })
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleHighLevelBridge)
  stopHlEventsListener?.()
  window.clearTimeout(hlLiveEventTimer)
  if (saveTimer) window.clearTimeout(saveTimer)
  if (savedIndicatorTimer) window.clearTimeout(savedIndicatorTimer)
  if (cancelFallbackTimer) window.clearTimeout(cancelFallbackTimer)
  controller?.abort()
  clearRefinementState()
  workspaceAnimation?.cancel?.()
})
watch(() => highLevelStore.connection.connected, renderPreview)
watch(() => highLevelStore.llm.model, (model) => {
  if (isGenerationModel(model)) selectedModel.value = model
}, { immediate: true })
watch([() => messageTypewriter.revealedLength.value, () => messages.value.length], () => {
  const container = messagesContainer.value
  if (!container) return
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80
  if (nearBottom) nextTick(() => { container.scrollTop = container.scrollHeight })
})

function updateActiveFile(content: string) {
  if (!activeFile.value || isGenerating.value) return
  files.value[activePath.value] = { ...activeFile.value, content }
  currentSnapshotId.value = undefined
  saveStatus.value = 'saving'
  if (saveTimer) window.clearTimeout(saveTimer)
  if (savedIndicatorTimer) window.clearTimeout(savedIndicatorTimer)
  saveTimer = window.setTimeout(persistManualFiles, 700)
}

async function persistManualFiles(): Promise<boolean> {
  try {
    const { snapshotId } = await saveApplicationFiles(projectId.value, files.value, await authStore.getIdToken())
    if (snapshotId) currentSnapshotId.value = snapshotId
    saveStatus.value = 'saved'
    if (savedIndicatorTimer) window.clearTimeout(savedIndicatorTimer)
    savedIndicatorTimer = window.setTimeout(() => {
      if (saveStatus.value === 'saved') saveStatus.value = 'idle'
    }, 2500)
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
  expandedSnapshotId.value = undefined
  try {
    await queryClient.invalidateQueries({ queryKey: ['project-snapshots', projectId.value] })
    snapshots.value = await queryClient.fetchQuery({
      queryKey: ['project-snapshots', projectId.value],
      queryFn: async () => listApplicationSnapshots(projectId.value, await authStore.getIdToken()),
    })
    const latestSnapshot = snapshots.value[0]
    if (latestSnapshot) await toggleSnapshotCompare(latestSnapshot, 0)
  } catch (error) {
    snapshotError.value = error instanceof Error ? error.message : 'Could not load snapshot history.'
  } finally {
    snapshotLoading.value = false
  }
}

function toGeneratedFiles(source: Record<string, string>): Record<string, GeneratedFile> {
  return Object.fromEntries(Object.entries(source).map(([path, content]) => [path, {
    path,
    content,
    language: path.endsWith('.js') ? 'javascript' : path.endsWith('.css') ? 'css' : 'html',
  }]))
}

async function fetchSnapshotFiles(snapshotId: string) {
  const cached = snapshotFilesCache.get(snapshotId)
  if (cached) return cached
  const fetched = await loadSnapshotFiles(projectId.value, snapshotId, await authStore.getIdToken())
  snapshotFilesCache.set(snapshotId, fetched)
  return fetched
}

async function toggleSnapshotCompare(snapshot: ProjectSnapshot, index: number) {
  if (expandedSnapshotId.value === snapshot.id) {
    expandedSnapshotId.value = undefined
    return
  }
  expandedSnapshotId.value = snapshot.id
  snapshotCompareError.value = ''
  snapshotCompareDiff.value = []
  snapshotCompareLoading.value = true
  try {
    const olderSnapshot = snapshots.value[index + 1]
    const [olderFiles, newerFiles] = await Promise.all([
      olderSnapshot ? fetchSnapshotFiles(olderSnapshot.id) : Promise.resolve({}),
      fetchSnapshotFiles(snapshot.id),
    ])
    snapshotCompareDiff.value = buildGenerationDiff(toGeneratedFiles(olderFiles), toGeneratedFiles(newerFiles))
  } catch (error) {
    snapshotCompareError.value = error instanceof Error ? error.message : 'Could not load this comparison.'
  } finally {
    snapshotCompareLoading.value = false
  }
}

async function editSnapshotField(snapshot: ProjectSnapshot, field: 'message' | 'description', value: string) {
  renamingSnapshotId.value = snapshot.id
  snapshotRenameError.value = ''
  try {
    await updateSnapshotField(projectId.value, snapshot.id, field, value, await authStore.getIdToken())
    const target = snapshots.value.find((entry) => entry.id === snapshot.id)
    if (target) {
      if (field === 'message') target.label = value
      else target.summary = value
    }
    await queryClient.invalidateQueries({ queryKey: ['project-snapshots', projectId.value] })
  } catch (error) {
    snapshotRenameError.value = error instanceof Error ? error.message : 'Could not update this snapshot.'
  } finally {
    renamingSnapshotId.value = undefined
  }
}

async function restoreSnapshot(snapshot: ProjectSnapshot) {
  if (snapshot.id === currentSnapshotId.value || restoringSnapshotId.value) return
  if (saveTimer) window.clearTimeout(saveTimer)
  restoringSnapshotId.value = snapshot.id
  snapshotError.value = ''
  try {
    const restored = await restoreApplicationSnapshot(projectId.value, snapshot.id, await authStore.getIdToken())
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

function messageText(message: ChatMessage) {
  if (message.id !== typingMessageId.value) return message.content
  return message.content.slice(0, messageTypewriter.revealedLength.value)
}

function isMessageTyping(message: ChatMessage) {
  return message.id === typingMessageId.value
}

function renderedMessageHtml(message: ChatMessage) {
  return renderChatMarkdown(messageText(message))
}

function handleEvent(event: GenerationEvent) {
  switch (event.type) {
    case 'generation_started':
      currentGenerationId.value = event.generationId
      if (event.model && isGenerationModel(event.model)) selectedModel.value = event.model
      break
    case 'token': {
      const last = messages.value.at(-1)
      if (last?.role === 'assistant' && last.id === currentGenerationId.value) {
        last.content += event.delta
      } else {
        const created: ChatMessage = { id: currentGenerationId.value ?? crypto.randomUUID(), role: 'assistant', content: event.delta }
        messages.value.push(created)
        typingMessageId.value = created.id
        messageTypewriter.reset()
        messageTypewriter.start(() => created.content)
      }
      break
    }
    case 'file_start': {
      const existedBefore = Boolean(filesBeforeGeneration?.[event.path]?.content)
      if (existedBefore) {
        // Refinement of a file that already has content: keep the old content on screen and
        // buffer the incoming stream silently, so only the eventual diff animates in, not a
        // full clear-and-retype of the whole file.
        refinementPaths.add(event.path)
        refinementBuffers.set(event.path, '')
      } else {
        refinementPaths.delete(event.path)
        files.value[event.path] = { path: event.path, language: event.language, content: '' }
        streamingFilePath.value = event.path
        fileTypewriter.reset()
        fileTypewriter.start(() => files.value[event.path]?.content ?? '')
      }
      openFile(event.path)
      mobilePanel.value = 'code'
      if (!filesTouchedThisGeneration.value.includes(event.path)) filesTouchedThisGeneration.value.push(event.path)
      break
    }
    case 'file_delta': {
      if (refinementPaths.has(event.path)) {
        refinementBuffers.set(event.path, (refinementBuffers.get(event.path) ?? '') + event.delta)
        break
      }
      const file = files.value[event.path]
      if (file) {
        files.value[event.path] = { ...file, content: file.content + event.delta }
        fileTypewriter.wake()
      }
      break
    }
    case 'file_complete': {
      if (refinementPaths.has(event.path)) {
        const before = filesBeforeGeneration?.[event.path]?.content ?? ''
        const after = refinementBuffers.get(event.path) ?? ''
        refinementPaths.delete(event.path)
        refinementBuffers.delete(event.path)
        if (after.length !== event.size) {
          generationError.value = `The stream for ${event.path} ended unexpectedly. Partial output has been preserved.`
        }
        const reveal = useDiffReveal()
        diffReveals.get(event.path)?.stop()
        diffReveals.set(event.path, reveal)
        reveal.start(before, after, (text) => {
          const file = files.value[event.path]
          if (file) files.value[event.path] = { ...file, content: text }
        })
        scrollToFirstChange(event.path, before, after)
        break
      }
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
      finishRefinementReveals()
      generationDiffs.value = filesBeforeGeneration ? buildGenerationDiff(filesBeforeGeneration, files.value) : []
      lastGenerationBefore.value = filesBeforeGeneration
      showInlineDiff.value = generationDiffs.value.some((file) => file.path === activePath.value)
      renderPreview()
      mobilePanel.value = 'preview'
      filesBeforeGeneration = undefined
      messageTypewriter.finish()
      typingMessageId.value = undefined
      fileTypewriter.finish()
      streamingFilePath.value = undefined
      break
    case 'error':
      if (!(isStopping.value && event.code === 'GENERATION_CANCELLED')) generationError.value = event.message
      finishRefinementReveals()
      messageTypewriter.finish()
      typingMessageId.value = undefined
      fileTypewriter.finish()
      streamingFilePath.value = undefined
      break
  }
}

async function submitPrompt(suggestion?: string) {
  const value = (suggestion ?? prompt.value).trim()
  if (!value || isGenerating.value) return
  if (!highLevelStore.connection.connected) {
    generationError.value = 'Connect HighLevel before generating an app, so the preview always shows real CRM data.'
    return
  }
  if (saveTimer) window.clearTimeout(saveTimer)
  if ((saveStatus.value === 'saving' || saveStatus.value === 'error') && !await persistManualFiles()) return
  prompt.value = ''
  generationError.value = ''
  stoppedNotice.value = ''
  filesTouchedThisGeneration.value = []
  showInlineDiff.value = false
  clearRefinementState()
  fileTypewriter.finish()
  streamingFilePath.value = undefined
  isGenerating.value = true
  messages.value.push({ id: crypto.randomUUID(), role: 'user', content: value })
  filesBeforeGeneration = cloneFiles(files.value)
  controller = new AbortController()
  currentGenerationId.value = crypto.randomUUID()

  try {
    await generateApplication({
      prompt: value,
      projectId: projectId.value,
      generationId: currentGenerationId.value,
      model: selectedModel.value,
      currentFiles: filesBeforeGeneration ?? {},
      idToken: await authStore.getIdToken(),
      signal: controller.signal,
      onEvent: handleEvent,
    })
  } catch (error) {
    if ((error as DOMException).name !== 'AbortError') {
      generationError.value = error instanceof Error ? error.message : 'Generation failed unexpectedly.'
    }
  } finally {
    const wasStopped = isStopping.value
    if (cancelFallbackTimer) window.clearTimeout(cancelFallbackTimer)
    cancelFallbackTimer = undefined
    isGenerating.value = false
    isStopping.value = false
    controller = undefined
    if (wasStopped) {
      stoppedNotice.value = `Stopped after ${filesTouchedThisGeneration.value.length} file${filesTouchedThisGeneration.value.length === 1 ? '' : 's'}. Nothing lost. Partial output stays in the editor.`
    }
    await nextTick()
  }
}

function clearRefinementState() {
  for (const reveal of diffReveals.values()) reveal.stop()
  diffReveals.clear()
  refinementPaths.clear()
  refinementBuffers.clear()
}

function finishRefinementReveals() {
  for (const reveal of diffReveals.values()) reveal.finish()
  diffReveals.clear()
}

async function stopGeneration() {
  if (!controller || isStopping.value) return
  const activeController = controller
  isStopping.value = true
  const generationId = currentGenerationId.value
  filesBeforeGeneration = undefined
  finishRefinementReveals()
  clearRefinementState()
  messageTypewriter.finish()
  typingMessageId.value = undefined
  fileTypewriter.finish()
  streamingFilePath.value = undefined
  stoppedNotice.value = 'Stopping generation… Partial output will stay in the editor.'
  if (!generationId) {
    activeController.abort()
    return
  }
  try {
    const result = await cancelApplicationGeneration(projectId.value, generationId, await authStore.getIdToken())
    if (result.status === 'not_running') {
      activeController.abort()
      return
    }
    if (controller === activeController && isStopping.value) {
      cancelFallbackTimer = window.setTimeout(() => activeController.abort(), 5_000)
    }
  } catch {
    // Closing the stream remains a reliable fallback if the explicit cancellation request fails.
    activeController.abort()
  }
}

function refreshPreview() {
  renderPreview()
  previewFrameKey.value += 1
  nextTick(() => {
    if (previewFrame.value) animateFeedback(previewFrame.value)
  })
}

async function openPreviewInNewTab() {
  bridgeError.value = ''
  const opened = window.open('', '_blank')
  if (!opened) {
    bridgeError.value = 'The preview tab was blocked. Allow pop-ups for this site and try again.'
    return
  }
  opened.opener = null
  const highLevelDirectProxy = highLevelStore.connection.connected && highLevelStore.functionsBase
    ? { functionsBase: highLevelStore.functionsBase, idToken: (await authStore.getIdToken()) ?? '' }
    : undefined
  const document = buildSrcdoc(files.value, {
    enableHighLevelBridge: Boolean(highLevelDirectProxy),
    highLevelDirectProxy,
  })
  const blob = new Blob([document], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  opened.location.href = url
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function downloadProjectArchive() {
  if (!fileList.value.length || isGenerating.value) return
  const archive = buildProjectArchive(Object.fromEntries(
    Object.entries(files.value).map(([path, file]) => [path, file.content]),
  ))
  const url = URL.createObjectURL(new Blob([archive], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = projectArchiveFilename(projectTitle.value)
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

async function signOutAndRedirect() {
  await authStore.signOut()
  await router.push('/sign-in')
}

const { list: shortcutsList } = useShortcuts([
  { keys: 'mod+k', description: 'Open the command palette', allowWhileEditing: true, handler: () => { commandPaletteOpen.value = true } },
  { keys: 'mod+/', description: 'Show keyboard shortcuts', allowWhileEditing: true, handler: () => { shortcutsOpen.value = true } },
  { keys: 'mod+enter', description: 'Send the current prompt', allowWhileEditing: true, handler: () => submitPrompt() },
  {
    keys: 'escape',
    description: 'Close the active dialog or stop the running generation',
    allowWhileEditing: true,
    handler: (event) => {
      // Let Reka UI dismiss the topmost dialog, sheet, or command palette.
      const startedInsideOverlay = event.target instanceof Element
        && Boolean(event.target.closest('[data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="alert-dialog-content"]'))
      if (hasOpenOverlay.value || startedInsideOverlay) return false
      if (!isGenerating.value) return false
      stopGeneration()
    },
  },
  { keys: 'mod+1', description: 'Switch to the chat panel (mobile)', handler: () => { mobilePanel.value = 'chat' } },
  { keys: 'mod+2', description: 'Switch to the code panel (mobile)', handler: () => { mobilePanel.value = 'code' } },
  { keys: 'mod+3', description: 'Switch to the preview panel (mobile)', handler: () => { mobilePanel.value = 'preview' } },
])
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
        <div class="action-group action-group--status">
          <Badge
            variant="secondary"
            :as="generationError ? 'button' : undefined"
            :type="generationError ? 'button' : undefined"
            :aria-label="generationError ? 'Show issue details' : undefined"
            class="status-badge"
            :class="{ active: isGenerating, attention: generationError }"
            @click="generationError ? (attentionOpen = true) : undefined"
          >{{ statusLabel }}</Badge>
        </div>

        <div class="action-group action-group--utility">
          <Button
            v-if="fileList.length"
            class="download-zip-button"
            variant="ghost"
            size="sm"
            :disabled="isGenerating"
            aria-label="Download current files as a ZIP"
            title="Download the current files as a ZIP"
            @click="downloadProjectArchive"
          >
            <IconDownload :size="15" /><span>Export</span>
          </Button>
          <span class="action-group-sep" aria-hidden="true"></span>
          <Button variant="ghost" size="icon-sm" aria-label="Open command palette (Cmd+K)" title="Command palette (Cmd+K)" @click="commandPaletteOpen = true">
            <IconCommand :size="16" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Open snapshot history" title="Snapshot history" @click="openSnapshotHistory">
            <IconHistory :size="16" />
          </Button>
        </div>
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
            <h1>Build with HighLevel</h1>
          </div>
          <Button variant="ghost" size="icon" aria-label="Collapse conversation" title="Collapse conversation" @click="chatCollapsed = true">
            <IconLayoutSidebarLeftCollapse :size="17" />
          </Button>
        </div>

        <div ref="messagesContainer" class="messages" aria-live="polite">
          <article v-for="message in messages" :key="message.id" class="message" :class="message.role">
            <span>{{ message.role === 'assistant' ? 'Genesis' : 'You' }}</span>
            <div
              v-if="message.role === 'assistant' && !isMessageTyping(message)"
              class="message-markdown"
              v-html="renderedMessageHtml(message)"
            />
            <p v-else>{{ messageText(message) }}<i v-if="isMessageTyping(message)" class="typing-cursor" /></p>
          </article>

          <div v-if="isGenerating" class="generation-progress">
            <IconSparkles :size="15" />
            <span v-if="isStopping">Stopping generation…</span>
            <span v-else>Writing file {{ filesTouchedThisGeneration.length }} · {{ activePath }}</span>
          </div>

          <p v-if="generationError" class="error-message">{{ generationError }}</p>
          <p v-if="stoppedNotice" class="stopped-notice">{{ stoppedNotice }}</p>
        </div>

        <div v-if="!highLevelStore.connection.connected" class="connect-gate">
          <p>Genesis only ever builds against your real CRM. Connect a HighLevel location to start generating.</p>
          <Button type="button" size="sm" :disabled="!highLevelStore.canConnect || highLevelStore.loading" @click="highLevelStore.connect">
            {{ highLevelStore.loading ? 'Checking' : 'Connect HighLevel' }}
          </Button>
        </div>

        <template v-else>
          <SuggestionChips @select="submitPrompt" />

          <form class="composer" @submit.prevent="submitPrompt()">
            <label for="prompt">Describe the app</label>
            <Textarea
              id="prompt"
              v-model="prompt"
              aria-label="Describe the HighLevel app to generate"
              placeholder="Build a contact dashboard with search..."
              :disabled="isGenerating"
              @keydown.enter.exact.prevent="submitPrompt()"
            />
            <div class="composer-footer">
              <div class="composer-statusbar">
                <label class="model-select" title="Choose the model for the next generation">
                  <span class="sr-only">Generation model</span>
                  <select v-model="selectedModel" :disabled="isGenerating" aria-label="Generation model">
                    <option v-for="model in generationModels" :key="model.value" :value="model.value">{{ model.label }}</option>
                  </select>
                  <IconChevronDown :size="12" aria-hidden="true" />
                </label>
                <span class="composer-hint"><kbd>Enter</kbd><span>to send</span></span>
              </div>
              <Button v-if="isGenerating" type="button" variant="secondary" size="icon" aria-label="Stop generation" :disabled="isStopping" @click="stopGeneration">
                <IconPlayerStop :size="15" />
              </Button>
              <Button v-else type="submit" size="icon" aria-label="Generate app" :disabled="!prompt.trim()">
                <IconSend :size="16" />
              </Button>
            </div>
          </form>
        </template>
      </aside>

      <div
        class="panel-resizer chat-panel-resizer"
        :class="{ 'is-disabled': chatCollapsed }"
        role="separator"
        aria-label="Resize conversation panel"
        aria-orientation="vertical"
        :aria-hidden="chatCollapsed"
        :aria-valuemin="250"
        :aria-valuemax="520"
        :aria-valuenow="Math.round(chatWidth)"
        :tabindex="chatCollapsed ? -1 : 0"
        @pointerdown.prevent="startChatPanelResize"
        @keydown="resizeChatPanelWithKeyboard"
      ><span /></div>

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
            <Button
              v-if="activeFileDiff"
              variant="ghost"
              size="sm"
              :class="{ 'diff-toggle-active': showInlineDiff }"
              aria-label="Toggle inline diff for this file"
              @click="showInlineDiff = !showInlineDiff"
            >
              <IconFileDiff :size="14" />
              <span class="diff-added">+{{ activeFileDiff.added }}</span>
              <span class="diff-removed">-{{ activeFileDiff.removed }}</span>
            </Button>
            <Button variant="ghost" size="icon" aria-label="Collapse code editor" title="Collapse code editor" @click="toggleCodePanel">
              <IconChevronLeft :size="16" />
            </Button>
          </div>
        </div>
        <div class="code-body" :class="{ 'is-empty': !fileList.length }">
          <nav v-if="fileList.length" class="file-tree" aria-label="Generated files">
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
          </nav>
          <div class="editor-wrap" :class="{ 'is-empty': !activeFile }">
            <Tabs v-if="activeFile" v-model="activePath" class="editor-tabs-root">
              <TabsList class="editor-tabs" aria-label="Open files">
                <TabsTrigger
                  v-for="path in openTabs"
                  :key="path"
                  :value="path"
                  class="editor-tab"
                >
                  <IconFileCode :size="12" />
                  <span>{{ path }}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <MonacoDiffEditor
              v-if="activeFile && showInlineDiff && activeFileDiff"
              :original="lastGenerationBefore?.[activePath]?.content ?? ''"
              :modified="activeFile.content"
              :language="activeFile.language"
              theme="vs-dark"
              :options="{
                automaticLayout: true,
                minimap: { enabled: false },
                fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
                fontSize: 13,
                lineHeight: 21,
                readOnly: true,
                renderSideBySide: false,
                scrollBeyondLastLine: false,
                renderLineHighlight: 'gutter',
              }"
            />
            <MonacoEditor
              v-else-if="activeFile"
              :value="activeFileDisplayContent"
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
              @mount="handleEditorMount"
              @update:value="updateActiveFile"
            />
            <div v-else-if="isLoadingProject" class="editor-empty code-empty-state is-loading" role="status" aria-label="Loading project files">
              <div class="code-empty-icon"><IconLoader2 :size="24" class="spin" /></div>
              <h2>Loading your workspace</h2>
              <p>Checking for existing files and recent changes.</p>
            </div>
            <div v-else class="editor-empty code-empty-state">
              <div class="code-empty-icon"><IconCode :size="25" /></div>
              <h2>No files yet</h2>
              <p>Describe what you want to build. Genesis will create each file here as it works.</p>
            </div>
          </div>
        </div>
      </section>

      <div
        class="panel-resizer"
        :class="{ 'is-disabled': codeCollapsed || previewCollapsed }"
        role="separator"
        aria-label="Resize code editor and preview"
        aria-orientation="vertical"
        :aria-hidden="codeCollapsed || previewCollapsed"
        :tabindex="codeCollapsed || previewCollapsed ? -1 : 0"
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
          <button
            type="button"
            class="toolbar-title preview-title-action"
            aria-label="Open preview in a new tab"
            title="Open preview in a new tab"
            @click="openPreviewInNewTab"
          ><IconExternalLink :size="16" /><span>Preview</span></button>
          <div class="preview-actions">
            <span v-if="hlLiveEvent" class="hl-event-pill">{{ hlLiveEvent.label }}</span>
            <span v-if="highLevelStore.connection.connected" class="preview-url">{{ highLevelStore.connection.locationName }}</span>
            <Button variant="ghost" size="icon" aria-label="Refresh preview" @click="refreshPreview">
              <IconRefresh :size="16" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Collapse preview" title="Collapse preview" @click="togglePreviewPanel">
              <IconChevronRight :size="16" />
            </Button>
          </div>
        </div>
        <div class="preview-stage" :class="{ 'is-empty': !fileList.length }">
          <div v-if="bridgeError" class="bridge-alert" role="alert">
            <IconAlertTriangle :size="16" />
            <div>
              <strong>HighLevel request failed</strong>
              <p>{{ bridgeError }}</p>
            </div>
            <Button variant="ghost" size="icon" aria-label="Dismiss" @click="bridgeError = ''">
              <IconX :size="14" />
            </Button>
          </div>
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

    <Dialog v-model:open="snapshotOpen">
      <DialogContent class="snapshot-workspace" aria-describedby="snapshot-description">
        <header class="snapshot-workspace-header">
          <div>
            <DialogTitle id="snapshot-title">Snapshot history</DialogTitle>
            <DialogDescription id="snapshot-description">Review file changes and restore an earlier workspace state.</DialogDescription>
          </div>
        </header>
        <SnapshotHistory
          :snapshots="snapshots"
          :loading="snapshotLoading"
          :error="snapshotError"
          :current-snapshot-id="currentSnapshotId"
          :restoring-snapshot-id="restoringSnapshotId"
          :expanded-snapshot-id="expandedSnapshotId"
          :compare-diff="snapshotCompareDiff"
          :compare-loading="snapshotCompareLoading"
          :compare-error="snapshotCompareError"
          :renaming-snapshot-id="renamingSnapshotId"
          :rename-error="snapshotRenameError"
          @restore="restoreSnapshot"
          @compare="toggleSnapshotCompare"
          @edit-field="editSnapshotField"
        />
      </DialogContent>
    </Dialog>

    <Sheet v-model:open="attentionOpen">
      <SheetContent class="snapshot-dialog" aria-describedby="attention-description">
        <div class="dialog-heading">
          <div>
            <SheetTitle>Workspace needs attention</SheetTitle>
            <SheetDescription id="attention-description">Details from the latest failed operation.</SheetDescription>
          </div>
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
      <DialogContent class="project-dialog" aria-describedby="rename-project-description">
        <form @submit.prevent="saveProjectName">
          <div class="dialog-heading">
            <div>
              <DialogTitle>Rename project</DialogTitle>
              <DialogDescription id="rename-project-description">Change the name shown in the workspace and project list.</DialogDescription>
            </div>
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
      <SheetContent class="snapshot-dialog sm:max-w-2xl" aria-describedby="diff-description">
        <div class="dialog-heading">
          <div>
            <SheetTitle>Generation changes</SheetTitle>
            <SheetDescription id="diff-description">Line changes from the files that existed before the latest generation.</SheetDescription>
          </div>
        </div>
        <DiffFileList :files="generationDiffs" empty-message="Generate a revision to see its changes." />
      </SheetContent>
    </Sheet>

    <CommandPalette
      v-model:open="commandPaletteOpen"
      :is-generating="isGenerating"
      :can-export="Boolean(fileList.length)"
      @go-to-projects="router.push('/projects')"
      @rename-project="openProjectEditor"
      @open-snapshot-history="openSnapshotHistory"
      @download-zip="downloadProjectArchive"
      @open-shortcuts="shortcutsOpen = true"
      @stop-generation="stopGeneration"
      @focus-composer="focusComposer"
      @toggle-chat-panel="toggleChatPanel"
      @toggle-code-panel="toggleCodePanel"
      @toggle-preview-panel="togglePreviewPanel"
      @sign-out="signOutAndRedirect"
    />
    <ShortcutsDialog v-model:open="shortcutsOpen" :shortcuts="shortcutsList" />
  </main>
</template>
