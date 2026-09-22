import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'docs/diagrams')
mkdirSync(out, { recursive: true })

const colors = {
  canvas: '#ffffff',
  ink: '#1e1e1e',
  muted: '#495057',
  ui: { stroke: '#4263eb', fill: '#dbe4ff' },
  service: { stroke: '#7048e8', fill: '#e5dbff' },
  data: { stroke: '#2b8a3e', fill: '#d3f9d8' },
  external: { stroke: '#0b7285', fill: '#c5f6fa' },
  decision: { stroke: '#e67700', fill: '#fff3bf' },
  danger: { stroke: '#c92a2a', fill: '#ffe3e3' },
  neutral: { stroke: '#495057', fill: '#f1f3f5' },
}

const styleFor = (item) => colors[item.danger ? 'danger' : item.role ?? 'neutral']

let sequence = 2000
const base = (id, type, x, y, width, height, extra = {}) => ({
  id, type, x, y, width, height, angle: 0,
  strokeColor: colors.ink,
  backgroundColor: 'transparent',
  fillStyle: 'solid',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 2,
  opacity: 100,
  groupIds: [],
  frameId: null,
  index: `b${sequence}`,
  roundness: type === 'rectangle' ? { type: 3 } : null,
  seed: sequence++,
  version: 1,
  versionNonce: sequence * 7919,
  isDeleted: false,
  boundElements: [],
  updated: 1,
  link: null,
  locked: false,
  ...extra,
})

const textElement = (id, x, y, width, height, value, fontSize = 18, color = colors.ink) => base(id, 'text', x, y, width, height, {
  strokeColor: color,
  backgroundColor: 'transparent',
  strokeWidth: 1,
  roughness: 0,
  roundness: null,
  fontSize,
  fontFamily: 1,
  text: value,
  textAlign: 'center',
  verticalAlign: 'middle',
  containerId: null,
  originalText: value,
  autoResize: false,
  lineHeight: 1.25,
})

const nodeElements = (node) => {
  const { fill, stroke } = styleFor(node)
  const shape = base(node.id, node.shape ?? 'rectangle', node.x, node.y, node.w, node.h, {
    backgroundColor: fill,
    strokeColor: stroke,
    roundness: node.shape === 'diamond' ? null : { type: 3 },
  })
  const titleY = node.body?.length ? node.y + 14 : node.y + node.h / 2 - 14
  const elements = [shape, textElement(`${node.id}-title`, node.x + 12, titleY, node.w - 24, 28, node.title, node.titleSize ?? 18)]
  if (node.body?.length) {
    const value = node.body.join('\n')
    elements.push(textElement(`${node.id}-body`, node.x + 14, node.y + 46, node.w - 28, node.h - 56, value, 14, colors.muted))
  }
  return elements
}

const arrowElements = (edge) => {
  const [x1, y1] = edge.start
  const [x2, y2] = edge.end
  const color = edge.role || edge.danger ? styleFor(edge).stroke : colors.ink
  const arrow = base(edge.id, 'arrow', x1, y1, x2 - x1, y2 - y1, {
    strokeColor: color,
    backgroundColor: 'transparent',
    roundness: { type: 2 },
    points: [[0, 0], [x2 - x1, y2 - y1]],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: 'arrow',
    elbowed: false,
  })
  if (!edge.label) return [arrow]
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  return [arrow, textElement(`${edge.id}-label`, mx - 70, my - 20, 140, 24, edge.label, 13, edge.role || edge.danger ? color : colors.muted)]
}

const escapeXml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const svgTextLines = (x, y, lines, className, step = 20) => lines.map((line, index) =>
  `<text x="${x}" y="${y + index * step}" text-anchor="middle" class="${className}">${escapeXml(line)}</text>`,
).join('\n')

function svgNode(node) {
  const { fill, stroke } = styleFor(node)
  const shape = node.shape === 'diamond'
    ? `<polygon points="${node.x + node.w / 2},${node.y} ${node.x + node.w},${node.y + node.h / 2} ${node.x + node.w / 2},${node.y + node.h} ${node.x},${node.y + node.h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="2.2" filter="url(#rough)"/>`
    : `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="2.2" filter="url(#rough)"/>`
  const titleY = node.body?.length ? node.y + 32 : node.y + node.h / 2 + 6
  const bodyStart = node.y + 61
  return `<g>${shape}${svgTextLines(node.x + node.w / 2, titleY, [node.title], 'node-title')}${node.body?.length ? svgTextLines(node.x + node.w / 2, bodyStart, node.body, 'node-body', 19) : ''}</g>`
}

