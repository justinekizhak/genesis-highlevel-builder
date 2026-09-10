import type { GenerationEvent } from '@/types/generation'

type GenerateOptions = {
  prompt: string
  projectId: string
  signal: AbortSignal
  onEvent: (event: GenerationEvent) => void
}

const demoFiles = {
  'index.html': `<main class="shell">
  <header>
    <div>
      <p class="eyebrow">HighLevel workspace</p>
      <h1>Contact pulse</h1>
      <p class="subtitle">Recent relationships and next appointments in one focused view.</p>
    </div>
    <button id="refresh">Refresh</button>
  </header>
  <section class="summary" aria-label="Summary">
    <article><span>Active contacts</span><strong id="contact-count">-</strong></article>
    <article><span>Appointments</span><strong id="appointment-count">-</strong></article>
  </section>
  <section class="list-section">
    <div class="section-heading"><h2>Recent contacts</h2><input id="search" placeholder="Search contacts" /></div>
    <div id="contacts" class="contact-list"><p class="empty">Loading HighLevel data...</p></div>
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
  'app.js': `const demoContacts = [
  { name: 'Maya Rivera', email: 'maya@northstar.studio', added: 'Today' },
  { name: 'Adrian Okafor', email: 'adrian@westward.co', added: 'Yesterday' },
  { name: 'Linnea Berg', email: 'linnea@fieldwork.design', added: 'Sep 7' },
];

async function loadDashboard() {
  let contacts = demoContacts;
  let appointments = [];
  if (window.genesis?.highlevel) {
    const result = await window.genesis.highlevel.contacts.list({ limit: 20 });
    contacts = result.contacts || result.items || contacts;
    const calendarResult = await window.genesis.highlevel.appointments.list({ limit: 20 });
    appointments = calendarResult.appointments || calendarResult.events || [];
  }
  window.dashboardContacts = contacts;
  renderContacts(contacts);
  document.querySelector('#contact-count').textContent = String(contacts.length);
  document.querySelector('#appointment-count').textContent = String(appointments.length);
}

function renderContacts(contacts) {
  document.querySelector('#contacts').innerHTML = contacts.map((contact) => \`<article class="contact"><strong>\${contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' ')}</strong><span>\${contact.email || 'No email'}</span><span>\${contact.added || 'Recent'}</span></article>\`).join('') || '<p class="empty">No contacts found.</p>';
}

document.querySelector('#search').addEventListener('input', (event) => {
  const query = event.target.value.toLowerCase();
  renderContacts((window.dashboardContacts || []).filter((contact) => JSON.stringify(contact).toLowerCase().includes(query)));
});
document.querySelector('#refresh').addEventListener('click', loadDashboard);
loadDashboard().catch((error) => { document.querySelector('#contacts').innerHTML = \`<p class="empty">\${error.message}</p>\`; });`,
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
  onEvent({ type: 'generation_started', generationId })
  onEvent({ type: 'token', delta: 'I will build a focused contact dashboard with search and upcoming appointment context.' })

  for (const [path, content] of Object.entries(demoFiles)) {
    const language = path.endsWith('.js') ? 'javascript' : path.endsWith('.css') ? 'css' : 'html'
    onEvent({ type: 'file_start', path, language })
    const chunkSize = 72
    for (let index = 0; index < content.length; index += chunkSize) {
      await wait(14, signal)
      onEvent({ type: 'file_delta', path, delta: content.slice(index, index + chunkSize) })
    }
    onEvent({ type: 'file_complete', path, size: content.length })
  }

  const snapshotId = crypto.randomUUID()
  onEvent({ type: 'snapshot_created', snapshotId })
  onEvent({ type: 'complete', generationId })
}

function parseSseBlock(block: string): GenerationEvent | undefined {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data) return
  return JSON.parse(data) as GenerationEvent
}

async function runRemote(options: GenerateOptions, baseUrl: string) {
  const response = await fetch(`${baseUrl}/generateMock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: options.prompt, projectId: options.projectId }),
    signal: options.signal,
  })
  if (!response.ok || !response.body) throw new Error(`Generation request failed (${response.status})`)

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  while (true) {
    const { done, value = '' } = await reader.read()
    buffer += value.replaceAll('\r\n', '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const event = parseSseBlock(buffer.slice(0, boundary))
      if (event) options.onEvent(event)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
    }
    if (done) break
  }
  if (buffer.trim()) {
    const event = parseSseBlock(buffer)
    if (event) options.onEvent(event)
  }
}

export function generateApplication(options: GenerateOptions) {
  const baseUrl = import.meta.env.VITE_FUNCTIONS_BASE_URL?.replace(/\/$/, '')
  return baseUrl ? runRemote(options, baseUrl) : runLocalDemo(options)
}

export const initialDemoFiles = Object.fromEntries(
  Object.entries(demoFiles).map(([path, content]) => [path, { path, content, language: path.endsWith('.js') ? 'javascript' : path.endsWith('.css') ? 'css' : 'html' }]),
)
