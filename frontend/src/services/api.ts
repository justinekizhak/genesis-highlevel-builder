function requireConfiguredFunctionsBase() {
  const base = import.meta.env.VITE_FUNCTIONS_BASE_URL?.replace(/\/$/, '')
  if (!base) throw new Error('Firebase Functions are not configured. Set VITE_FUNCTIONS_BASE_URL.')
  return base
}

/**
 * Hosting exposes `/api/v1`; direct Functions and the emulator expose the `apiV1` function name.
 * An explicit URL remains available for unusual proxy/deployment layouts.
 */
export function requireApiV1BaseUrl() {
  const override = import.meta.env.VITE_API_V1_BASE_URL?.replace(/\/$/, '')
  if (override) return override
  const base = requireConfiguredFunctionsBase()
  return base.endsWith('/api') ? `${base}/v1` : `${base}/apiV1/v1`
}

export function requireStreamingApiV1BaseUrl() {
  const override = import.meta.env.VITE_FUNCTIONS_STREAM_BASE_URL?.replace(/\/$/, '')
  if (override) return `${override}/apiV1/v1`
  if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') return requireApiV1BaseUrl()
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
  if (!projectId) return requireApiV1BaseUrl()
  return `https://us-central1-${projectId}.cloudfunctions.net/apiV1/v1`
}
