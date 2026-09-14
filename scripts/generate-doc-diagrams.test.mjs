import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const diagramsDir = resolve(root, 'docs/diagrams')

const palette = {
  ui: ['#4263eb', '#dbe4ff'],
  service: ['#7048e8', '#e5dbff'],
  data: ['#2b8a3e', '#d3f9d8'],
  external: ['#0b7285', '#c5f6fa'],
  decision: ['#e67700', '#fff3bf'],
  danger: ['#c92a2a', '#ffe3e3'],
  neutral: ['#495057', '#f1f3f5'],
}

const expectedRoles = {
  'system-architecture': {
    'user-browser': 'ui', functions: 'service', firestore: 'data', openai: 'external', highlevel: 'external', auth: 'decision',
  },
  'generation-flow': {
    start: 'ui', guard: 'decision', model: 'external', valid: 'decision', persist: 'data', render: 'ui', partial: 'danger',
  },
  'backend-capability-map': {
    entry: 'ui', generation: 'service', firestore: 'data', openai: 'external', highlevel: 'external', guards: 'decision',
  },
  'oauth-token-lifecycle': {
    connect: 'ui', state: 'decision', store: 'data', consent: 'external', ready: 'data', expiry: 'decision', call: 'external',
  },
  'highlevel-proxy-flow': {
    action: 'ui', host: 'service', function: 'service', allowlist: 'decision', token: 'data', api: 'external', result: 'ui', boundary: 'decision',
  },
  'snapshot-restore-flow': {
    generation: 'service', manual: 'ui', current: 'data', history: 'data', choose: 'ui', backup: 'data', replace: 'service',
  },
  'webhook-event-flow': {
    event: 'external', endpoint: 'service', signature: 'decision', reject: 'danger', store: 'data', ui: 'ui',
  },
  'deployment-runtime-flow': {
    developer: 'ui', ci: 'service', checks: 'decision', stop: 'danger', identity: 'decision', firebase: 'service', config: 'data', health: 'ui',
  },
}

test('generated diagrams preserve the shared semantic color language', () => {
  execFileSync(process.execPath, [resolve(root, 'scripts/generate-doc-diagrams.mjs')], { cwd: root })

  for (const [name, roles] of Object.entries(expectedRoles)) {
    const source = JSON.parse(readFileSync(resolve(diagramsDir, `${name}.excalidraw`), 'utf8'))
    const shapes = new Map(source.elements
      .filter(({ type, isDeleted }) => !isDeleted && ['rectangle', 'diamond', 'ellipse'].includes(type))
      .map((element) => [element.id, element]))

    for (const [id, role] of Object.entries(roles)) {
      const shape = shapes.get(id)
      assert.ok(shape, `${name} is missing ${id}`)
      assert.deepEqual(
        [shape.strokeColor, shape.backgroundColor],
        palette[role],
        `${name}/${id} should use the ${role} colors`,
      )
    }

    const usedFills = new Set([...shapes.values()].map(({ backgroundColor }) => backgroundColor))
    assert.ok(usedFills.size >= 3, `${name} should use at least three semantic fills`)
    assert.ok(!usedFills.has('transparent'), `${name} should not leave semantic nodes unfilled`)

    const svg = readFileSync(resolve(diagramsDir, `${name}.svg`), 'utf8')
    for (const role of new Set(Object.values(roles))) {
      assert.match(svg, new RegExp(`fill="${palette[role][1]}"`), `${name}.svg should render the ${role} fill`)
    }
  }
})
