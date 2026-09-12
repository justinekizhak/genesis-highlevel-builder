import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function fakeRequest(origin?: string) {
  return { header: (name: string) => (name.toLowerCase() === 'origin' ? origin : undefined) } as never
}

function fakeResponse() {
  const headers: Record<string, string> = {}
  return { setHeader: vi.fn((key: string, value: string) => { headers[key] = value }), headers } as never
}

describe('applyCors', () => {
  const originalEnv = process.env.APP_ORIGINS

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env.APP_ORIGINS = originalEnv
  })

  it('allows a configured origin', async () => {
    process.env.APP_ORIGINS = 'https://app.example.com,http://localhost:5173'
    const { applyCors } = await import('./cors.js')
    const response = fakeResponse() as { headers: Record<string, string> }
    applyCors(fakeRequest('https://app.example.com'), response as never)
    expect(response.headers['Access-Control-Allow-Origin']).toBe('https://app.example.com')
    expect(response.headers.Vary).toBe('Origin')
  })

  it('does not echo back an unconfigured origin', async () => {
    process.env.APP_ORIGINS = 'https://app.example.com'
    const { applyCors } = await import('./cors.js')
    const response = fakeResponse() as { headers: Record<string, string> }
    applyCors(fakeRequest('https://evil.example.com'), response as never)
    expect(response.headers['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('always sets the allowed headers and methods', async () => {
    process.env.APP_ORIGINS = 'https://app.example.com'
    const { applyCors } = await import('./cors.js')
    const response = fakeResponse() as { headers: Record<string, string> }
    applyCors(fakeRequest(undefined), response as never)
    expect(response.headers['Access-Control-Allow-Headers']).toBe('Authorization, Content-Type')
    expect(response.headers['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS')
  })
})
