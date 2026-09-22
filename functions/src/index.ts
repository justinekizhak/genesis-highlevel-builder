import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { onRequest } from 'firebase-functions/v2/https'
import { z } from 'zod'
import { buildApplicationEvents, buildFinalistFileEvents } from './generate/application.js'
import { planGeneration } from './generate/variation-planner.js'
import { InsufficientVariationCandidatesError, runVariationGeneration } from './generate/variation-orchestrator.js'
import {
  loadVariationSet,
  persistVariationFinalists,
  selectVariationFinalist,
  VariationSelectionConflictError,
} from './generate/variation-persistence.js'
import { generateWithOpenAi, openAiApiKey, openAiModel, selectableOpenAiModels } from './generate/openai.js'
import {
  acquireGenerationLock,
  GenerationLockedError,
  listProjectSnapshots,
  loadGenerationContext,
  loadProjectState,
  loadSnapshotFiles,
  observeGenerationCancellation,
  persistGeneration,
  persistPartialGeneration,
  persistUserMessage,
  releaseGenerationLock,
  requestGenerationCancellation,
  restoreProjectSnapshot,
  saveProjectFiles,
  updateSnapshotField,
} from './generate/persistence.js'
import { StructuredApplicationStream } from './generate/structured-stream.js'
import { UnsafeGenerationError, validateGeneratedApplication } from './generate/validate.js'
import { handleHighLevelWebhookPayload, webhookPayloadSchema } from './webhook.js'
import {
  applicationBaseUrl,
  highLevelClientId,
  highLevelClientSecret,
  highLevelRedirectUri,
  highLevelScopes,
  highLevelWebhookPublicKey,
} from './highlevel/config.js'
import { executeHighLevelOperation, highLevelOperations, type HighLevelOperation } from './highlevel/proxy.js'
import { exchangeAuthorizationCode, fetchLocationName, getConnectionSummary, saveConnection } from './highlevel/tokens.js'
import { AuthenticationError, requireFirebaseUser } from './http/auth.js'
import { allowedApiV1Methods, resolveApiV1Route, type ApiV1Target } from './http/api-v1.js'
import { applyCors } from './http/cors.js'
import { enforceRateLimit, RateLimitError } from './http/rate-limit.js'
import { serializeSse, type GenerationEvent } from './shared/protocol.js'
import { withRequestTiming } from './shared/telemetry.js'

initializeApp()

const generateRequestSchema = z.object({
  prompt: z.string().trim().min(3).max(4_000),
  projectId: z.string().trim().min(1).max(128),
  generationId: z.string().uuid().optional(),
  model: z.enum(selectableOpenAiModels).optional(),
}).strict()

const cancelGenerationSchema = z.object({
  projectId: z.string().trim().min(1).max(128),
  generationId: z.string().uuid(),
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
}).strict()

const projectFilesSchema = z.object({
  projectId: z.string().trim().min(1).max(128),
  files: z.object({
    'index.html': z.string().max(100_000).optional(),
    'styles.css': z.string().max(100_000).optional(),
    'app.js': z.string().max(100_000).optional(),
  }).strict(),
}).strict()

const variationSetSchema = z.object({
  projectId: z.string().trim().min(1).max(128),
  variationSetId: z.string().trim().min(1).max(128),
}).strict()

const variationSelectionSchema = z.object({
  projectId: z.string().trim().min(1).max(128),
  variationSetId: z.string().trim().min(1).max(128),
  candidateId: z.string().trim().min(1).max(128),
}).strict()

const restoreSnapshotSchema = z.object({
  projectId: z.string().trim().min(1).max(128),
  snapshotId: z.string().trim().min(1).max(128),
}).strict()

const snapshotFilesSchema = z.object({
  projectId: z.string().trim().min(1).max(128),
  snapshotId: z.string().trim().min(1).max(128),
}).strict()

const updateSnapshotFieldSchema = z.object({
  projectId: z.string().trim().min(1).max(128),
  snapshotId: z.string().trim().min(1).max(128),
  field: z.enum(['message', 'description']),
  value: z.string().trim().max(2_000),
}).strict()

function httpError(response: Parameters<typeof applyCors>[1], cause: unknown) {
  const message = cause instanceof Error ? cause.message : 'Unexpected server error.'
  const status = cause instanceof AuthenticationError ? 401
    : cause instanceof RateLimitError ? 429
    : cause instanceof GenerationLockedError ? 409
    : cause instanceof VariationSelectionConflictError ? 409
    : 400
  if (cause instanceof RateLimitError) response.setHeader('Retry-After', String(cause.retryAfterSeconds))
  response.status(status).json({ error: message })
}

