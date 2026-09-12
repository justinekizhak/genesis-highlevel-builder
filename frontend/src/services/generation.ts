import type { ChatMessage, GeneratedFile, GenerationEvent, ProjectSnapshot } from '@/types/generation'

type GenerateOptions = {
  prompt: string
  projectId: string
  currentFiles: Record<string, GeneratedFile>
  idToken?: string
  signal: AbortSignal
  onEvent: (event: GenerationEvent) => void
}

const demoFiles = {
  'index.html': `<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.12"></script>
<script src="https://cdn.jsdelivr.net/npm/vue@3.5.20/dist/vue.global.prod.js"></script>
<main id="app" class="shell">
  <header>
    <div>
      <p class="eyebrow">HighLevel workspace</p>
      <h1>Contact pulse</h1>
      <p class="subtitle">Recent relationships and next appointments in one focused view.</p>
    </div>
    <button :disabled="loading" @click="loadDashboard">{{ loading ? 'Refreshing...' : 'Refresh' }}</button>
  </header>
  <section class="summary" aria-label="Summary">
    <article><span>Active contacts</span><strong>{{ filteredContacts.length }}</strong></article>
    <article><span>Appointments</span><strong>{{ appointmentStatus }}</strong></article>
  </section>
  <section class="list-section">
    <div class="section-heading"><h2>Recent contacts</h2><input v-model="search" aria-label="Search contacts" placeholder="Search contacts" /></div>
    <div class="contact-list">
      <p v-if="error" class="empty" role="alert">{{ error }}</p>
      <p v-else-if="loading" class="empty">Loading HighLevel data...</p>
      <p v-else-if="!filteredContacts.length" class="empty">No contacts found.</p>
      <article v-for="contact in filteredContacts" :key="contact.id || contact.email" class="contact">
        <strong>{{ contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unnamed contact' }}</strong>
        <span>{{ contact.email || 'No email' }}</span>
        <span>{{ contact.added || 'Recent' }}</span>
      </article>
    </div>
  </section>
</main>`,
  'styles.css': `:root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #141411; color: #f4f1e8; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: #141411; }
.shell { max-width: 980px; margin: 0 auto; padding: 42px 34px; }
header, .section-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; }
.eyebrow { color: #e8bd62; font: 600 11px/1.2 ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin: 8px 0; font-size: clamp(34px, 6vw, 58px); letter-spacing: -.05em; }
.subtitle { color: #9e9b91; max-width: 520px; }
button, input { border: 1px solid #45443e; border-radius: 7px; background: #201f1b; color: inherit; padding: 10px 14px; }
button { background: #e8bd62; color: #1b1914; font-weight: 700; cursor: pointer; }
.summary { display: grid; grid-template-columns: 1fr 1fr; margin: 42px 0; border-block: 1px solid #33322d; }
.summary article { padding: 24px 0; }
.summary article + article { border-left: 1px solid #33322d; padding-left: 28px; }
.summary span { color: #918e84; font-size: 13px; }
.summary strong { display: block; margin-top: 8px; font: 500 36px/1 ui-monospace, monospace; }
.list-section h2 { font-size: 18px; }
.contact-list { margin-top: 18px; }
.contact { display: grid; grid-template-columns: 1.2fr 1fr auto; gap: 20px; padding: 15px 2px; border-bottom: 1px solid #2e2d29; }
.contact span { color: #8e8b82; }
.empty { color: #77746c; padding: 32px 0; }
@media (max-width: 620px) { .shell { padding: 24px 18px; } header, .section-heading { align-items: stretch; flex-direction: column; } .summary { grid-template-columns: 1fr; } .summary article + article { border-left: 0; border-top: 1px solid #33322d; padding-left: 0; } .contact { grid-template-columns: 1fr; gap: 4px; } }`,
  'app.js': `const { computed, createApp, ref } = Vue;

const demoContacts = [
  { name: 'Maya Rivera', email: 'maya@northstar.studio', added: 'Today' },
  { name: 'Adrian Okafor', email: 'adrian@westward.co', added: 'Yesterday' },
  { name: 'Linnea Berg', email: 'linnea@fieldwork.design', added: 'Sep 7' },
];

createApp({
  setup() {
    const contacts = ref(demoContacts);
    const appointmentStatus = ref('0');
    const search = ref('');
    const loading = ref(false);
    const error = ref('');
    const filteredContacts = computed(() => {
      const query = search.value.trim().toLowerCase();
      return query ? contacts.value.filter((contact) => JSON.stringify(contact).toLowerCase().includes(query)) : contacts.value;
    });

    async function loadDashboard() {
      loading.value = true;
      error.value = '';
      try {
        if (!window.genesis?.highlevel) {
          contacts.value = demoContacts;
          appointmentStatus.value = 'Demo';
          return;
        }
        const result = await window.genesis.highlevel.contacts.list({ limit: 20 });
        contacts.value = result.contacts || result.items || demoContacts;
        const calendarResult = await window.genesis.highlevel.calendars.list({});
        const calendar = (calendarResult.calendars || [])[0];
        if (!calendar?.id) {
          appointmentStatus.value = '0';
          return;
        }
        const startTime = String(Date.now());
        const endTime = String(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const appointmentResult = await window.genesis.highlevel.appointments.list({ calendarId: calendar.id, startTime, endTime });
        appointmentStatus.value = String((appointmentResult.appointments || appointmentResult.events || []).length);
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : 'Could not load HighLevel data.';
        appointmentStatus.value = 'Unavailable';
      } finally {
        loading.value = false;
      }
    }

    loadDashboard();
    return { appointmentStatus, error, filteredContacts, loadDashboard, loading, search };
  },
}).mount('#app');`,
}

