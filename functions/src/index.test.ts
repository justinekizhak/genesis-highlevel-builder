import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadProjectState = vi.fn()

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }))
vi.mock('firebase-functions/v2/https', () => ({
  onRequest: (_options: unknown, handler: unknown) => handler,
}))
vi.mock('./http/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./http/auth.js')>()
  return { ...actual, requireFirebaseUser: vi.fn().mockResolvedValue({ uid: 'user-1' }) }
})
vi.mock('./generate/persistence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./generate/persistence.js')>()
  return { ...actual, loadProjectState }
})

describe('API v1 request dispatch', () => {
  beforeEach(() => {
    loadProjectState.mockReset()
    loadProjectState.mockResolvedValue({ files: null, messages: [] })
  })

  it('passes a project ID from the application resource path to the project-state handler', async () => {
    const { apiV1 } = await import('./index.js')
    const request = {
      method: 'GET',
      originalUrl: '/api/v1/projects/project%201/application',
      path: '/api/v1/projects/project%201/application',
      params: {},
      get query() {
        return {}
      },
      header: vi.fn(),
    }
    const response = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      end: vi.fn(),
    }

    await apiV1(request as never, response as never)

    expect(loadProjectState).toHaveBeenCalledWith('user-1', 'project 1')
    expect(response.json).toHaveBeenCalledWith({ files: null, messages: [] })
  })
})
