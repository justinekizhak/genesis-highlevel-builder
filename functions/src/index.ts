import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { onRequest } from 'firebase-functions/v2/https'
import { z } from 'zod'
import { buildMockEvents } from './generate/mock-events.js'
import {
  applicationBaseUrl,
  highLevelClientId,
  highLevelClientSecret,
  highLevelRedirectUri,
  highLevelScopes,
} from './highlevel/config.js'
import { executeHighLevelOperation, highLevelOperations, type HighLevelOperation } from './highlevel/proxy.js'
import { exchangeAuthorizationCode, saveConnection } from './highlevel/tokens.js'
import { AuthenticationError, requireFirebaseUser } from './http/auth.js'
import { applyCors } from './http/cors.js'
import { serializeSse } from './shared/protocol.js'

initializeApp()

const generateRequestSchema = z.object({
  prompt: z.string().trim().min(3).max(4_000),
  projectId: z.string().trim().min(1).max(128),
})

const proxyRequestSchema = z.object({
  operation: z.enum(Object.keys(highLevelOperations) as [HighLevelOperation, ...HighLevelOperation[]]),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.undefined()])).default({}),
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
      await saveConnection(uid, tokens)
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

export const hlConnectionStatus = onRequest({ region: 'us-central1', cors: false }, async (request, response) => {
  applyCors(request, response)
  if (request.method === 'OPTIONS') return void response.status(204).end()
  if (request.method !== 'GET') return void response.status(405).json({ error: 'Method not allowed' })
  try {
    const user = await requireFirebaseUser(request)
    const snapshot = await getFirestore().collection('highlevelConnections').doc(user.uid).get()
    if (!snapshot.exists) return void response.json({ connected: false })
    response.json({
      connected: true,
      locationId: snapshot.get('locationId'),
      locationName: snapshot.get('locationName') ?? 'Connected location',
      connectedAt: snapshot.get('connectedAt')?.toDate?.().toISOString(),
    })
  } catch (cause) {
    httpError(response, cause)
  }
})

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
