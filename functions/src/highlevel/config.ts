import { defineSecret, defineString } from 'firebase-functions/params'

export const highLevelClientId = defineString('HL_CLIENT_ID', { default: '' })
export const highLevelClientSecret = defineSecret('HL_CLIENT_SECRET')
export const highLevelRedirectUri = defineString('HL_REDIRECT_URI', { default: '' })
export const highLevelApiBase = defineString('HL_API_BASE', { default: 'https://services.leadconnectorhq.com' })
export const applicationBaseUrl = defineString('APP_BASE_URL', { default: 'http://localhost:5173' })

export const highLevelScopes = [
  'contacts.readonly',
  'contacts.write',
  'conversations.readonly',
  'conversations/message.readonly',
  'conversations/message.write',
  'calendars.readonly',
  'calendars/events.readonly',
  'locations.readonly',
].join(' ')

export const highLevelApiVersion = 'v3'

export function requireHighLevelConfig() {
  const clientId = highLevelClientId.value()
  const clientSecret = highLevelClientSecret.value()
  const redirectUri = highLevelRedirectUri.value()
  if (!clientId || !clientSecret || !redirectUri) throw new Error('HighLevel OAuth is not configured.')
  return { clientId, clientSecret, redirectUri }
}
