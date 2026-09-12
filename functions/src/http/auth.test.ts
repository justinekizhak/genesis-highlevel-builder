import { describe, expect, it, vi } from 'vitest'

function fakeRequest(header?: string) {
  return { header: (name: string) => (name.toLowerCase() === 'authorization' ? header : undefined) } as never
}

describe('requireFirebaseUser', () => {
  it('rejects a request with no Authorization header', async () => {
    const { requireFirebaseUser, AuthenticationError } = await import('./auth.js')
    await expect(requireFirebaseUser(fakeRequest())).rejects.toThrow(AuthenticationError)
    await expect(requireFirebaseUser(fakeRequest())).rejects.toThrow('no session token')
  })

  it('rejects a non-Bearer Authorization header', async () => {
    const { requireFirebaseUser, AuthenticationError } = await import('./auth.js')
    await expect(requireFirebaseUser(fakeRequest('Basic abc123'))).rejects.toThrow(AuthenticationError)
  })

  it('returns the decoded token for a verified Bearer token', async () => {
    vi.resetModules()
    vi.doMock('firebase-admin/auth', () => ({
      getAuth: () => ({ verifyIdToken: async (token: string) => ({ uid: `uid-for-${token}` }) }),
    }))
    const { requireFirebaseUser } = await import('./auth.js')
    await expect(requireFirebaseUser(fakeRequest('Bearer good-token'))).resolves.toEqual({ uid: 'uid-for-good-token' })
    vi.doUnmock('firebase-admin/auth')
  })

  it('maps a known Firebase Auth error code to a friendly message', async () => {
    vi.resetModules()
    vi.doMock('firebase-admin/auth', () => ({
      getAuth: () => ({
        verifyIdToken: async () => {
          const error = new Error('expired') as Error & { code?: string }
          error.code = 'auth/id-token-expired'
          throw error
        },
      }),
    }))
    const { requireFirebaseUser, AuthenticationError } = await import('./auth.js')
    await expect(requireFirebaseUser(fakeRequest('Bearer expired-token'))).rejects.toThrow(AuthenticationError)
    await expect(requireFirebaseUser(fakeRequest('Bearer expired-token'))).rejects.toThrow('session has expired')
    vi.doUnmock('firebase-admin/auth')
  })

  it('falls back to a generic message for an unrecognized error code', async () => {
    vi.resetModules()
    vi.doMock('firebase-admin/auth', () => ({
      getAuth: () => ({
        verifyIdToken: async () => { throw new Error('boom') },
      }),
    }))
    const { requireFirebaseUser } = await import('./auth.js')
    await expect(requireFirebaseUser(fakeRequest('Bearer bad-token'))).rejects.toThrow('could not be verified')
    vi.doUnmock('firebase-admin/auth')
  })
})
