import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { firebaseEnabled } from '@/services/firebase'
import { useAuthStore } from './auth'

type ConnectionStatus = {
  connected: boolean
  locationId?: string
  locationName?: string
  connectedAt?: string
}

export const useHighLevelStore = defineStore('highlevel', () => {
  const connection = ref<ConnectionStatus>({ connected: false })
  const loading = ref(false)
  const error = ref('')
  const functionsBase = import.meta.env.VITE_FUNCTIONS_BASE_URL?.replace(/\/$/, '')
  const canConnect = computed(() => firebaseEnabled && Boolean(functionsBase))

  async function request(path: string, init?: RequestInit) {
    const auth = useAuthStore()
    const token = await auth.getIdToken()
    if (!token || !functionsBase) throw new Error('Firebase and the Functions base URL must be configured first.')
    const response = await fetch(`${functionsBase}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`)
    return body
  }

  async function loadStatus() {
    if (!canConnect.value) return
    loading.value = true
    error.value = ''
    try {
      connection.value = await request('hlConnectionStatus') as ConnectionStatus
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not check the HighLevel connection.'
    } finally {
      loading.value = false
    }
  }

  async function connect() {
    loading.value = true
    error.value = ''
    try {
      const result = await request('hlOAuthStart', { method: 'POST', body: '{}' }) as { authorizationUrl: string }
      window.location.assign(result.authorizationUrl)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not start HighLevel OAuth.'
      loading.value = false
    }
  }

  return { connection, loading, error, canConnect, loadStatus, connect }
})
