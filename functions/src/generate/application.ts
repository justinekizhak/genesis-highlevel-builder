import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { GenerationEvent } from '../shared/protocol.js'

export const generatedFileSchema = z.object({
  path: z.enum(['index.html', 'styles.css', 'app.js']),
  content: z.string().max(100_000),
})

export const generatedApplicationSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  files: z.array(generatedFileSchema).length(3),
}).superRefine(({ files }, context) => {
  const paths = new Set(files.map((file) => file.path))
  for (const required of ['index.html', 'styles.css', 'app.js']) {
    if (!paths.has(required as 'index.html')) {
      context.addIssue({ code: 'custom', message: `Missing required file: ${required}`, path: ['files'] })
    }
  }
})

export type GeneratedApplication = z.infer<typeof generatedApplicationSchema>

const languageFor = (path: string) => path.endsWith('.js') ? 'javascript' : path.endsWith('.css') ? 'css' : 'html'

export function buildApplicationEvents(
  application: GeneratedApplication,
  chunkSize = 160,
  ids: { generationId?: string; snapshotId?: string } = {},
) {
  const generationId = ids.generationId ?? randomUUID()
  const snapshotId = ids.snapshotId ?? randomUUID()
  const events: GenerationEvent[] = [
    { type: 'generation_started', generationId },
    { type: 'token', delta: application.summary },
  ]

  for (const file of application.files) {
    events.push({ type: 'file_start', path: file.path, language: languageFor(file.path) })
    for (let index = 0; index < file.content.length; index += chunkSize) {
      events.push({ type: 'file_delta', path: file.path, delta: file.content.slice(index, index + chunkSize) })
    }
    events.push({
      type: 'file_complete',
      path: file.path,
      size: file.content.length,
      sha256: createHash('sha256').update(file.content).digest('hex'),
    })
  }

  events.push({ type: 'snapshot_created', snapshotId })
  events.push({ type: 'complete', generationId })
  return { events, generationId, snapshotId }
}

/**
 * Finalist transfer reuses the same chunking and SHA-256 integrity contract as a single
 * generation, but tags every frame with the candidate it belongs to so the client can keep two
 * file sets isolated without touching active workspace files.
 */
export function buildFinalistFileEvents(
  candidateId: string,
  files: Record<string, string>,
  chunkSize = 160,
) {
  const events: GenerationEvent[] = []
  for (const path of ['index.html', 'styles.css', 'app.js']) {
    const content = files[path]
    if (typeof content !== 'string') continue
    events.push({ type: 'finalist_file_start', candidateId, path, language: languageFor(path) })
    for (let index = 0; index < content.length; index += chunkSize) {
      events.push({ type: 'finalist_file_delta', candidateId, path, delta: content.slice(index, index + chunkSize) })
    }
    events.push({
      type: 'finalist_file_complete',
      candidateId,
      path,
      size: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    })
  }
  return events
}

export const applicationJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'files'],
  properties: {
    summary: { type: 'string', maxLength: 600 },
    files: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'content'],
        properties: {
          path: { type: 'string', enum: ['index.html', 'styles.css', 'app.js'] },
          content: { type: 'string', maxLength: 100_000 },
        },
      },
    },
  },
} as const
