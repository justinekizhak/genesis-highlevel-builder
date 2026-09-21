import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

const diagrams = [
  {
    name: 'multi-app-backend-architecture', title: 'Multi-App Preview — Backend Architecture', width: 1400, height: 880,
    nodes: [
      { id: 'ma-request', role: 'ui', x: 35, y: 110, w: 205, h: 105, title: 'Generation request', body: ['Raw prompt + project ID', 'Authenticated owner'] },
      { id: 'ma-guard', role: 'decision', x: 285, y: 100, w: 235, h: 125, title: 'Request guardrails', body: ['Generation lock', 'HighLevel connected', 'Persist user message'] },
      { id: 'ma-planner', role: 'external', x: 570, y: 100, w: 240, h: 125, title: 'Structured planner', body: ['Classify intent', 'Feature contract', '0 or 4 briefs'] },
      { id: 'ma-mode', role: 'decision', x: 865, y: 95, w: 185, h: 135, title: 'Mode?', body: ['single / variations'], shape: 'diamond' },
      { id: 'ma-single', role: 'service', x: 1110, y: 105, w: 250, h: 115, title: 'Existing single path', body: ['1 generation unit', 'Stream code directly', 'Persist normal snapshot'] },
      { id: 'ma-pool', role: 'service', x: 750, y: 330, w: 255, h: 125, title: 'Candidate worker pool', body: ['4 isolated requests', 'Concurrency = 2', 'All-settled failures'] },
      { id: 'ma-memory', role: 'data', x: 1085, y: 330, w: 275, h: 125, title: 'Function memory', body: ['3 files + usage per app', 'No candidate code streamed', 'before ranking'] },
      { id: 'ma-qualify', role: 'decision', x: 750, y: 545, w: 255, h: 130, title: 'Deterministic qualify', body: ['Hard safety/runtime gates', 'Soft evidence + score', 'Need at least 2 eligible'] },
      { id: 'ma-grade', role: 'external', x: 1085, y: 545, w: 275, h: 130, title: 'Blinded AI grader', body: ['Independent 100-point rubric', 'Retry once', 'Deterministic fallback'] },
      { id: 'ma-persist', role: 'data', x: 750, y: 755, w: 255, h: 95, title: 'Persist top two', body: ['Variation set + finalists', 'Discard other code'] },
      { id: 'ma-stream', role: 'ui', x: 1085, y: 755, w: 275, h: 95, title: 'Comparison client', body: ['SSE metadata + 2 file sets', 'Direction A / Direction B'] },
      { id: 'ma-control', role: 'decision', x: 35, y: 355, w: 595, h: 165, title: 'Cross-cutting controls', body: ['One abort signal: planner → workers → grader', '15s SSE heartbeat · truthful milestone events', 'Variation quota weight = 4 · function timeout = 540s', 'Project lock held for the entire batch'] },
      { id: 'ma-unchanged', role: 'neutral', x: 35, y: 610, w: 595, h: 150, title: 'Key compatibility decision', body: ['Normal prompts still use the original streaming workflow', 'Active project files stay unchanged until the user selects', 'Fewer than 2 eligible candidates persists no variation', 'Selection later creates a normal project snapshot'] },
    ],
    edges: [
      { id: 'ma-e1', start: [240, 162], end: [285, 162] }, { id: 'ma-e2', start: [520, 162], end: [570, 162] },
      { id: 'ma-e3', start: [810, 162], end: [865, 162] }, { id: 'ma-e4', start: [1050, 155], end: [1110, 155], label: 'single' },
      { id: 'ma-e5', role: 'service', start: [955, 230], end: [880, 330], label: 'variations' },
      { id: 'ma-e6', start: [1005, 392], end: [1085, 392], label: '4 results' },
      { id: 'ma-e7', start: [1190, 455], end: [1005, 610], label: 'validate' },
      { id: 'ma-e8', start: [1005, 610], end: [1085, 610], label: 'eligible' },
      { id: 'ma-e9', start: [1195, 675], end: [1005, 800], label: 'rank top 2' },
      { id: 'ma-e10', start: [1005, 802], end: [1085, 802], label: 'after commit' },
    ],
  },
  {
    name: 'multi-prompt-generation-briefs', title: 'Multi-Prompt System — From One Request to Four Briefs', width: 1400, height: 900,
    nodes: [
      { id: 'mp-user', role: 'ui', x: 35, y: 115, w: 225, h: 115, title: 'Raw user prompt', body: ['The product to build', 'May ask for alternatives', 'Treated as untrusted data'] },
      { id: 'mp-context', role: 'data', x: 35, y: 300, w: 225, h: 120, title: 'Bounded context', body: ['Project metadata', 'Last 12 messages', 'Current file names only'] },
      { id: 'mp-planner-prompt', role: 'external', x: 330, y: 150, w: 285, h: 165, title: 'Planner prompt (new)', body: ['Detect whole-app variation intent', 'Extract one shared contract', 'Require exactly 4 briefs', 'Confidence threshold = 0.8'] },
      { id: 'mp-plan', role: 'data', x: 685, y: 105, w: 285, h: 205, title: 'Structured GenerationPlan', body: ['mode + confidence', 'required / optional / invariants', '4 briefs for variation mode', 'Schema-bounded output'] },
      { id: 'mp-fallback', role: 'decision', x: 1035, y: 120, w: 300, h: 175, title: 'Safe planner fallback', body: ['Failure or invalid JSON → single', 'Low variation confidence → single', 'Cancellation still stops everything', 'Ordinary generation is never blocked'] },
      { id: 'mp-contract', role: 'data', x: 35, y: 550, w: 245, h: 150, title: 'Shared feature contract', body: ['Same capabilities in all 4', 'HighLevel + safety invariants', 'Prevents feature drift'] },
      { id: 'mp-briefs', role: 'service', x: 340, y: 505, w: 310, h: 235, title: 'Four generation briefs', body: ['Design intent', 'Information architecture', 'Interaction model', 'Visual direction + density', '≥3 pairwise differences', 'No candidate is described as “best”'] },
      { id: 'mp-system', role: 'decision', x: 720, y: 465, w: 285, h: 180, title: 'Base systemPrompt', body: ['Existing shared generator policy', 'Vue 3-file runtime', 'HighLevel data contracts', 'Security + accessible dark UI', 'Same for every candidate'] },
      { id: 'mp-directive', role: 'service', x: 720, y: 690, w: 285, h: 165, title: 'Candidate directive (new)', body: ['Contract + exactly 1 brief', 'Appended after raw request', 'May shape presentation only', 'Cannot remove required features'] },
      { id: 'mp-candidates', role: 'external', x: 1080, y: 500, w: 280, h: 220, title: '4 isolated model calls', body: ['Same model + reasoning effort', 'Same current files + context', 'Candidates never see each other', 'Independent sampling', 'Strict 3-file JSON schema'] },
      { id: 'mp-boundary', role: 'neutral', x: 1035, y: 780, w: 325, h: 85, title: 'Separation of concerns', body: ['Policy stays global; briefs create diversity', 'The grader never receives the briefs'] },
    ],
    edges: [
      { id: 'mp-e1', start: [260, 170], end: [330, 205] }, { id: 'mp-e2', start: [260, 355], end: [330, 260] },
      { id: 'mp-e3', start: [615, 220], end: [685, 205] }, { id: 'mp-e4', start: [970, 205], end: [1035, 205], label: 'guard' },
      { id: 'mp-e5', role: 'data', start: [785, 310], end: [180, 550], label: 'contract' },
      { id: 'mp-e6', role: 'service', start: [850, 310], end: [500, 505], label: '4 briefs' },
      { id: 'mp-e7', start: [280, 625], end: [720, 750], label: 'shared' },
      { id: 'mp-e8', start: [650, 620], end: [720, 770], label: 'one each' },
      { id: 'mp-e9', start: [1005, 555], end: [1080, 580], label: 'instructions' },
      { id: 'mp-e10', start: [1005, 770], end: [1080, 655], label: 'input suffix' },
    ],
  },
  {
    name: 'variation-grading-algorithm', title: 'Variation Qualification and Grading — Implemented Algorithm', width: 1400, height: 920,
    nodes: [
      { id: 'vg-four', role: 'service', x: 35, y: 110, w: 220, h: 115, title: 'Completed candidates', body: ['Up to 4 applications', 'Each has exactly 3 files'] },
      { id: 'vg-hard', role: 'decision', x: 315, y: 90, w: 280, h: 155, title: 'Hard qualification gates', body: ['Schema + file limits', 'Forbidden APIs / secrets', 'Mandatory Vue runtime', 'app.js parses'] },
      { id: 'vg-soft', role: 'decision', x: 655, y: 90, w: 295, h: 155, title: 'Soft deterministic checks', body: ['HighLevel contracts 25', 'States 20 · features 30', 'Accessibility 15', 'Responsive CSS 10'] },
      { id: 'vg-count', role: 'decision', x: 1015, y: 95, w: 180, h: 145, title: '≥2 eligible?', shape: 'diamond' },
      { id: 'vg-fail', danger: true, x: 1225, y: 110, w: 150, h: 115, title: 'Stop safely', body: ['Persist nothing', 'Project unchanged'] },
      { id: 'vg-blind', role: 'decision', x: 315, y: 355, w: 280, h: 180, title: 'Blind the candidates', body: ['Shuffle candidate order', 'Assign random UUID aliases', 'Remove brief + original index', 'Remove model + display position'] },
      { id: 'vg-input', role: 'data', x: 35, y: 370, w: 220, h: 155, title: 'Grader input', body: ['Raw user request', 'Shared feature contract', 'Deterministic evidence', 'Alias + source files'] },
      { id: 'vg-rubric', role: 'external', x: 655, y: 335, w: 310, h: 220, title: 'Independent rubric call', body: ['Feature fidelity 30', 'Functional correctness 25', 'Robustness 15', 'Usability 10 · accessibility 10', 'Responsive 5 · maintainable 5'] },
      { id: 'vg-rank', role: 'service', x: 1025, y: 350, w: 300, h: 190, title: 'Deterministic rank logic', body: ['1. Total rubric score', '2. Feature fidelity', '3. Functional correctness', '4. Opaque alias', 'No second model or pairwise pass'] },
      { id: 'vg-retry', role: 'decision', x: 655, y: 690, w: 260, h: 145, title: 'Grader succeeds?', body: ['Maximum 2 attempts'], shape: 'diamond' },
      { id: 'vg-fallback', role: 'service', x: 315, y: 700, w: 270, h: 130, title: 'Deterministic fallback', body: ['Rank by soft score', 'Tie: candidate ID', 'gradingMode = fallback'] },
      { id: 'vg-top', role: 'data', x: 1025, y: 690, w: 300, h: 150, title: 'Top two finalists', body: ['Persist files + score breakdown', 'Expose “standout” summary', 'Hide numeric scores in UI', 'Stable A/B display ≠ rank'] },
      { id: 'vg-note', role: 'neutral', x: 35, y: 610, w: 220, h: 175, title: 'Design vs implementation', body: ['Earlier spec proposed a', '70/30 rubric + pairwise blend.', 'Current code intentionally uses', 'rubric-only ranking.'] },
    ],
    edges: [
      { id: 'vg-e1', start: [255, 165], end: [315, 165] }, { id: 'vg-e2', start: [595, 165], end: [655, 165] },
      { id: 'vg-e3', start: [950, 165], end: [1015, 165] }, { id: 'vg-e4', start: [1195, 165], end: [1225, 165], label: 'no', danger: true },
      { id: 'vg-e5', role: 'data', start: [1105, 240], end: [520, 355], label: 'yes' },
      { id: 'vg-e6', start: [255, 445], end: [315, 445] }, { id: 'vg-e7', start: [595, 445], end: [655, 445] },
      { id: 'vg-e8', start: [805, 555], end: [785, 690], label: 'result' },
      { id: 'vg-e10', start: [655, 762], end: [585, 762], label: 'no after retry' },
      { id: 'vg-e11', role: 'data', start: [915, 735], end: [1025, 470], label: 'yes · rank' },
      { id: 'vg-e12', start: [585, 800], end: [1025, 805], label: 'top 2' },
      { id: 'vg-e13', role: 'data', start: [1175, 540], end: [1175, 690], label: 'top 2' },
    ],
  },
  {
    name: 'multi-app-lifecycle-data-boundaries', title: 'Multi-App Preview — Lifecycle and Data Boundaries', width: 1400, height: 900,
    nodes: [
      { id: 'ml-active', role: 'data', x: 35, y: 110, w: 240, h: 130, title: 'Active project state', body: ['Current files + latestSnapshotId', 'Never mutated during generation'] },
      { id: 'ml-lock', role: 'decision', x: 330, y: 105, w: 245, h: 140, title: 'Batch ownership', body: ['One project lock', 'One generationId', 'One abort-controller tree'] },
      { id: 'ml-run', role: 'service', x: 640, y: 95, w: 280, h: 160, title: 'In-memory batch', body: ['4 candidates · concurrency 2', 'Progress milestones only', 'Failures do not cancel siblings', 'Cancellation stops all stages'] },
      { id: 'ml-rank', role: 'service', x: 985, y: 105, w: 260, h: 140, title: 'Validate + rank', body: ['All viable code remains server-side', 'Select internal ranks 1 and 2'] },
      { id: 'ml-discard', danger: true, x: 1100, y: 355, w: 255, h: 120, title: 'Discarded candidates', body: ['Code never persisted', 'Code never sent to browser'] },
      { id: 'ml-store', role: 'data', x: 700, y: 345, w: 325, h: 155, title: 'Atomic finalist persistence', body: ['variationSets/{setId}', 'Exactly 2 candidate documents', 'pendingVariationSetId pointer', 'Aggregate usage + grading mode'] },
      { id: 'ml-sse', role: 'ui', x: 330, y: 350, w: 300, h: 145, title: 'SSE finalist transfer', body: ['Metadata only after persistence', 'Chunked files + SHA-256', '2 isolated buffers', 'Reload can fetch persisted set'] },
      { id: 'ml-preview', role: 'ui', x: 35, y: 350, w: 235, h: 145, title: 'Comparison workspace', body: ['Two sandboxed previews', 'Direction A / Direction B', 'No active editor mutation'] },
      { id: 'ml-choice', role: 'ui', x: 35, y: 660, w: 235, h: 125, title: 'User chooses', body: ['POST selection', 'Candidate ID only'] },
      { id: 'ml-conflict', role: 'decision', x: 330, y: 640, w: 280, h: 165, title: 'Selection checks', body: ['Owner + finalist membership', 'Set is ready', 'Base snapshot still current', 'Idempotent if already active'] },
      { id: 'ml-promote', role: 'service', x: 685, y: 635, w: 300, h: 175, title: 'Atomic promotion', body: ['Create standard snapshot', 'Replace active file documents', 'Update latestSnapshotId', 'Clear pending pointer', 'Persist assistant summary'] },
      { id: 'ml-history', role: 'data', x: 1060, y: 650, w: 295, h: 145, title: 'Recoverable history', body: ['Chosen finalist becomes active', 'Other finalist remains available', 'Later switch creates another snapshot'] },
      { id: 'ml-events', role: 'neutral', x: 1010, y: 520, w: 345, h: 85, title: 'Operational visibility', body: ['SSE events are factual, not estimated percentages', '15-second heartbeat keeps long requests observable'] },
    ],
    edges: [
      { id: 'ml-e1', start: [275, 175], end: [330, 175] }, { id: 'ml-e2', start: [575, 175], end: [640, 175] },
      { id: 'ml-e3', start: [920, 175], end: [985, 175] }, { id: 'ml-e4', danger: true, start: [1150, 245], end: [1225, 355], label: 'bottom 2' },
      { id: 'ml-e5', role: 'data', start: [1050, 245], end: [900, 345], label: 'top 2' },
      { id: 'ml-e6', start: [700, 420], end: [630, 420], label: 'after commit' },
      { id: 'ml-e7', start: [330, 420], end: [270, 420] }, { id: 'ml-e8', start: [152, 495], end: [152, 660] },
      { id: 'ml-e9', start: [270, 722], end: [330, 722] }, { id: 'ml-e10', start: [610, 722], end: [685, 722] },
      { id: 'ml-e11', start: [985, 722], end: [1060, 722] },
      { id: 'ml-e12', role: 'data', start: [835, 635], end: [200, 240], label: 'commit active files' },
    ],
  },
  {
    name: 'backend-capability-map', title: 'Backend Capability Map', width: 1200, height: 690,
    nodes: [
      { id: 'entry', role: 'ui', x: 40, y: 115, w: 220, h: 105, title: 'HTTPS entry', body: ['Hosting /api/v1 routes', 'Cloud Functions'] },
      { id: 'generation', role: 'service', x: 330, y: 95, w: 230, h: 105, title: 'Generation', body: ['generate · cancel', 'stream SSE'] },
      { id: 'projects', role: 'data', x: 625, y: 95, w: 230, h: 105, title: 'Project state', body: ['load · save · history', 'restore snapshots'] },
      { id: 'integration', role: 'service', x: 920, y: 95, w: 230, h: 105, title: 'Integrations', body: ['OAuth start/callback', 'connection status'] },
      { id: 'guards', role: 'decision', x: 40, y: 300, w: 285, h: 135, title: 'Shared guardrails', body: ['Firebase identity · CORS', 'owner checks · schemas', 'rate limits · generation lock'] },
      { id: 'proxy', role: 'service', x: 405, y: 300, w: 245, h: 115, title: 'HighLevel proxy', body: ['allowlisted CRM calls', 'validated parameters'] },
      { id: 'webhooks', role: 'service', x: 735, y: 300, w: 245, h: 115, title: 'Webhook intake', body: ['signature · dedupe', 'event fanout'] },
      { id: 'firestore', role: 'data', x: 190, y: 535, w: 255, h: 110, title: 'Firestore', body: ['projects · files · messages', 'snapshots · connections · events'] },
      { id: 'openai', role: 'external', x: 500, y: 535, w: 220, h: 110, title: 'OpenAI', body: ['structured generation stream'] },
      { id: 'highlevel', role: 'external', x: 790, y: 535, w: 255, h: 110, title: 'HighLevel', body: ['OAuth · CRM APIs · webhooks'] },
    ],
    edges: [
      { id: 'e1', start: [260, 155], end: [330, 145] }, { id: 'e2', start: [260, 165], end: [625, 145] },
      { id: 'e3', start: [260, 175], end: [920, 145] }, { id: 'e4', start: [200, 220], end: [180, 300], label: 'every request' },
      { id: 'e5', start: [260, 195], end: [405, 350] }, { id: 'e6', start: [260, 205], end: [735, 350] },
      { id: 'e7', start: [610, 415], end: [350, 535], label: 'state' }, { id: 'e8', start: [445, 200], end: [610, 535], label: 'model' },
      { id: 'e9', start: [1010, 200], end: [925, 535], label: 'OAuth' }, { id: 'e10', start: [650, 355], end: [850, 535], label: 'API' },
      { id: 'e11', start: [930, 535], end: [855, 415], label: 'events' },
    ],
  },
  {
    name: 'oauth-token-lifecycle', title: 'HighLevel Connection and Token Lifecycle', width: 1200, height: 735,
    nodes: [
      { id: 'connect', role: 'ui', x: 40, y: 110, w: 200, h: 90, title: 'Connect HighLevel', body: ['Signed-in user clicks'] },
      { id: 'state', role: 'decision', x: 285, y: 105, w: 220, h: 100, title: 'Create OAuth state', body: ['Bind state to user', 'Expires after 10 minutes'] },
      { id: 'consent', role: 'external', x: 550, y: 105, w: 220, h: 100, title: 'HighLevel consent', body: ['Choose one location', 'Approve scopes'] },
      { id: 'callback', role: 'decision', x: 815, y: 105, w: 245, h: 100, title: 'Validate callback', body: ['Consume one-time state', 'Receive authorization code'] },
      { id: 'exchange', role: 'service', x: 815, y: 285, w: 245, h: 105, title: 'Exchange code', body: ['Use server-side secret', 'Fetch location name'] },
      { id: 'store', role: 'data', x: 550, y: 285, w: 220, h: 105, title: 'Store connection', body: ['Access + refresh tokens', 'Location ID + expiry'] },
      { id: 'ready', role: 'data', x: 285, y: 285, w: 220, h: 105, title: 'Connection ready', body: ['Projects receive location ID', 'Dashboard shows name'] },
      { id: 'later', role: 'ui', x: 40, y: 520, w: 220, h: 100, title: 'Later API request', body: ['Load server-side connection'] },
      { id: 'expiry', role: 'decision', x: 330, y: 500, w: 175, h: 130, title: 'Expires soon?', body: ['Within 60 seconds'], shape: 'diamond' },
      { id: 'current', role: 'service', x: 575, y: 480, w: 220, h: 95, title: 'Use current token', body: ['No refresh needed'] },
      { id: 'refresh', role: 'service', x: 575, y: 610, w: 235, h: 95, title: 'Refresh safely', body: ['Claim 30-second lease', 'Rotate both tokens'] },
      { id: 'call', role: 'external', x: 900, y: 520, w: 235, h: 105, title: 'Call HighLevel API', body: ['Credentials stay server-side'] },
    ],
    edges: [
      { id: 'o1', start: [240, 155], end: [285, 155] }, { id: 'o2', start: [505, 155], end: [550, 155] },
      { id: 'o3', start: [770, 155], end: [815, 155] }, { id: 'o4', start: [938, 205], end: [938, 285] },
      { id: 'o5', start: [815, 338], end: [770, 338] }, { id: 'o6', start: [550, 338], end: [505, 338] },
      { id: 'o7', start: [260, 570], end: [330, 565] }, { id: 'o8', start: [505, 540], end: [575, 525], label: 'no' },
      { id: 'o9', start: [430, 630], end: [575, 657], label: 'yes' }, { id: 'o10', start: [795, 525], end: [900, 565] },
      { id: 'o11', start: [810, 657], end: [1015, 625] },
    ],
  },
  {
    name: 'highlevel-proxy-flow', title: 'Generated App to Real HighLevel Data', width: 1200, height: 690,
    nodes: [
      { id: 'action', role: 'ui', x: 40, y: 120, w: 220, h: 115, title: 'User action', body: ['Search contacts', 'Load appointments', 'Send a message'] },
      { id: 'iframe', role: 'ui', x: 315, y: 120, w: 220, h: 115, title: 'Generated iframe', body: ['Calls only', 'window.genesis.highlevel'] },
      { id: 'host', role: 'service', x: 590, y: 120, w: 235, h: 125, title: 'Host bridge', body: ['Check message source', 'Check operation name', 'Attach Firebase ID token'] },
      { id: 'function', role: 'service', x: 850, y: 120, w: 300, h: 125, title: 'Versioned proxy route', body: ['POST /api/v1/integrations/highlevel', '/proxy-requests · 60/min', 'Authenticate · validate'] },
      { id: 'allowlist', role: 'decision', x: 880, y: 340, w: 245, h: 110, title: 'Operation allowlist', body: ['Contacts · conversations', 'Calendars · appointments'] },
      { id: 'token', role: 'data', x: 590, y: 340, w: 235, h: 110, title: 'Connection resolver', body: ['Load or refresh token', 'Inject user location ID'] },
      { id: 'api', role: 'external', x: 315, y: 340, w: 220, h: 110, title: 'HighLevel API', body: ['Execute one approved call'] },
      { id: 'result', role: 'ui', x: 40, y: 340, w: 220, h: 110, title: 'Preview result', body: ['Render real CRM data', 'or a visible error'] },
      { id: 'boundary', role: 'decision', x: 330, y: 555, w: 555, h: 90, title: 'Trust boundary', body: ['No direct network · no OAuth tokens · no arbitrary endpoints · no demo fallback'] },
    ],
    edges: [
      { id: 'p1', start: [260, 177], end: [315, 177] }, { id: 'p2', start: [535, 177], end: [590, 177], label: 'postMessage' },
      { id: 'p3', start: [825, 182], end: [850, 182], label: 'HTTPS' }, { id: 'p4', start: [1000, 245], end: [1000, 340] },
      { id: 'p5', start: [880, 395], end: [825, 395] }, { id: 'p6', start: [590, 395], end: [535, 395] },
      { id: 'p7', start: [315, 395], end: [260, 395], label: 'JSON result' },
    ],
  },
  {
    name: 'snapshot-restore-flow', title: 'Files, Snapshots, and Restore', width: 1200, height: 690,
    nodes: [
      { id: 'generation', role: 'service', x: 40, y: 110, w: 235, h: 105, title: 'Generation completes', body: ['Files + assistant summary'] },
      { id: 'manual', role: 'ui', x: 40, y: 315, w: 235, h: 105, title: 'User saves an edit', body: ['Complete current file set'] },
      { id: 'current', role: 'data', x: 425, y: 255, w: 300, h: 135, title: 'Current project files', body: ['index.html · styles.css · app.js', 'Used by editor and preview'] },
      { id: 'history', role: 'data', x: 855, y: 125, w: 260, h: 135, title: 'Append-only history', body: ['Generation snapshots', 'Manual-edit snapshots', 'Partial snapshots'] },
      { id: 'choose', role: 'ui', x: 855, y: 355, w: 260, h: 105, title: 'Choose Restore', body: ['Load selected snapshot'] },
      { id: 'backup', role: 'data', x: 540, y: 535, w: 260, h: 105, title: 'Safety backup', body: ['Capture current files first'] },
      { id: 'replace', role: 'service', x: 185, y: 535, w: 270, h: 105, title: 'Restore atomically', body: ['Replace current files', 'Update latest snapshot pointer'] },
    ],
    edges: [
      { id: 's1', start: [275, 160], end: [425, 285], label: 'commit' }, { id: 's2', start: [275, 367], end: [425, 345], label: 'save' },
      { id: 's3', start: [725, 300], end: [855, 195], label: 'append snapshot' }, { id: 's4', start: [985, 260], end: [985, 355], label: 'history UI' },
      { id: 's5', start: [855, 405], end: [800, 585] }, { id: 's6', start: [540, 585], end: [455, 585] },
      { id: 's7', start: [320, 535], end: [500, 390], label: 'refresh state' },
    ],
  },
  {
    name: 'webhook-event-flow', title: 'HighLevel Webhook Intake', width: 1200, height: 660,
    nodes: [
      { id: 'event', role: 'external', x: 40, y: 115, w: 215, h: 100, title: 'HighLevel event', body: ['Contact · message', 'Appointment · uninstall'] },
      { id: 'endpoint', role: 'service', x: 305, y: 115, w: 215, h: 100, title: 'hlWebhook', body: ['Parse event envelope'] },
      { id: 'signature', role: 'decision', x: 575, y: 100, w: 170, h: 130, title: 'Valid signature?', body: ['Ed25519'], shape: 'diamond' },
      { id: 'reject', x: 570, y: 305, w: 180, h: 85, title: 'Reject', body: ['Return 401'], danger: true },
      { id: 'dedupe', role: 'data', x: 800, y: 115, w: 245, h: 105, title: 'Claim webhook ID', body: ['Atomic replay protection', '24-hour TTL'] },
      { id: 'owner', role: 'decision', x: 800, y: 290, w: 245, h: 130, title: 'Route by location', body: ['Find connected owner'], shape: 'diamond' },
      { id: 'uninstall', role: 'service', x: 40, y: 515, w: 235, h: 100, title: 'UNINSTALL', body: ['Delete stored connection'] },
      { id: 'ignore', role: 'neutral', x: 320, y: 515, w: 235, h: 100, title: 'Other event', body: ['Acknowledge and ignore'] },
      { id: 'store', role: 'data', x: 600, y: 515, w: 235, h: 100, title: 'Relevant event', body: ['Store in user hlEvents', '24-hour TTL'] },
      { id: 'ui', role: 'ui', x: 880, y: 515, w: 250, h: 100, title: 'Live UI update', body: ['Workspace and Events page', 'listen through Firestore'] },
    ],
    edges: [
      { id: 'w1', start: [255, 165], end: [305, 165] }, { id: 'w2', start: [520, 165], end: [575, 165] },
      { id: 'w3', role: 'data', start: [745, 165], end: [800, 165], label: 'yes' }, { id: 'w4', start: [660, 230], end: [660, 305], label: 'no', danger: true },
      { id: 'w5', start: [922, 220], end: [922, 290] }, { id: 'w6', start: [830, 420], end: [157, 515], label: 'uninstall' },
      { id: 'w7', start: [885, 420], end: [437, 515], label: 'other' }, { id: 'w8', start: [970, 420], end: [717, 515], label: 'relevant' },
      { id: 'w9', start: [835, 565], end: [880, 565] },
    ],
  },
  {
    name: 'deployment-runtime-flow', title: 'Build, Deploy, and Runtime Configuration', width: 1200, height: 680,
    nodes: [
      { id: 'developer', role: 'ui', x: 40, y: 115, w: 220, h: 100, title: 'Developer', body: ['Pull request or push', 'to main'] },
      { id: 'ci', role: 'service', x: 315, y: 115, w: 220, h: 100, title: 'GitHub Actions', body: ['Install dependencies', 'Build · test'] },
      { id: 'checks', role: 'decision', x: 600, y: 100, w: 175, h: 130, title: 'Checks pass?', shape: 'diamond' },
      { id: 'stop', x: 598, y: 315, w: 180, h: 85, title: 'Stop', body: ['No deployment'], danger: true },
      { id: 'identity', role: 'decision', x: 850, y: 115, w: 255, h: 105, title: 'Production identity', body: ['Short-lived Google access', 'through Workload Identity'] },
      { id: 'firebase', role: 'service', x: 850, y: 330, w: 255, h: 120, title: 'Firebase deploy', body: ['Hosting · Functions', 'Rules + indexes'] },
      { id: 'config', role: 'data', x: 470, y: 515, w: 275, h: 105, title: 'Runtime configuration', body: ['Secret Manager holds keys', 'Environment holds non-secrets'] },
      { id: 'health', role: 'ui', x: 850, y: 525, w: 255, h: 105, title: 'Post-deploy checks', body: ['Open hosting URL', 'Verify /api/v1/health'] },
      { id: 'local', role: 'neutral', x: 40, y: 430, w: 285, h: 130, title: 'Local development', body: ['Vite frontend', 'Firebase emulators', 'Real external integrations'] },
    ],
    edges: [
      { id: 'd1', start: [260, 165], end: [315, 165] }, { id: 'd2', start: [535, 165], end: [600, 165] },
      { id: 'd3', start: [688, 230], end: [688, 315], label: 'no', danger: true }, { id: 'd4', role: 'data', start: [775, 165], end: [850, 165], label: 'yes · push' },
      { id: 'd5', start: [978, 220], end: [978, 330] }, { id: 'd6', start: [745, 565], end: [850, 400], label: 'runtime config' },
      { id: 'd7', start: [978, 450], end: [978, 525] },
    ],
  },
]