const wait = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('Generation stopped', 'AbortError'))
    }, { once: true })
  })

async function runLocalDemo({ signal, onEvent }: GenerateOptions) {
  const generationId = crypto.randomUUID()
  onEvent({ type: 'generation_started', generationId, provider: 'mock' })
  onEvent({ type: 'token', delta: 'I will build a focused contact dashboard with search and upcoming appointment context.' })

  for (const [path, content] of Object.entries(demoFiles)) {
    const language = path.endsWith('.js') ? 'javascript' : path.endsWith('.css') ? 'css' : 'html'
    onEvent({ type: 'file_start', path, language })
    const chunkSize = 480
    for (let index = 0; index < content.length; index += chunkSize) {
      await wait(8, signal)
      onEvent({ type: 'file_delta', path, delta: content.slice(index, index + chunkSize) })
    }
    onEvent({ type: 'file_complete', path, size: content.length })
  }

  const snapshotId = crypto.randomUUID()
  onEvent({ type: 'snapshot_created', snapshotId })
  onEvent({ type: 'complete', generationId })
}

export function parseSseBlock(block: string): GenerationEvent | undefined {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data) return
  return JSON.parse(data) as GenerationEvent
}

export async function consumeGenerationStream(response: Response, onEvent: (event: GenerationEvent) => void) {
  if (!response.body) throw new Error('Generation response contained no stream.')
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let sawTerminal = false
  while (true) {
    const { done, value = '' } = await reader.read()
    buffer += value.replaceAll('\r\n', '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const event = parseSseBlock(buffer.slice(0, boundary))
      if (event) {
        onEvent(event)
        if (event.type === 'complete' || event.type === 'error') sawTerminal = true
      }
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
    }
    if (done) break
  }
  if (buffer.trim()) {
    const event = parseSseBlock(buffer)
    if (event) {
      onEvent(event)
      if (event.type === 'complete' || event.type === 'error') sawTerminal = true
    }
  }
  if (!sawTerminal) throw new Error('Generation stream ended before completion. Partial output has been preserved.')
}

