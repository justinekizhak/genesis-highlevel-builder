import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { onRequest } from 'firebase-functions/v2/https'
import { z } from 'zod'
import { buildApplicationEvents, generatedApplicationSchema } from './generate/application.js'
import { mockProjectFiles } from './generate/mock-project.js'
import { generateWithOpenAi, openAiApiKey, openAiModel } from './generate/openai.js'
import {
  listProjectSnapshots,
  loadGenerationContext,
  loadProjectState,
  persistGeneration,
  persistPartialGeneration,
  restoreProjectSnapshot,
  saveProjectFiles,
} from './generate/persistence.js'
import { StructuredApplicationStream } from './generate/structured-stream.js'
import {
  applicationBaseUrl,
  highLevelClientId,
  highLevelClientSecret,
  highLevelRedirectUri,
  highLevelScopes,
} from './highlevel/config.js'
import { executeHighLevelOperation, highLevelOperations, type HighLevelOperation } from './highlevel/proxy.js'
import { exchangeAuthorizationCode, fetchLocationName, getConnectionSummary, saveConnection } from './highlevel/tokens.js'
import { AuthenticationError, requireFirebaseUser } from './http/auth.js'
import { applyCors } from './http/cors.js'
import { serializeSse } from './shared/protocol.js'

initializeApp()

const generateRequestSchema = z.object({
  prompt: z.string().trim().min(3).max(4_000),
  projectId: z.string().trim().min(1).max(128),
}).strict()

const proxyRequestSchema = z.object({
  operation: z.enum(Object.keys(highLevelOperations) as [HighLevelOperation, ...HighLevelOperation[]]),
  parameters: z.record(z.string(), z.union([
    z.string().max(5_000),
    z.number().finite(),
    z.boolean(),
    z.array(z.string().max(500)).max(20),
    z.undefined(),
  ])).default({}),
})

const projectFilesSchema = z.object({
  projectId: z.string().trim().min(1).max(128),
  files: z.object({
    'index.html': z.string().max(100_000).optional(),
    'styles.css': z.string().max(100_000).optional(),
    'app.js': z.string().max(100_000).optional(),
  }).strict(),
})

const restoreSnapshotSchema = z.object({
  projectId: z.string().trim().min(1).max(128),
  snapshotId: z.string().trim().min(1).max(128),
})

function httpError(response: Parameters<typeof applyCors>[1], cause: unknown) {
  const message = cause instanceof Error ? cause.message : 'Unexpected server error.'
  response.status(cause instanceof AuthenticationError ? 401 : 400).json({ error: message })
}

export const healthz = onRequest({ region: 'us-central1', cors: false }, (request, response) => {
  applyCors(request, response)
  if (request.method === 'OPTIONS') {
    response.status(204).end()
    return
  }
  response.json({ status: 'ok', service: 'genesis-functions', timestamp: new Date().toISOString() })
})

