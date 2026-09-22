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
    browser: 'ui', apiv1: 'service', firestore: 'data', openai: 'external', highlevel: 'external', guards: 'decision', cicd: 'neutral',
  },
  'generation-and-grading-pipeline': {
    'gp-prompt': 'ui', 'gp-planner': 'external', 'gp-mode': 'decision', 'gp-pool': 'service', 'gp-persist': 'data', 'gp-abort': 'danger',
  },
  'data-lifecycle-and-highlevel-integration': {
    'dl-collections': 'data', 'dl-isolation': 'decision', 'dl-connect': 'ui', 'dl-proxy': 'service', 'dl-hlapi': 'external',
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

test('exactly three consolidated diagrams are produced, matching the documented current implementation', () => {
  execFileSync(process.execPath, [resolve(root, 'scripts/generate-doc-diagrams.mjs')], { cwd: root })

  const names = Object.keys(expectedRoles)
  assert.equal(names.length, 3)

  const systemArchitecture = readFileSync(resolve(diagramsDir, 'system-architecture.svg'), 'utf8')
  const pipeline = readFileSync(resolve(diagramsDir, 'generation-and-grading-pipeline.svg'), 'utf8')
  const lifecycle = readFileSync(resolve(diagramsDir, 'data-lifecycle-and-highlevel-integration.svg'), 'utf8')

  assert.match(systemArchitecture, /apiV1/)
  assert.match(systemArchitecture, /GitHub Actions CI\/CD/)

  // Regression guard: candidates run at full concurrency (4), not the older "concurrency 2".
  assert.match(pipeline, /concurrency = 4/)
  assert.doesNotMatch(pipeline, /concurrency 2/)
  assert.match(pipeline, /No pairwise comparison pass/)

  assert.match(lifecycle, /hlProxy/)
  assert.match(lifecycle, /hlWebhook/)
})