async function runRemote(options: GenerateOptions, baseUrl: string) {
  if (!options.idToken) throw new Error('Sign in again before generating.')
  const response = await fetch(`${baseUrl}/generateApp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.idToken}` },
    body: JSON.stringify({
      prompt: options.prompt,
      projectId: options.projectId,
    }),
    signal: options.signal,
  })
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Generation request failed (${response.status})`)
  }

  await consumeGenerationStream(response, options.onEvent)
}

export function generateApplication(options: GenerateOptions) {
  const baseUrl = import.meta.env.VITE_FUNCTIONS_BASE_URL?.replace(/\/$/, '')
  return baseUrl ? runRemote(options, baseUrl) : runLocalDemo(options)
}

export type ProjectApplicationState = {
  snapshotId?: string
  files: Record<string, string> | null
  messages: ChatMessage[]
}

const localStateKey = (projectId: string) => `genesis.demo.state.${projectId}`
const localSnapshotsKey = (projectId: string) => `genesis.demo.snapshots.${projectId}`
type LocalSnapshot = ProjectSnapshot & { files: Record<string, string> }

export async function loadApplicationState(projectId: string, idToken?: string): Promise<ProjectApplicationState | null> {
  const baseUrl = import.meta.env.VITE_FUNCTIONS_BASE_URL?.replace(/\/$/, '')
  if (!baseUrl) {
    const saved = localStorage.getItem(localStateKey(projectId))
    return saved ? JSON.parse(saved) as ProjectApplicationState : null
  }
  if (!idToken) throw new Error('Sign in again to load this project.')
  const url = new URL(`${baseUrl}/projectState`)
  url.searchParams.set('projectId', projectId)
  const response = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!response.ok) throw new Error(`Could not load project state (${response.status})`)
  return response.json() as Promise<ProjectApplicationState>
}

export function saveLocalApplicationState(projectId: string, state: ProjectApplicationState) {
  localStorage.setItem(localStateKey(projectId), JSON.stringify(state))
  if (state.snapshotId && state.files) {
    const snapshots = JSON.parse(localStorage.getItem(localSnapshotsKey(projectId)) ?? '[]') as LocalSnapshot[]
    if (!snapshots.some((snapshot) => snapshot.id === state.snapshotId)) {
      const prompt = [...state.messages].reverse().find((message) => message.role === 'user')?.content ?? ''
      const summary = [...state.messages].reverse().find((message) => message.role === 'assistant')?.content ?? ''
      snapshots.unshift({
        id: state.snapshotId,
        prompt,
        summary,
        provider: 'mock',
        fileCount: Object.keys(state.files).length,
        createdAt: new Date().toISOString(),
        files: state.files,
      })
      localStorage.setItem(localSnapshotsKey(projectId), JSON.stringify(snapshots.slice(0, 50)))
    }
  }
}

async function authenticatedRequest<T>(path: string, idToken: string, init?: RequestInit): Promise<T> {
  const baseUrl = import.meta.env.VITE_FUNCTIONS_BASE_URL?.replace(/\/$/, '')
  if (!baseUrl) throw new Error('Firebase Functions are not configured.')
  const response = await fetch(`${baseUrl}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`)
  return body
}

export async function saveApplicationFiles(projectId: string, files: Record<string, GeneratedFile>, idToken?: string) {
  const stateFiles = Object.fromEntries(Object.entries(files).map(([path, file]) => [path, file.content]))
  if (!import.meta.env.VITE_FUNCTIONS_BASE_URL) return stateFiles
  if (!idToken) throw new Error('Sign in again to save files.')
  await authenticatedRequest<{ ok: true }>('saveFiles', idToken, {
    method: 'POST',
    body: JSON.stringify({ projectId, files: stateFiles }),
  })
  return stateFiles
}

export async function listApplicationSnapshots(projectId: string, idToken?: string): Promise<ProjectSnapshot[]> {
  if (!import.meta.env.VITE_FUNCTIONS_BASE_URL) {
    return JSON.parse(localStorage.getItem(localSnapshotsKey(projectId)) ?? '[]') as LocalSnapshot[]
  }
  if (!idToken) throw new Error('Sign in again to load snapshots.')
  const query = new URLSearchParams({ projectId })
  const result = await authenticatedRequest<{ snapshots: ProjectSnapshot[] }>(`projectSnapshots?${query}`, idToken)
  return result.snapshots
}

export async function restoreApplicationSnapshot(projectId: string, snapshotId: string, idToken?: string) {
  if (!import.meta.env.VITE_FUNCTIONS_BASE_URL) {
    const snapshots = JSON.parse(localStorage.getItem(localSnapshotsKey(projectId)) ?? '[]') as LocalSnapshot[]
    const snapshot = snapshots.find((candidate) => candidate.id === snapshotId)
    if (!snapshot) throw new Error('Snapshot was not found.')
    const state = JSON.parse(localStorage.getItem(localStateKey(projectId)) ?? '{"messages":[]}') as ProjectApplicationState
    if (state.files) {
      snapshots.unshift({
        id: crypto.randomUUID(),
        prompt: '',
        summary: 'Backup created automatically before restoring a snapshot.',
        provider: 'manual',
        kind: 'backup',
        fileCount: Object.keys(state.files).length,
        createdAt: new Date().toISOString(),
        files: state.files,
      })
      localStorage.setItem(localSnapshotsKey(projectId), JSON.stringify(snapshots.slice(0, 50)))
    }
    saveLocalApplicationState(projectId, { ...state, snapshotId, files: snapshot.files })
    return { snapshotId, files: snapshot.files }
  }
  if (!idToken) throw new Error('Sign in again to restore a snapshot.')
  return authenticatedRequest<{ snapshotId: string; files: Record<string, string>; backupSnapshotId?: string }>('restoreSnapshot', idToken, {
    method: 'POST',
    body: JSON.stringify({ projectId, snapshotId }),
  })
}

export const initialDemoFiles = Object.fromEntries(
  Object.entries(demoFiles).map(([path, content]) => [path, { path, content, language: path.endsWith('.js') ? 'javascript' : path.endsWith('.css') ? 'css' : 'html' }]),
)