export const healthz = onRequest({ region: 'us-central1', cors: false }, withRequestTiming('healthz', (request, response) => {
  applyCors(request, response)
  if (request.method === 'OPTIONS') {
    response.status(204).end()
    return
  }
  response.json({ status: 'ok', service: 'genesis-functions', timestamp: new Date().toISOString() })
}))

/** A variation batch costs four generation units; a single request costs one. */
async function enforceGenerationQuotas(uid: string, weight: number) {
  await enforceRateLimit(uid, 'generate-minute', 5, 60, "You're generating too quickly. Wait about a minute and try again.", weight)
  await enforceRateLimit(uid, 'generate-day', 50, 86_400, "You've reached today's generation limit (50). Try again tomorrow.", weight)
}

export const generateApp = onRequest(
  // The multi-variant branch generates four candidates fully in parallel and then grades them,
  // so the streaming route needs the longer ceiling; memory stays at the current allocation.
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB', cors: false, secrets: [openAiApiKey] },
  withRequestTiming('generateApp', async (request, response) => {
    let partialGeneration: {
      uid: string
      projectId: string
      prompt: string
      generationId: string
      provider: 'openai'
      model: string
      parser: StructuredApplicationStream
      currentFiles: Record<string, string>
    } | undefined
    let generationPersisted = false
    let generationCancellationRequested = false
    let lockHeld = false
    let lockedProject: { uid: string; projectId: string; generationId: string } | undefined
    let stopWatchingCancellation: (() => void) | undefined
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
      if (!openAiApiKey.value()) throw new Error('AI generation is not configured. Set the OPENAI_API_KEY secret and redeploy the generation function.')
      if (!generationContext.project.locationId) throw new Error('Connect a HighLevel location to this project before generating an app.')
      const generationId = input.generationId ?? crypto.randomUUID()
      const generationModel = input.model ?? openAiModel.value()
      await acquireGenerationLock(user.uid, input.projectId, generationId)
      lockHeld = true
      lockedProject = { uid: user.uid, projectId: input.projectId, generationId }
      await persistUserMessage({ uid: user.uid, projectId: input.projectId, prompt: input.prompt, generationId })
      logger.info('Starting application generation', {
        projectId: input.projectId,
        promptLength: input.prompt.length,
        provider: 'openai',
        model: generationModel,
      })

      response.status(200)
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      response.setHeader('Cache-Control', 'no-cache, no-transform')
      response.setHeader('Connection', 'keep-alive')
      response.setHeader('X-Accel-Buffering', 'no')
      response.flushHeaders()

      const abortController = new AbortController()
      stopWatchingCancellation = await observeGenerationCancellation(
        user.uid,
        input.projectId,
        generationId,
        () => {
          generationCancellationRequested = true
          abortController.abort(new Error('Generation cancelled by the user.'))
        },
        (watchError) => logger.error('Could not observe generation cancellation', watchError),
      )
      response.on('close', () => {
        if (!response.writableEnded) abortController.abort()
      })
      const heartbeat = setInterval(() => {
        if (!response.destroyed) response.write(': heartbeat\n\n')
      }, 15_000)
      response.write(serializeSse({
        type: 'generation_started',
        generationId,
        provider: 'openai',
        model: generationModel,
      }))
      const writeEvent = (event: GenerationEvent) => {
        if (!response.destroyed) response.write(serializeSse(event))
      }

      /** The existing single-generation path, unchanged after `generation_started`. */
      const runSingleGeneration = async () => {
        const streamParser = new StructuredApplicationStream()
        partialGeneration = {
          uid: user.uid,
          projectId: input.projectId,
          prompt: input.prompt,
          generationId,
          provider: 'openai',
          model: generationModel,
          parser: streamParser,
          currentFiles,
        }
        const application = await generateWithOpenAi(input.prompt, currentFiles, abortController.signal, (delta) => {
          for (const event of streamParser.push(delta)) writeEvent(event)
        }, generationContext, generationModel, (usage) => {
          writeEvent({ type: 'usage', ...usage })
        })
        validateGeneratedApplication(application)
        const built = buildApplicationEvents(application, 160, { generationId })
        await persistGeneration({
          uid: user.uid,
          projectId: input.projectId,
          prompt: input.prompt,
          application,
          generationId,
          snapshotId: built.snapshotId,
          provider: 'openai',
          model: generationModel,
        })
        generationPersisted = true

        if (!response.destroyed) {
          writeEvent({ type: 'snapshot_created', snapshotId: built.snapshotId })
          writeEvent({ type: 'complete', generationId })
          response.end()
        }
      }

      /**
       * Candidate code stays in function memory until two finalists are persisted; only then do
       * finalist file sets stream, and the batch ends on `variation_complete` rather than `complete`.
       */
      const runAndPersistVariations = async (plan: Awaited<ReturnType<typeof planGeneration>>) => {
        const run = await runVariationGeneration({
          prompt: input.prompt,
          plan,
          currentFiles,
          model: generationModel,
          signal: abortController.signal,
          onEvent: writeEvent,
          context: generationContext,
        })
        await persistVariationFinalists({
          uid: user.uid,
          projectId: input.projectId,
          variationSetId: run.variationSetId,
          generationId,
          prompt: input.prompt,
          baseSnapshotId: generationContext.latestSnapshotId,
          model: generationModel,
          gradingMode: run.gradingMode,
          eligibleCount: run.eligibleCount,
          aggregateUsage: run.aggregateUsage,
          finalists: run.finalists,
        })
        generationPersisted = true

        writeEvent({ type: 'usage', ...run.aggregateUsage })
        writeEvent({
          type: 'finalist_metadata',
          variationSetId: run.variationSetId,
          finalists: run.finalists.map((finalist) => ({
            candidateId: finalist.candidateId,
            displayName: finalist.displayName,
            summary: finalist.summary,
            standout: finalist.standout,
            internalRank: finalist.internalRank,
            scoreBreakdown: finalist.scoreBreakdown,
            brief: finalist.brief,
            rubric: finalist.rubric,
          })),
        })
        for (const finalist of run.finalists) {
          for (const event of buildFinalistFileEvents(finalist.candidateId, finalist.files)) writeEvent(event)
        }
        writeEvent({ type: 'finalists_ready', variationSetId: run.variationSetId })
        writeEvent({ type: 'variation_complete', variationSetId: run.variationSetId })
        if (!response.destroyed) response.end()
      }

      try {
        writeEvent({ type: 'variation_planning_started' })
        const plan = await planGeneration(input.prompt, generationContext, abortController.signal)
        const useVariations = plan.mode === 'variations'
        await enforceGenerationQuotas(user.uid, useVariations ? 4 : 1)
        if (useVariations) await runAndPersistVariations(plan)
        else await runSingleGeneration()
      } finally {
        clearInterval(heartbeat)
        stopWatchingCancellation?.()
        stopWatchingCancellation = undefined
        if (lockHeld && lockedProject) {
          lockHeld = false
          await releaseGenerationLock(lockedProject.uid, lockedProject.projectId, lockedProject.generationId).catch((lockError) => logger.error('Could not release generation lock', lockError))
        }
      }
    } catch (cause) {
      logger.error('Application generation failed', cause)
      stopWatchingCancellation?.()
      stopWatchingCancellation = undefined
      if (lockHeld && lockedProject) {
        await releaseGenerationLock(lockedProject.uid, lockedProject.projectId, lockedProject.generationId).catch((lockError) => logger.error('Could not release generation lock', lockError))
      }
      if (!generationPersisted && partialGeneration) {
        await persistPartialGeneration({
          uid: partialGeneration.uid,
          projectId: partialGeneration.projectId,
          prompt: partialGeneration.prompt,
          generationId: partialGeneration.generationId,
          provider: partialGeneration.provider,
          model: partialGeneration.model,
          summary: partialGeneration.parser.partialSummary(),
          files: { ...partialGeneration.currentFiles, ...partialGeneration.parser.partialFiles() },
        }).catch((persistenceError) => logger.error('Could not preserve partial generation', persistenceError))
      }
      if (!response.headersSent) {
        httpError(response, cause)
        return
      }
      if (response.destroyed) return
      const message = generationCancellationRequested
        ? 'Generation stopped by the user.'
        : cause instanceof Error ? cause.message : 'Application generation failed.'
      const code = generationCancellationRequested
        ? 'GENERATION_CANCELLED'
        : cause instanceof InsufficientVariationCandidatesError ? 'VARIATION_INSUFFICIENT_CANDIDATES'
        : cause instanceof UnsafeGenerationError ? 'UNSAFE_OUTPUT' : 'GENERATION_FAILED'
      response.write(serializeSse({ type: 'error', code, message, recoverable: true }))
      response.end()
    }
  }),
)

