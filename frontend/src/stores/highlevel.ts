import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { firebaseEnabled } from '@/services/firebase'
import type { HighLevelOperation, HighLevelParameters } from '@/types/highlevel'
import { useAuthStore } from './auth'

type ConnectionStatus = {
  connected: boolean
  locationId?: string
  locationName?: string
  connectedAt?: string
}

type ModelStatus = {
  configured: boolean
  model: string
}

type IntegrationStatus = {
  highLevel: ConnectionStatus
  llm: ModelStatus
}

export const useHighLevelStore = defineStore('highlevel', () => {
  const connection = ref<ConnectionStatus>({ connected: false })
  const llm = ref<ModelStatus>({ configured: false, model: 'gpt-5.4-mini' })
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
      const status = await request('integrationStatus') as IntegrationStatus
      connection.value = status.highLevel
      llm.value = status.llm
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

  async function execute(operation: HighLevelOperation, parameters: HighLevelParameters = {}) {
    const result = await request('hlProxy', {
      method: 'POST',
      body: JSON.stringify({ operation, parameters }),
    }) as { data: unknown }
    return result.data
  }

  return { connection, llm, loading, error, canConnect, loadStatus, connect, execute }
})