export const generateApp = onRequest(
  { region: 'us-central1', timeoutSeconds: 300, memory: '512MiB', cors: false, secrets: [openAiApiKey] },
  async (request, response) => {
    let partialGeneration: {
      uid: string
      projectId: string
      prompt: string
      generationId: string
      provider: 'openai' | 'mock'
      parser: StructuredApplicationStream
      currentFiles: Record<string, string>
    } | undefined
    let generationPersisted = false
    applyCors(request, response)
    if (request.method === 'OPTIONS') {
      response.status(204).end()
      return
    }
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed' })
      return
    }

    try {
      const user = await requireFirebaseUser(request)
      const input = generateRequestSchema.parse(request.body)
      const generationContext = await loadGenerationContext(user.uid, input.projectId)
      const currentFiles = generationContext.files
      const useOpenAi = Boolean(openAiApiKey.value())
      logger.info('Starting application generation', {
        projectId: input.projectId,
        promptLength: input.prompt.length,
        provider: useOpenAi ? 'openai' : 'mock',
      })

      response.status(200)
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      response.setHeader('Cache-Control', 'no-cache, no-transform')
      response.setHeader('Connection', 'keep-alive')
      response.setHeader('X-Accel-Buffering', 'no')
      response.flushHeaders()

      const generationId = crypto.randomUUID()
      const abortController = new AbortController()
      response.on('close', () => {
        if (!response.writableEnded) abortController.abort()
      })
      const heartbeat = setInterval(() => {
        if (!response.destroyed) response.write(': heartbeat\n\n')
      }, 15_000)
      response.write(serializeSse({
        type: 'generation_started',
        generationId,
        provider: useOpenAi ? 'openai' : 'mock',
        model: useOpenAi ? openAiModel.value() : undefined,
      }))
      try {
        const streamParser = new StructuredApplicationStream()
        partialGeneration = {
          uid: user.uid,
          projectId: input.projectId,
          prompt: input.prompt,
          generationId,
          provider: useOpenAi ? 'openai' : 'mock',
          parser: streamParser,
          currentFiles,
        }
        const application = useOpenAi
          ? await generateWithOpenAi(input.prompt, currentFiles, abortController.signal, (delta) => {
            for (const event of streamParser.push(delta)) {
              if (!response.destroyed) response.write(serializeSse(event))
            }
          }, generationContext)
          : generatedApplicationSchema.parse({
            summary: 'OPENAI_API_KEY is not configured, so Genesis generated the safe demo application.',
            files: Object.entries(mockProjectFiles).map(([path, content]) => ({ path, content })),
          })
        const built = buildApplicationEvents(application, 160, { generationId })
        await persistGeneration({
          uid: user.uid,
          projectId: input.projectId,
          prompt: input.prompt,
          application,
          generationId,
          snapshotId: built.snapshotId,
          provider: useOpenAi ? 'openai' : 'mock',
        })
        generationPersisted = true

        if (!useOpenAi) {
          for (const event of built.events.slice(1, -2)) {
            if (!response.destroyed) response.write(serializeSse(event))
          }
        }
        if (!response.destroyed) {
          response.write(serializeSse({ type: 'snapshot_created', snapshotId: built.snapshotId }))
          response.write(serializeSse({ type: 'complete', generationId }))
          response.end()
        }
      } finally {
        clearInterval(heartbeat)
      }
    } catch (cause) {
      logger.error('Application generation failed', cause)
      if (!generationPersisted && partialGeneration) {
        await persistPartialGeneration({
          uid: partialGeneration.uid,
          projectId: partialGeneration.projectId,
          prompt: partialGeneration.prompt,
          generationId: partialGeneration.generationId,
          provider: partialGeneration.provider,
          summary: partialGeneration.parser.partialSummary(),
          files: { ...partialGeneration.currentFiles, ...partialGeneration.parser.partialFiles() },
        }).catch((persistenceError) => logger.error('Could not preserve partial generation', persistenceError))
      }
      if (!response.headersSent) {
        httpError(response, cause)
        return
      }
      if (response.destroyed) return
      const message = cause instanceof Error ? cause.message : 'Application generation failed.'
      response.write(serializeSse({ type: 'error', code: 'GENERATION_FAILED', message, recoverable: true }))
      response.end()
    }
  },
)

export const projectSnapshots = onRequest({ region: 'us-central1', cors: false }, async (request, response) => {
  applyCors(request, response)
  if (request.method === 'OPTIONS') return void response.status(204).end()
  if (request.method !== 'GET') return void response.status(405).json({ error: 'Method not allowed' })
  try {
    const user = await requireFirebaseUser(request)
    const projectId = z.string().trim().min(1).max(128).parse(request.query.projectId)
    response.json({ snapshots: await listProjectSnapshots(user.uid, projectId) })
  } catch (cause) {
    httpError(response, cause)
  }
})

export const saveFiles = onRequest({ region: 'us-central1', cors: false }, async (request, response) => {
  applyCors(request, response)
  if (request.method === 'OPTIONS') return void response.status(204).end()
  if (request.method !== 'POST') return void response.status(405).json({ error: 'Method not allowed' })
  try {
    const user = await requireFirebaseUser(request)
    const input = projectFilesSchema.parse(request.body)
    await saveProjectFiles(user.uid, input.projectId, input.files)
    response.json({ ok: true })
  } catch (cause) {
    httpError(response, cause)
  }
})

export const restoreSnapshot = onRequest({ region: 'us-central1', cors: false }, async (request, response) => {
  applyCors(request, response)
  if (request.method === 'OPTIONS') return void response.status(204).end()
  if (request.method !== 'POST') return void response.status(405).json({ error: 'Method not allowed' })
  try {
    const user = await requireFirebaseUser(request)
    const input = restoreSnapshotSchema.parse(request.body)
    response.json(await restoreProjectSnapshot(user.uid, input.projectId, input.snapshotId))
  } catch (cause) {
    httpError(response, cause)
  }
})

export const projectState = onRequest({ region: 'us-central1', cors: false }, async (request, response) => {
  applyCors(request, response)
  if (request.method === 'OPTIONS') return void response.status(204).end()
  if (request.method !== 'GET') return void response.status(405).json({ error: 'Method not allowed' })
  try {
    const user = await requireFirebaseUser(request)
    const projectId = z.string().trim().min(1).max(128).parse(request.query.projectId)
    response.json(await loadProjectState(user.uid, projectId))
  } catch (cause) {
    httpError(response, cause)
  }
})