// Keep the established diagrams first so their generated Excalidraw seeds stay stable even when
// this file gains new scenes near the top of the catalog.
const newMultiAppDiagramNames = new Set([
  'multi-app-backend-architecture',
  'multi-prompt-generation-briefs',
  'variation-grading-algorithm',
  'multi-app-lifecycle-data-boundaries',
])
const generationOrder = [...diagrams].sort((left, right) => (
  Number(newMultiAppDiagramNames.has(left.name)) - Number(newMultiAppDiagramNames.has(right.name))
))
for (const diagram of generationOrder) writeDiagram(diagram)

const standaloneRoles = {
  'system-architecture': {
    'user-browser': 'ui', sandbox: 'ui', hosting: 'service', auth: 'decision', functions: 'service',
    firestore: 'data', secrets: 'decision', openai: 'external', highlevel: 'external',
  },
  'generation-flow': {
    start: 'ui', guard: 'decision', control: 'decision', context: 'data', model: 'external',
    parse: 'service', valid: 'decision', persist: 'data', render: 'ui', partial: 'danger', bridge: 'service',
  },
}

function recolorSvgShape(svg, shape, style) {
  let pattern
  if (shape.type === 'rectangle') {
    const prefix = `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"`
    const start = svg.indexOf(prefix)
    if (start < 0) throw new Error(`Could not find ${shape.id} in its SVG`)
    const end = svg.indexOf('/>', start) + 2
    const original = svg.slice(start, end)
    const updated = original
      .replace(/fill="[^"]*"/, `fill="${style.fill}"`)
      .replace(/stroke="[^"]*"/, `stroke="${style.stroke}"`)
    return `${svg.slice(0, start)}${updated}${svg.slice(end)}`
  }

  pattern = /<polygon points="[^"]+" fill="[^"]*" stroke="[^"]*"[^>]*\/>/
  if (!pattern.test(svg)) throw new Error(`Could not find ${shape.id} in its SVG`)
  return svg.replace(pattern, (original) => original
    .replace(/fill="[^"]*"/, `fill="${style.fill}"`)
    .replace(/stroke="[^"]*"/, `stroke="${style.stroke}"`))
}

function recolorStandaloneDiagram(name, roleById) {
  const sourcePath = resolve(out, `${name}.excalidraw`)
  const svgPath = resolve(out, `${name}.svg`)
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'))
  let svg = readFileSync(svgPath, 'utf8')

  for (const element of source.elements) {
    const role = roleById[element.id]
    if (!role) continue
    const style = colors[role]
    element.strokeColor = style.stroke
    element.backgroundColor = style.fill
    svg = recolorSvgShape(svg, element, style)
  }

  writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`)
  writeFileSync(svgPath, svg)
}

for (const [name, roles] of Object.entries(standaloneRoles)) recolorStandaloneDiagram(name, roles)
console.log(`Generated and color-coordinated ${diagrams.length + Object.keys(standaloneRoles).length} Excalidraw diagrams in ${out}`)