export const cancelGeneration = onRequest({ region: 'us-central1', cors: false }, withRequestTiming('cancelGeneration', async (request, response) => {
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
    const input = cancelGenerationSchema.parse(request.body)
    const result = await requestGenerationCancellation(user.uid, input.projectId, input.generationId)
    response.json(result)
  } catch (cause) {
    httpError(response, cause)
  }
}))

export const projectSnapshots = onRequest({ region: 'us-central1', cors: false }, withRequestTiming('projectSnapshots', async (request, response) => {
  applyCors(request, response)
  if (request.method === 'OPTIONS') return void response.status(204).end()
  if (request.method !== 'GET') return void response.status(405).json({ error: 'Method not allowed' })
  try {
    const user = await requireFirebaseUser(request)
    const projectId = z.string().trim().min(1).max(128).parse(request.params.projectId ?? request.query.projectId)
    response.json({ snapshots: await listProjectSnapshots(user.uid, projectId) })
  } catch (cause) {
    httpError(response, cause)
  }
}))

export const saveFiles = onRequest({ region: 'us-central1', cors: false }, withRequestTiming('saveFiles', async (request, response) => {
  applyCors(request, response)
  if (request.method === 'OPTIONS') return void response.status(204).end()
  if (request.method !== 'POST' && request.method !== 'PUT') return void response.status(405).json({ error: 'Method not allowed' })
  try {
    const user = await requireFirebaseUser(request)
    const input = projectFilesSchema.parse(request.body)
    const result = await saveProjectFiles(user.uid, input.projectId, input.files)
    response.json({ ok: true, snapshotId: result.snapshotId })
  } catch (cause) {
    httpError(response, cause)
  }
}))