function svgEdge(edge) {
  const [x1, y1] = edge.start
  const [x2, y2] = edge.end
  const color = edge.role || edge.danger ? styleFor(edge).stroke : colors.ink
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  return `<g><path d="M ${x1} ${y1} Q ${mx + 3} ${my - 4} ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="2.2" marker-end="url(#arrow)" filter="url(#rough-line)"/>${edge.label ? `<rect x="${mx - 58}" y="${my - 16}" width="116" height="23" rx="3" fill="${colors.canvas}"/><text x="${mx}" y="${my + 1}" text-anchor="middle" class="edge-label" fill="${edge.role || edge.danger ? color : colors.muted}">${escapeXml(edge.label)}</text>` : ''}</g>`
}

function writeDiagram(diagram) {
  const elements = [
    textElement(`${diagram.name}-title`, 40, 20, diagram.width - 80, 40, diagram.title, 28),
    ...diagram.nodes.flatMap(nodeElements),
    ...diagram.edges.flatMap(arrowElements),
  ]
  writeFileSync(resolve(out, `${diagram.name}.excalidraw`), `${JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements,
    appState: { gridSize: null, viewBackgroundColor: colors.canvas },
    files: {},
  }, null, 2)}\n`)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${diagram.width}" height="${diagram.height}" viewBox="0 0 ${diagram.width} ${diagram.height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(diagram.title)}</title>
  <desc id="desc">High-level Genesis diagram. Editable Excalidraw source is stored beside this SVG.</desc>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="context-stroke"/></marker>
    <filter id="rough" x="-5%" y="-7%" width="110%" height="114%"><feTurbulence type="fractalNoise" baseFrequency="0.025 0.12" numOctaves="2" seed="41" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="1.7"/></filter>
    <filter id="rough-line" x="-8%" y="-12%" width="116%" height="124%"><feTurbulence type="fractalNoise" baseFrequency="0.04 0.18" numOctaves="2" seed="17" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="2"/></filter>
    <style>.heading{font:700 30px "Marker Felt","Comic Sans MS",cursive;fill:${colors.ink}}.node-title{font:700 17px "Marker Felt","Comic Sans MS",cursive;fill:${colors.ink}}.node-body{font:14px "Marker Felt","Comic Sans MS",cursive;fill:${colors.muted}}.edge-label{font:700 13px "Marker Felt","Comic Sans MS",cursive}</style>
  </defs>
  <rect width="100%" height="100%" fill="${colors.canvas}"/>
  <text x="40" y="51" class="heading">${escapeXml(diagram.title)}</text>
  <path d="M35 70 Q ${diagram.width / 2} 66 ${diagram.width - 35} 70" stroke="${colors.ink}" stroke-width="1" opacity=".22" fill="none" filter="url(#rough-line)"/>
  ${diagram.edges.map(svgEdge).join('\n')}
  ${diagram.nodes.map(svgNode).join('\n')}
</svg>\n`
  writeFileSync(resolve(out, `${diagram.name}.svg`), svg)
}

// Consolidated to exactly 3 diagrams (previously 12, overlapping and partly stale).
// Each one reflects the current implementation in functions/src and frontend/src as of the
// "multi-response app feature" + "make the multi-generation faster" changes.
const diagrams = [
  {
    name: 'system-architecture', title: 'Genesis System Architecture', width: 1500, height: 760,
    nodes: [
      { id: 'browser', role: 'ui', x: 40, y: 100, w: 220, h: 150, title: 'Vue SPA (browser)', body: ['WorkspaceShell.vue', 'Firebase Auth SDK'] },
      { id: 'hosting', role: 'service', x: 300, y: 100, w: 220, h: 150, title: 'Firebase Hosting', body: ['Serves frontend/dist', 'Rewrites /api/v1/** and', 'named-function aliases'] },
      { id: 'apiv1', role: 'service', x: 560, y: 90, w: 230, h: 160, title: 'apiV1 façade', body: ['Cloud Functions v2', 'onRequest handlers', 'region: us-central1'] },
      { id: 'guards', role: 'decision', x: 830, y: 90, w: 240, h: 160, title: 'Shared guardrails', body: ['Firebase ID token', 'CORS allowlist (APP_ORIGINS)', 'owner + schema checks', 'rate limits'] },
      { id: 'cicd', role: 'neutral', x: 1110, y: 90, w: 350, h: 160, title: 'GitHub Actions CI/CD', body: ['Build + test on every PR', 'Workload Identity Fed deploy', 'on push to main', 'post-deploy /api/healthz check'] },
      { id: 'generation', role: 'service', x: 40, y: 320, w: 230, h: 160, title: 'Generation functions', body: ['generateApp (SSE)', 'cancelGeneration', 'projectVariationSet · selectVariation'] },
      { id: 'projects', role: 'service', x: 310, y: 320, w: 230, h: 160, title: 'Project state functions', body: ['saveFiles', 'projectSnapshots · restoreSnapshot', 'projectState'] },
      { id: 'integrations', role: 'service', x: 580, y: 320, w: 260, h: 160, title: 'Integration functions', body: ['hlOAuthStart · hlAuthCallback', 'hlConnectionStatus', 'hlProxy · hlWebhook'] },
      { id: 'firestore', role: 'data', x: 880, y: 320, w: 260, h: 160, title: 'Firestore', body: ['projects · files · messages', 'snapshots · variationSets', 'connections · rate limits'] },
      { id: 'config', role: 'data', x: 1180, y: 320, w: 280, h: 160, title: 'Runtime configuration', body: ['defineString params (models,', 'HL client), Secret Manager:', 'OPENAI_API_KEY, HL_CLIENT_SECRET'] },
      { id: 'openai', role: 'external', x: 300, y: 570, w: 260, h: 130, title: 'OpenAI', body: ['gpt-5.4 generation model', 'variation planner + grader models'] },
      { id: 'highlevel', role: 'external', x: 880, y: 570, w: 260, h: 130, title: 'HighLevel CRM', body: ['OAuth 2.0 · REST API', 'Ed25519-signed webhooks'] },
    ],
    edges: [
      { id: 'sa-e1', start: [260, 175], end: [300, 175], label: 'HTTPS' },
      { id: 'sa-e2', start: [520, 175], end: [560, 170], label: 'rewrite' },
      { id: 'sa-e3', start: [790, 170], end: [830, 170], label: 'every request' },
      { id: 'sa-e4', start: [1075, 170], end: [1110, 170] },
      { id: 'sa-e5', start: [1285, 250], end: [1285, 320], label: 'firebase deploy' },
      { id: 'sa-e6', start: [675, 250], end: [200, 320], label: 'generate' },
      { id: 'sa-e7', start: [710, 250], end: [400, 320], label: 'save/restore' },
      { id: 'sa-e8', start: [900, 250], end: [700, 320], label: 'oauth/proxy' },
      { id: 'sa-e10', role: 'external', start: [155, 480], end: [430, 570], label: 'generate/grade' },
      { id: 'sa-e11', role: 'external', start: [900, 480], end: [980, 570], label: 'OAuth/API/webhooks' },
      { id: 'sa-e12', start: [425, 400], end: [980, 400], label: 'read/write' },
      { id: 'sa-e13', start: [810, 480], end: [1010, 400], label: 'connections' },
    ],
  },
  {
    name: 'generation-and-grading-pipeline', title: 'Generation & Multi-Variation Grading Pipeline', width: 1650, height: 1020,
    nodes: [
      { id: 'gp-prompt', role: 'ui', x: 40, y: 100, w: 220, h: 150, title: 'User prompt', body: ['Raw request + chat history', 'generateApp (SSE)'] },
      { id: 'gp-planner', role: 'external', x: 300, y: 90, w: 260, h: 170, title: 'Structured planner', body: ['Classify single vs variations', 'Derive shared feature contract', 'Confidence floor 0.8'] },
      { id: 'gp-mode', role: 'decision', x: 600, y: 85, w: 180, h: 180, title: 'Mode?', body: ['single / variations'], shape: 'diamond' },
      { id: 'gp-single', role: 'service', x: 830, y: 100, w: 260, h: 150, title: 'Single-generation path', body: ['Stream one app directly', 'Persist a normal snapshot'] },
      { id: 'gp-briefs', role: 'data', x: 300, y: 340, w: 260, h: 160, title: '4 variation briefs', body: ['One shared feature contract', '≥3 differentiators each', 'No brief is called "best"'] },
      { id: 'gp-pool', role: 'service', x: 600, y: 340, w: 280, h: 160, title: 'Candidate worker pool', body: ['4 parallel model calls', 'concurrency = 4 (fully parallel)', 'independent, isolated calls'] },
      { id: 'gp-memory', role: 'data', x: 940, y: 340, w: 260, h: 160, title: 'In-memory candidates', body: ['3 files + usage each', 'Nothing streamed before ranking'] },
      { id: 'gp-qualify', role: 'decision', x: 300, y: 580, w: 260, h: 190, title: 'Deterministic qualify', body: ['Hard: schema, forbidden APIs,', 'Vue runtime, app.js parses', 'Soft: HL contracts, states,', 'a11y, responsive scoring'] },
      { id: 'gp-grade', role: 'external', x: 600, y: 580, w: 300, h: 190, title: 'Blinded rubric grading', body: ['Shuffle + alias candidates', 'Fidelity 30 · correctness 25', 'robustness 15 · usability 10', 'a11y 10 · responsive 5 · maint. 5'] },
      { id: 'gp-rank', role: 'service', x: 940, y: 580, w: 260, h: 190, title: 'Deterministic ranking', body: ['Total score → fidelity →', 'correctness → alias tiebreak', 'No pairwise comparison pass'] },
      { id: 'gp-abort', danger: true, x: 1240, y: 580, w: 230, h: 190, title: '< 2 eligible: stop safely', body: ['Persist nothing', 'Project stays unchanged'] },
      { id: 'gp-persist', role: 'data', x: 300, y: 820, w: 280, h: 160, title: 'Persist top 2 finalists', body: ['variationSets/{id} + 2', 'candidate docs; other 2', 'candidates are discarded'] },
      { id: 'gp-compare', role: 'ui', x: 630, y: 820, w: 260, h: 160, title: 'Comparison UI', body: ['VariationComparison.vue', 'Direction A / B sandboxed iframes'] },
      { id: 'gp-select', role: 'service', x: 940, y: 820, w: 260, h: 160, title: 'User selects a finalist', body: ['selectVariationFinalist', 'checks base snapshot still current'] },
      { id: 'gp-promote', role: 'data', x: 1240, y: 820, w: 230, h: 160, title: 'Promote to active', body: ['New snapshot · replace files/', 'clear pendingVariationSetId'] },
    ],
    edges: [
      { id: 'gp-e1', start: [260, 175], end: [300, 175] },
      { id: 'gp-e2', start: [560, 175], end: [600, 175] },
      { id: 'gp-e3', start: [780, 175], end: [830, 175], label: 'single' },
      { id: 'gp-e4', role: 'service', start: [690, 265], end: [430, 340], label: 'variations' },
      { id: 'gp-e5', start: [560, 420], end: [600, 420], label: '4 briefs' },
      { id: 'gp-e6', start: [880, 420], end: [940, 420], label: '4 results' },
      { id: 'gp-e7', start: [1070, 500], end: [430, 580], label: 'validate' },
      { id: 'gp-e8', start: [560, 675], end: [600, 675], label: '≥2 eligible' },
      { id: 'gp-e9', danger: true, start: [560, 720], end: [1240, 675], label: '< 2 eligible' },
      { id: 'gp-e10', start: [900, 675], end: [940, 675], label: 'scores' },
      { id: 'gp-e11', role: 'data', start: [1070, 770], end: [430, 820], label: 'top 2' },
      { id: 'gp-e12', start: [580, 900], end: [630, 900] },
      { id: 'gp-e13', start: [890, 900], end: [940, 900] },
      { id: 'gp-e14', start: [1200, 900], end: [1240, 900] },
    ],
  },
  {
    name: 'data-lifecycle-and-highlevel-integration', title: 'Data Model, Lifecycle & HighLevel Integration', width: 1650, height: 940,
    nodes: [
      { id: 'dl-collections', role: 'data', x: 40, y: 100, w: 300, h: 190, title: 'Firestore collections', body: ['projects · files · messages', 'snapshots · variationSets/candidates', 'highlevelConnections · oauthStates', 'rateLimits · webhookDedupe · hlEvents'] },
      { id: 'dl-isolation', role: 'decision', x: 380, y: 100, w: 220, h: 190, title: 'Ownership isolation', body: ['requireOwnedProject(uid, id)', 'enforced in Functions', 'and mirrored in Firestore rules'] },
      { id: 'dl-live', role: 'data', x: 640, y: 100, w: 210, h: 190, title: 'Live files', body: ['files/ subcollection', 'used by editor + preview'] },
      { id: 'dl-snapshots', role: 'data', x: 890, y: 100, w: 250, h: 190, title: 'Append-only snapshots', body: ['kind: generation · manual', 'partial · backup'] },
      { id: 'dl-restore', role: 'service', x: 1180, y: 100, w: 260, h: 190, title: 'Restore', body: ['Back up current files first,', 'then overwrite live files,', 'update latestSnapshotId'] },
      { id: 'dl-connect', role: 'ui', x: 40, y: 350, w: 220, h: 170, title: 'Connect HighLevel', body: ['hlOAuthStart', 'oauthStates doc, 10 min TTL'] },
      { id: 'dl-callback', role: 'service', x: 300, y: 350, w: 250, h: 170, title: 'hlAuthCallback', body: ['exchange code for tokens', 'backfill locationId on projects'] },
      { id: 'dl-connections', role: 'data', x: 590, y: 350, w: 260, h: 170, title: 'highlevelConnections/{uid}', body: ['access/refresh tokens', 'expiresAt · locationId'] },
      { id: 'dl-refresh', role: 'service', x: 890, y: 350, w: 280, h: 170, title: 'Lazy refresh + lease', body: ['refreshes when <60s to expiry', '30s Firestore lease', 'rotates both tokens'] },
      { id: 'dl-iframe', role: 'ui', x: 40, y: 590, w: 220, h: 190, title: 'Generated app iframe', body: ['window.genesis.highlevel', 'bridge, no direct network'] },
      { id: 'dl-proxy', role: 'service', x: 300, y: 590, w: 280, h: 190, title: 'hlProxy', body: ['auth · 60/min rate limit', '8-operation allowlist', 'injects locationId server-side'] },
      { id: 'dl-hlapi', role: 'external', x: 620, y: 590, w: 220, h: 190, title: 'HighLevel API', body: ['contacts · conversations', 'calendars · appointments'] },
      { id: 'dl-webhook', role: 'service', x: 880, y: 590, w: 280, h: 190, title: 'hlWebhook', body: ['Ed25519 signature verify', 'webhookDedupe atomic claim', 'maps locationId → uid'] },
      { id: 'dl-events', role: 'data', x: 1200, y: 590, w: 260, h: 190, title: 'users/{uid}/hlEvents', body: ['Contact/Message/Appointment', 'events relayed live to the iframe', 'UNINSTALL deletes the connection'] },
    ],
    edges: [
      { id: 'dl-e1', start: [340, 195], end: [380, 195], label: 'every read/write' },
      { id: 'dl-e2', start: [600, 195], end: [640, 195] },
      { id: 'dl-e3', start: [850, 195], end: [890, 195], label: 'commit' },
      { id: 'dl-e4', start: [1140, 195], end: [1180, 195], label: 'history UI' },
      { id: 'dl-e5', start: [1310, 290], end: [745, 290], label: 'overwrite' },
      { id: 'dl-e6', start: [260, 435], end: [300, 435], label: 'consent' },
      { id: 'dl-e7', start: [550, 435], end: [590, 435] },
      { id: 'dl-e8', start: [850, 435], end: [890, 435], label: 'resolve/rotate' },
      { id: 'dl-e9', start: [260, 685], end: [300, 685], label: 'bridge call' },
      { id: 'dl-e10', start: [580, 685], end: [620, 685], label: 'resolve token' },
      { id: 'dl-e11', role: 'external', start: [500, 590], end: [720, 435], label: 'token' },
      { id: 'dl-e12', start: [840, 685], end: [880, 685], label: '1 allowlisted call' },
      { id: 'dl-e13', role: 'external', start: [730, 590], end: [1010, 685], label: 'async events' },
      { id: 'dl-e14', start: [1160, 685], end: [1200, 685], label: 'relevant types' },
      { id: 'dl-e15', role: 'data', start: [1250, 590], end: [260, 590], label: 'live relay' },
    ],
  },
]

for (const diagram of diagrams) writeDiagram(diagram)

console.log(`Generated ${diagrams.length} Excalidraw diagrams in ${out}`)
