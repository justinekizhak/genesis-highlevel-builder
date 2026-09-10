import { initializeApp } from 'firebase-admin/app'
import { logger } from 'firebase-functions'
import { onRequest } from 'firebase-functions/v2/https'
import { z } from 'zod'
import { buildMockEvents } from './generate/mock-events.js'
import { applyCors } from './http/cors.js'
import { serializeSse } from './shared/protocol.js'

initializeApp()

const generateRequestSchema = z.object({
  prompt: z.string().trim().min(3).max(4_000),
  projectId: z.string().trim().min(1).max(128),
})

export const healthz = onRequest({ region: 'us-central1', cors: false }, (request, response) => {
  applyCors(request, response)
  if (request.method === 'OPTIONS') {
    response.status(204).end()
    return
  }
  response.json({ status: 'ok', service: 'genesis-functions', timestamp: new Date().toISOString() })
})

export const generateMock = onRequest(
  { region: 'us-central1', timeoutSeconds: 120, memory: '256MiB', cors: false },
  async (request, response) => {
    applyCors(request, response)
    if (request.method === 'OPTIONS') {
      response.status(204).end()
      return
    }
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed' })
      return
    }

    const parsed = generateRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid generation request', details: parsed.error.flatten() })
      return
    }

    logger.info('Starting mock generation', {
      projectId: parsed.data.projectId,
      promptLength: parsed.data.prompt.length,
    })

    response.status(200)
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    response.setHeader('Cache-Control', 'no-cache, no-transform')
    response.setHeader('Connection', 'keep-alive')
    response.setHeader('X-Accel-Buffering', 'no')
    response.flushHeaders()

    const events = buildMockEvents()
    for (const event of events) {
      if (request.destroyed || response.destroyed) break
      response.write(serializeSse(event))
      await new Promise((resolve) => setTimeout(resolve, event.type === 'file_delta' ? 12 : 55))
    }
    response.end()
  },
)
