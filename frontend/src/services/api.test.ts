import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireApiV1BaseUrl, requireStreamingApiV1BaseUrl } from './api'

afterEach(() => vi.unstubAllEnvs())

describe('API v1 base URLs', () => {
  it('uses the Hosting REST prefix in production', () => {
    vi.stubEnv('VITE_FUNCTIONS_BASE_URL', 'https://app.example.com/api/')
    expect(requireApiV1BaseUrl()).toBe('https://app.example.com/api/v1')
  })

  it('uses the apiV1 function name with the Functions emulator', () => {
    vi.stubEnv('VITE_FUNCTIONS_BASE_URL', 'http://127.0.0.1:5001/project/us-central1')
    vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', 'true')
    expect(requireApiV1BaseUrl()).toBe('http://127.0.0.1:5001/project/us-central1/apiV1/v1')
    expect(requireStreamingApiV1BaseUrl()).toBe('http://127.0.0.1:5001/project/us-central1/apiV1/v1')
  })

  it('bypasses Hosting for production SSE streams', () => {
    vi.stubEnv('VITE_FUNCTIONS_BASE_URL', 'https://app.example.com/api')
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-project')
    vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', 'false')
    expect(requireStreamingApiV1BaseUrl()).toBe('https://us-central1-demo-project.cloudfunctions.net/apiV1/v1')
  })
})
