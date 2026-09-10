import { highLevelApiBase } from './config.js'
import { getValidConnection } from './tokens.js'

export const highLevelOperations = {
  'contacts.list': { method: 'GET', path: '/contacts/', allowedQuery: ['limit', 'startAfterId', 'query'] },
  'conversations.list': { method: 'GET', path: '/conversations/search', allowedQuery: ['limit', 'startAfterDate'] },
  'conversations.messages': { method: 'GET', path: '/conversations/:conversationId/messages', allowedQuery: ['limit', 'lastMessageId'] },
  'calendars.list': { method: 'GET', path: '/calendars/', allowedQuery: [] },
  'appointments.list': { method: 'GET', path: '/calendars/events', allowedQuery: ['calendarId', 'startTime', 'endTime'] },
} as const

export type HighLevelOperation = keyof typeof highLevelOperations

export async function executeHighLevelOperation(
  uid: string,
  operation: HighLevelOperation,
  parameters: Record<string, string | number | undefined>,
) {
  const definition = highLevelOperations[operation]
  if (!definition) throw new Error('HighLevel operation is not allowed.')
  const connection = await getValidConnection(uid)
  let path: string = definition.path
  if (path.includes(':conversationId')) {
    const conversationId = String(parameters.conversationId ?? '')
    if (!/^[A-Za-z0-9_-]+$/.test(conversationId)) throw new Error('A valid conversation ID is required.')
    path = path.replace(':conversationId', encodeURIComponent(conversationId))
  }
  const url = new URL(path, highLevelApiBase.value())
  url.searchParams.set('locationId', connection.locationId)
  for (const key of definition.allowedQuery) {
    const value = parameters[key]
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, {
    method: definition.method,
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      Accept: 'application/json',
      Version: '2021-07-28',
    },
  })
  const body = await response.json().catch(() => ({ message: 'HighLevel returned a non-JSON response.' }))
  if (!response.ok) throw new Error(`HighLevel request failed (${response.status}): ${JSON.stringify(body)}`)
  return body
}