export const hlOAuthStart = onRequest({ region: 'us-central1', cors: false }, async (request, response) => {
  applyCors(request, response)
  if (request.method === 'OPTIONS') return void response.status(204).end()
  if (request.method !== 'POST') return void response.status(405).json({ error: 'Method not allowed' })
  try {
    const user = await requireFirebaseUser(request)
    if (!highLevelClientId.value() || !highLevelRedirectUri.value()) throw new Error('HighLevel OAuth is not configured.')
    const state = crypto.randomUUID()
    await getFirestore().collection('oauthStates').doc(state).set({
      uid: user.uid,
      expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60_000),
      createdAt: Timestamp.now(),
    })
    const url = new URL('https://marketplace.leadconnectorhq.com/oauth/chooselocation')
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', highLevelClientId.value())
    url.searchParams.set('redirect_uri', highLevelRedirectUri.value())
    url.searchParams.set('scope', highLevelScopes)
    url.searchParams.set('state', state)
    response.json({ authorizationUrl: url.toString() })
  } catch (cause) {
    httpError(response, cause)
  }
})

export const hlAuthCallback = onRequest(
  { region: 'us-central1', cors: false, secrets: [highLevelClientSecret] },
  async (request, response) => {
    const code = typeof request.query.code === 'string' ? request.query.code : ''
    const state = typeof request.query.state === 'string' ? request.query.state : ''
    const fallback = new URL('/projects', applicationBaseUrl.value())
    if (!code || !state) {
      fallback.searchParams.set('oauth', 'invalid_callback')
      return void response.redirect(fallback.toString())
    }
    try {
      const db = getFirestore()
      const stateReference = db.collection('oauthStates').doc(state)
      const uid = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(stateReference)
        const data = snapshot.data() as { uid?: string; expiresAt?: Timestamp } | undefined
        if (!data?.uid || !data.expiresAt || data.expiresAt.toMillis() < Date.now()) throw new Error('OAuth state is invalid or expired.')
        transaction.delete(stateReference)
        return data.uid
      })
      const tokens = await exchangeAuthorizationCode(code)
      const locationName = await fetchLocationName(tokens.access_token, tokens.locationId)
      await saveConnection(uid, tokens, locationName)
      const connectedProjects = await db.collection('projects').where('ownerId', '==', uid).get()
      const projectBatch = db.batch()
      let projectUpdates = 0
      for (const project of connectedProjects.docs) {
        if (!project.get('deletedAt')) {
          projectBatch.update(project.ref, { locationId: tokens.locationId })
          projectUpdates += 1
        }
      }
      if (projectUpdates) await projectBatch.commit()
      const success = new URL('/projects', applicationBaseUrl.value())
      success.searchParams.set('oauth', 'connected')
      response.redirect(success.toString())
    } catch (cause) {
      logger.error('HighLevel OAuth callback failed', cause)
      fallback.searchParams.set('oauth', 'failed')
      response.redirect(fallback.toString())
    }
  },
)

export const hlConnectionStatus = onRequest(
  { region: 'us-central1', cors: false, secrets: [highLevelClientSecret] },
  async (request, response) => {
    applyCors(request, response)
    if (request.method === 'OPTIONS') return void response.status(204).end()
    if (request.method !== 'GET') return void response.status(405).json({ error: 'Method not allowed' })
    try {
      const user = await requireFirebaseUser(request)
      const connection = await getConnectionSummary(user.uid)
      if (!connection) return void response.json({ connected: false })
      response.json({
        connected: true,
        ...connection,
      })
    } catch (cause) {
      httpError(response, cause)
    }
  },
)

export const integrationStatus = onRequest(
  { region: 'us-central1', cors: false, secrets: [openAiApiKey, highLevelClientSecret] },
  async (request, response) => {
    applyCors(request, response)
    if (request.method === 'OPTIONS') return void response.status(204).end()
    if (request.method !== 'GET') return void response.status(405).json({ error: 'Method not allowed' })
    try {
      const user = await requireFirebaseUser(request)
      const connection = await getConnectionSummary(user.uid)
      response.json({
        llm: { configured: Boolean(openAiApiKey.value()), model: openAiModel.value() },
        highLevel: connection ? {
          connected: true,
          ...connection,
        } : { connected: false },
      })
    } catch (cause) {
      httpError(response, cause)
    }
  },
)

export const hlProxy = onRequest(
  { region: 'us-central1', cors: false, secrets: [highLevelClientSecret], timeoutSeconds: 60 },
  async (request, response) => {
    applyCors(request, response)
    if (request.method === 'OPTIONS') return void response.status(204).end()
    if (request.method !== 'POST') return void response.status(405).json({ error: 'Method not allowed' })
    try {
      const user = await requireFirebaseUser(request)
      const input = proxyRequestSchema.parse(request.body)
      const data = await executeHighLevelOperation(user.uid, input.operation, input.parameters)
      response.json({ data })
    } catch (cause) {
      httpError(response, cause)
    }
  },
)
