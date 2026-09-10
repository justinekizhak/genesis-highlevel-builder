import { createHash, randomUUID } from 'node:crypto'
import type { GenerationEvent } from '../shared/protocol.js'
import { mockProjectFiles } from './mock-project.js'

const languageFor = (path: string) => path.endsWith('.js') ? 'javascript' : path.endsWith('.css') ? 'css' : 'html'

export function buildMockEvents(chunkSize = 72): GenerationEvent[] {
  const generationId = randomUUID()
  const events: GenerationEvent[] = [
    { type: 'generation_started', generationId },
    { type: 'token', delta: 'I will build a contact dashboard with search and upcoming appointment context.' },
  ]

  for (const [path, content] of Object.entries(mockProjectFiles)) {
    events.push({ type: 'file_start', path, language: languageFor(path) })
    for (let index = 0; index < content.length; index += chunkSize) {
      events.push({ type: 'file_delta', path, delta: content.slice(index, index + chunkSize) })
    }
    events.push({
      type: 'file_complete',
      path,
      size: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    })
  }

  events.push({ type: 'snapshot_created', snapshotId: randomUUID() })
  events.push({ type: 'complete', generationId })
  return events
}