export const projectSnapshotFiles = onRequest({ region: 'us-central1', cors: false }, withRequestTiming('projectSnapshotFiles', async (request, response) => {
  applyCors(request, response)
  if (request.method === 'OPTIONS') return void response.status(204).end()
  if (request.method !== 'GET') return void response.status(405).json({ error: 'Method not allowed' })
  try {
    const user = await requireFirebaseUser(request)
    const input = snapshotFilesSchema.parse({ ...request.query, ...request.params })
    response.json(await loadSnapshotFiles(user.uid, input.projectId, input.snapshotId))
  } catch (cause) {
    httpError(response, cause)
  }
}))

export const updateSnapshot = onRequest({ region: 'us-central1', cors: false }, withRequestTiming('updateSnapshot', async (request, response) => {
  applyCors(request, response)
  if (request.method === 'OPTIONS') return void response.status(204).end()
  if (request.method !== 'POST' && request.method !== 'PATCH') return void response.status(405).json({ error: 'Method not allowed' })
  try {
    const user = await requireFirebaseUser(request)
    const input = updateSnapshotFieldSchema.parse(request.body)
    response.json(await updateSnapshotField(user.uid, input.projectId, input.snapshotId, input.field, input.value))
  } catch (cause) {
    httpError(response, cause)
  }
}))

export const restoreSnapshot = onRequest({ region: 'us-central1', cors: false }, withRequestTiming('restoreSnapshot', async (request, response) => {
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
}))

export const projectState = onRequest({ region: 'us-central1', cors: false }, withRequestTiming('projectState', async (request, response) => {
  applyCors(request, response)
  if (request.method === 'OPTIONS') return void response.status(204).end()
  if (request.method !== 'GET') return void response.status(405).json({ error: 'Method not allowed' })
  try {
    const user = await requireFirebaseUser(request)
    const projectId = z.string().trim().min(1).max(128).parse(request.params.projectId ?? request.query.projectId)
    response.json(await loadProjectState(user.uid, projectId))
  } catch (cause) {
    httpError(response, cause)
  }
}))

export const projectVariationSet = onRequest({ region: 'us-central1', cors: false }, withRequestTiming('projectVariationSet', async (request, response) => {
  applyCors(request, response)
  if (request.method === 'OPTIONS') return void response.status(204).end()
  if (request.method !== 'GET') return void response.status(405).json({ error: 'Method not allowed' })
  try {
    const user = await requireFirebaseUser(request)
    const input = variationSetSchema.parse({ ...request.query, ...request.params })
    response.json(await loadVariationSet(user.uid, input.projectId, input.variationSetId))
  } catch (cause) {
    httpError(response, cause)
  }
}))

export const selectVariation = onRequest({ region: 'us-central1', cors: false }, withRequestTiming('selectVariation', async (request, response) => {
  applyCors(request, response)
  if (request.method === 'OPTIONS') return void response.status(204).end()
  if (request.method !== 'POST') return void response.status(405).json({ error: 'Method not allowed' })
  try {
    const user = await requireFirebaseUser(request)
    const input = variationSelectionSchema.parse({ ...request.body, ...request.params })
    response.json(await selectVariationFinalist({
      uid: user.uid,
      projectId: input.projectId,
      variationSetId: input.variationSetId,
      candidateId: input.candidateId,
    }))
  } catch (cause) {
    httpError(response, cause)
  }
}))

