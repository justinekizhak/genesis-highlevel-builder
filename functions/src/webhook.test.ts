import { generateKeyPairSync, sign } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyHighLevelSignature } from './webhook.js'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

function signBody(body: string) {
  return sign(null, Buffer.from(body), privateKey).toString('base64')
}

describe('verifyHighLevelSignature', () => {
  it('accepts a correctly signed body', () => {
    const body = Buffer.from(JSON.stringify({ type: 'ContactCreate' }))
    expect(verifyHighLevelSignature(body, signBody(body.toString()), publicKeyPem)).toBe(true)
  })

  it('rejects a tampered body', () => {
    const original = JSON.stringify({ type: 'ContactCreate' })
    const signature = signBody(original)
    const tampered = Buffer.from(JSON.stringify({ type: 'ContactDelete' }))
    expect(verifyHighLevelSignature(tampered, signature, publicKeyPem)).toBe(false)
  })

  it('rejects a missing signature', () => {
    const body = Buffer.from('{}')
    expect(verifyHighLevelSignature(body, '', publicKeyPem)).toBe(false)
  })

  it('rejects when no public key is configured (offline/emulator profile)', () => {
    const body = Buffer.from('{}')
    expect(verifyHighLevelSignature(body, signBody('{}'), '')).toBe(false)
  })

  it('rejects garbage signatures without throwing', () => {
    const body = Buffer.from('{}')
    expect(verifyHighLevelSignature(body, 'not-base64-signature!!', publicKeyPem)).toBe(false)
  })
})

describe('handleHighLevelWebhookPayload', () => {
  type FakeDb = {
    highlevelConnections: Map<string, { locationId: string }>
    webhookDedupe: Set<string>
    events: Array<{ uid: string; doc: Record<string, unknown> }>
    deletedConnections: string[]
  }

  function makeFakeFirestore(): { firestore: unknown; db: FakeDb } {
    const db: FakeDb = {
      highlevelConnections: new Map([['user-1', { locationId: 'location-1' }]]),
      webhookDedupe: new Set(),
      events: [],
      deletedConnections: [],
    }
    const firestore = {
      collection: (name: string) => {
        if (name === 'webhookDedupe') {
          return {
            doc: (id: string) => ({
              create: async () => {
                if (db.webhookDedupe.has(id)) {
                  const error = new Error('ALREADY_EXISTS') as Error & { code?: number }
                  error.code = 6
                  throw error
                }
                db.webhookDedupe.add(id)
              },
            }),
          }
        }
        if (name === 'highlevelConnections') {
          return {
            where: (field: string, _op: string, value: string) => ({
              limit: () => ({
                get: async () => ({
                  docs: [...db.highlevelConnections.entries()]
                    .filter(([, connection]) => field === 'locationId' && connection.locationId === value)
                    .map(([id]) => ({ id })),
                }),
              }),
            }),
            doc: (id: string) => ({
              delete: async () => { db.deletedConnections.push(id) },
            }),
          }
        }
        if (name === 'users') {
          return {
            doc: (uid: string) => ({
              collection: (sub: string) => {
                if (sub !== 'hlEvents') throw new Error(`unexpected subcollection ${sub}`)
                return { add: async (doc: Record<string, unknown>) => { db.events.push({ uid, doc }) } }
              },
            }),
          }
        }
        throw new Error(`unexpected collection ${name}`)
      },
    }
    return { firestore, db }
  }

  beforeEach(() => {
    vi.resetModules()
  })

  async function withFakeFirestore<T>(run: (mod: typeof import('./webhook.js'), db: FakeDb) => Promise<T>) {
    const { firestore, db } = makeFakeFirestore()
    vi.doMock('firebase-admin/firestore', async () => {
      const actual = await vi.importActual<typeof import('firebase-admin/firestore')>('firebase-admin/firestore')
      return { ...actual, getFirestore: () => firestore }
    })
    const mod = await import('./webhook.js')
    const result = await run(mod, db)
    vi.doUnmock('firebase-admin/firestore')
    return result
  }

  it('delivers a relevant event to the owning user and dedupes replays', async () => {
    await withFakeFirestore(async (mod, db) => {
      const body = JSON.stringify({ type: 'ContactCreate', webhookId: 'wh-1', locationId: 'location-1' })
      const signature = signBody(body)
      const payload = mod.webhookPayloadSchema.parse(JSON.parse(body))

      const first = await mod.handleHighLevelWebhookPayload(Buffer.from(body), signature, publicKeyPem, payload)
      expect(first).toBe('delivered')
      expect(db.events).toHaveLength(1)
      expect(db.events[0]?.uid).toBe('user-1')

      const replay = await mod.handleHighLevelWebhookPayload(Buffer.from(body), signature, publicKeyPem, payload)
      expect(replay).toBe('duplicate')
      expect(db.events).toHaveLength(1)
    })
  })

  it('rejects a bad signature before touching Firestore', async () => {
    await withFakeFirestore(async (mod, db) => {
      const body = JSON.stringify({ type: 'ContactCreate', webhookId: 'wh-2', locationId: 'location-1' })
      const payload = mod.webhookPayloadSchema.parse(JSON.parse(body))
      const outcome = await mod.handleHighLevelWebhookPayload(Buffer.from(body), 'forged-signature', publicKeyPem, payload)
      expect(outcome).toBe('invalid_signature')
      expect(db.events).toHaveLength(0)
    })
  })

  it('purges the stored connection on UNINSTALL', async () => {
    await withFakeFirestore(async (mod, db) => {
      const body = JSON.stringify({ type: 'UNINSTALL', webhookId: 'wh-3', locationId: 'location-1' })
      const signature = signBody(body)
      const payload = mod.webhookPayloadSchema.parse(JSON.parse(body))
      const outcome = await mod.handleHighLevelWebhookPayload(Buffer.from(body), signature, publicKeyPem, payload)
      expect(outcome).toBe('delivered')
      expect(db.deletedConnections).toEqual(['user-1'])
    })
  })

  it('reports no_owner for an unrecognized locationId', async () => {
    await withFakeFirestore(async (mod) => {
      const body = JSON.stringify({ type: 'ContactCreate', webhookId: 'wh-4', locationId: 'unknown-location' })
      const signature = signBody(body)
      const payload = mod.webhookPayloadSchema.parse(JSON.parse(body))
      const outcome = await mod.handleHighLevelWebhookPayload(Buffer.from(body), signature, publicKeyPem, payload)
      expect(outcome).toBe('no_owner')
    })
  })

  it('ignores event types outside the relevant set', async () => {
    await withFakeFirestore(async (mod, db) => {
      const body = JSON.stringify({ type: 'SomethingElse', webhookId: 'wh-5', locationId: 'location-1' })
      const signature = signBody(body)
      const payload = mod.webhookPayloadSchema.parse(JSON.parse(body))
      const outcome = await mod.handleHighLevelWebhookPayload(Buffer.from(body), signature, publicKeyPem, payload)
      expect(outcome).toBe('ignored')
      expect(db.events).toHaveLength(0)
    })
  })
})
