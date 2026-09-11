import { highLevelApiBase, highLevelApiVersion } from './config.js'
import { getValidConnection } from './tokens.js'

type ParameterValue = string | number | boolean | string[] | undefined
export type HighLevelParameters = Record<string, ParameterValue>

type OperationDefinition = {
  method: 'GET' | 'POST' | 'PUT'
  path: string
  allowedQuery?: readonly string[]
  allowedBody?: readonly string[]
  location: 'query' | 'body' | 'none'
}

export const highLevelOperations = {
  'contacts.list': { method: 'GET', path: '/contacts/', allowedQuery: ['limit', 'startAfterId', 'query'], location: 'query' },
  'contacts.create': { method: 'POST', path: '/contacts/', allowedBody: ['firstName', 'lastName', 'name', 'email', 'phone', 'source', 'tags'], location: 'body' },
  'contacts.update': { method: 'PUT', path: '/contacts/:contactId', allowedBody: ['firstName', 'lastName', 'name', 'email', 'phone', 'source', 'tags'], location: 'none' },
  'conversations.list': { method: 'GET', path: '/conversations/search', allowedQuery: ['limit', 'startAfterDate'], location: 'query' },
  'conversations.messages': { method: 'GET', path: '/conversations/:conversationId/messages', allowedQuery: ['limit', 'lastMessageId'], location: 'none' },
  'conversations.send': { method: 'POST', path: '/conversations/messages', allowedBody: ['type', 'contactId', 'message', 'html', 'subject', 'status'], location: 'none' },
  'calendars.list': { method: 'GET', path: '/calendars/', allowedQuery: ['groupId', 'showDrafted'], location: 'query' },
  'calendars.availability': { method: 'GET', path: '/calendars/:calendarId/free-slots', allowedQuery: ['startDate', 'endDate', 'timezone', 'userId'], location: 'none' },
  'appointments.list': { method: 'GET', path: '/calendars/events', allowedQuery: ['calendarId', 'userId', 'groupId', 'startTime', 'endTime'], location: 'query' },
} as const satisfies Record<string, OperationDefinition>

export type HighLevelOperation = keyof typeof highLevelOperations

const identifierPattern = /^[A-Za-z0-9_-]{1,128}$/
const writeOperations = new Set<HighLevelOperation>(['contacts.create', 'contacts.update', 'conversations.send'])

function requireIdentifier(parameters: HighLevelParameters, key: string) {
  const value = String(parameters[key] ?? '')
  if (!identifierPattern.test(value)) throw new Error(`A valid ${key} is required.`)
  return encodeURIComponent(value)
}

export function validateHighLevelParameters(operation: HighLevelOperation, parameters: HighLevelParameters) {
  if (operation === 'calendars.availability') {
    requireIdentifier(parameters, 'calendarId')
    if (!String(parameters.startDate ?? '').trim() || !String(parameters.endDate ?? '').trim()) {
      throw new Error('Calendar availability requires startDate and endDate.')
    }
  }
  if (operation === 'appointments.list') {
    if (!String(parameters.startTime ?? '').trim() || !String(parameters.endTime ?? '').trim()) {
      throw new Error('Listing appointments requires startTime and endTime.')
    }
    if (!['calendarId', 'userId', 'groupId'].some((key) => String(parameters[key] ?? '').trim())) {
      throw new Error('Listing appointments requires a calendarId, userId, or groupId.')
    }
  }
  if (!writeOperations.has(operation)) return
  if (operation === 'contacts.create' && !['name', 'firstName', 'email', 'phone'].some((key) => String(parameters[key] ?? '').trim())) {
    throw new Error('Creating a contact requires a name, email, or phone number.')
  }
  if (operation === 'contacts.update') {
    requireIdentifier(parameters, 'contactId')
    if (!Object.keys(parameters).some((key) => key !== 'contactId' && parameters[key] !== undefined && parameters[key] !== '')) {
      throw new Error('Updating a contact requires at least one changed field.')
    }
  }
  if (operation === 'conversations.send') {
    requireIdentifier(parameters, 'contactId')
    const type = String(parameters.type ?? '')
    const status = String(parameters.status ?? '')
    if (!['SMS', 'Email', 'WhatsApp', 'IG', 'FB', 'Custom', 'Live_Chat', 'InternalComment'].includes(type)) throw new Error('A valid message type is required.')
    if (!['delivered', 'failed', 'pending', 'read'].includes(status)) throw new Error('A valid message status is required.')
    if (!String(parameters.message ?? parameters.html ?? '').trim()) throw new Error('A message body is required.')
  }
}

export async function executeHighLevelOperation(uid: string, operation: HighLevelOperation, parameters: HighLevelParameters) {
  const definition: OperationDefinition | undefined = highLevelOperations[operation]
  if (!definition) throw new Error('HighLevel operation is not allowed.')
  validateHighLevelParameters(operation, parameters)

  const pathKeys = [...definition.path.matchAll(/:([A-Za-z]+)/g)].map((match) => match[1])
  let path = definition.path
  for (const key of pathKeys) path = path.replace(`:${key}`, requireIdentifier(parameters, key))

  const permitted = new Set([...pathKeys, ...(definition.allowedQuery ?? []), ...(definition.allowedBody ?? [])])
  const unknown = Object.keys(parameters).filter((key) => !permitted.has(key))
  if (unknown.length) throw new Error(`Unsupported parameters: ${unknown.join(', ')}.`)

  const connection = await getValidConnection(uid)
  const url = new URL(path, highLevelApiBase.value())
  if (definition.location === 'query') url.searchParams.set('locationId', connection.locationId)
  for (const key of definition.allowedQuery ?? []) {
    const value = parameters[key]
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  const body: Record<string, ParameterValue> = {}
  if (definition.location === 'body') body.locationId = connection.locationId
  for (const key of definition.allowedBody ?? []) {
    const value = parameters[key]
    if (value !== undefined && value !== '') body[key] = value
  }

  const response = await fetch(url, {
    method: definition.method,
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      Accept: 'application/json',
      Version: highLevelApiVersion,
      ...(definition.allowedBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: definition.allowedBody ? JSON.stringify(body) : undefined,
  })
  const responseBody = await response.json().catch(() => ({ message: 'HighLevel returned a non-JSON response.' }))
  if (!response.ok) throw new Error(`HighLevel request failed (${response.status}): ${JSON.stringify(responseBody)}`)
  return responseBody
}