export const hlOAuthStart = onRequest({ region: 'us-central1', cors: false }, withRequestTiming('hlOAuthStart', async (request, response) => {
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
}))

export const hlAuthCallback = onRequest(
  { region: 'us-central1', cors: false, secrets: [highLevelClientSecret] },
  withRequestTiming('hlAuthCallback', async (request, response) => {
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
  }),
)

export const hlConnectionStatus = onRequest(
  { region: 'us-central1', cors: false, secrets: [highLevelClientSecret] },
  withRequestTiming('hlConnectionStatus', async (request, response) => {
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
  }),
)

export const integrationStatus = onRequest(
  { region: 'us-central1', cors: false, secrets: [openAiApiKey, highLevelClientSecret] },
  withRequestTiming('integrationStatus', async (request, response) => {
    applyCors(request, response)
    if (request.method === 'OPTIONS') return void response.status(204).end()
    if (request.method !== 'GET') return void response.status(405).json({ error: 'Method not allowed' })
    try {
      const user = await requireFirebaseUser(request)
      const connection = await getConnectionSummary(user.uid)
      response.json({
        llm: { configured: Boolean(openAiApiKey.value()), model: openAiModel.value(), availableModels: selectableOpenAiModels },
        highLevel: connection ? {
          connected: true,
          ...connection,
        } : { connected: false },
      })
    } catch (cause) {
      httpError(response, cause)
    }
  }),
)

export const hlProxy = onRequest(
  { region: 'us-central1', cors: false, secrets: [highLevelClientSecret], timeoutSeconds: 60 },
  withRequestTiming('hlProxy', async (request, response) => {
    applyCors(request, response)
    if (request.method === 'OPTIONS') return void response.status(204).end()
    if (request.method !== 'POST') return void response.status(405).json({ error: 'Method not allowed' })
    try {
      const user = await requireFirebaseUser(request)
      await enforceRateLimit(user.uid, 'hl-proxy-minute', 60, 60, 'Too many HighLevel requests. Wait a moment and try again.')
      const input = proxyRequestSchema.parse(request.body)
      const data = await executeHighLevelOperation(user.uid, input.operation, input.parameters)
      response.json({ data })
    } catch (cause) {
      httpError(response, cause)
    }
  }),
)

export const hlWebhook = onRequest({ region: 'us-central1', cors: false }, withRequestTiming('hlWebhook', async (request, response) => {
  if (request.method !== 'POST') return void response.status(405).json({ error: 'Method not allowed' })
  try {
    const payload = webhookPayloadSchema.parse(request.body)
    const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(request.body))
    const signature = request.header('x-ghl-signature')
    const outcome = await handleHighLevelWebhookPayload(rawBody, signature, highLevelWebhookPublicKey.value(), payload)
    if (outcome === 'invalid_signature') return void response.status(401).json({ error: 'Invalid webhook signature.' })
    response.status(200).json({ ok: true, outcome })
  } catch (cause) {
    logger.error('HighLevel webhook processing failed', cause)
    response.status(200).json({ ok: true })
  }
}))

const apiV1Handlers: Record<ApiV1Target, (request: Parameters<typeof healthz>[0], response: Parameters<typeof healthz>[1]) => unknown> = {
  healthz,
  generateApp,
  cancelGeneration,
  projectSnapshots,
  projectSnapshotFiles,
  saveFiles,
  updateSnapshot,
  restoreSnapshot,
  projectState,
  projectVariationSet,
  selectVariation,
  hlOAuthStart,
  hlConnectionStatus,
  integrationStatus,
  hlProxy,
}

/** Versioned REST façade; named Functions remain available as compatibility aliases. */
export const apiV1 = onRequest(
  // The facade dispatches the streaming generation route, so it needs the same longer ceiling.
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB', cors: false, secrets: [openAiApiKey, highLevelClientSecret] },
  async (request, response) => {
    applyCors(request, response)
    if (request.method === 'OPTIONS') return void response.status(204).end()

    const route = resolveApiV1Route(request.method, request.originalUrl || request.path)
    if (!route) {
      const allowed = allowedApiV1Methods(request.originalUrl || request.path)
      if (allowed.length) {
        response.setHeader('Allow', allowed.join(', '))
        return void response.status(405).json({ title: 'Method not allowed', status: 405 })
      }
      return void response.status(404).json({ title: 'API resource not found', status: 404 })
    }

    request.params = route.params
    if (request.method !== 'GET') request.body = { ...(request.body ?? {}), ...route.params }
    await apiV1Handlers[route.target](request, response)
  },
)
