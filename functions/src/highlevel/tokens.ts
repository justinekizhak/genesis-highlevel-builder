import { randomUUID } from 'node:crypto'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { highLevelApiBase, highLevelApiVersion, requireHighLevelConfig } from './config.js'

type HighLevelConnection = {
  accessToken: string
  refreshToken: string
  expiresAt: Timestamp
  locationId: string
  locationName?: string
  companyId?: string
  scope?: string
  refreshLeaseId?: string
  refreshingUntil?: Timestamp
}

type TokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  locationId: string
  companyId?: string
  scope?: string
}

export async function exchangeAuthorizationCode(code: string) {
  const { clientId, clientSecret, redirectUri } = requireHighLevelConfig()
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    user_type: 'Location',
    redirect_uri: redirectUri,
  })
  const response = await fetch(`${highLevelApiBase.value()}/oauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) throw new Error(`HighLevel token exchange failed (${response.status}).`)
  return response.json() as Promise<TokenResponse>
}

export async function fetchLocationName(accessToken: string, locationId: string) {
  const response = await fetch(`${highLevelApiBase.value()}/locations/${encodeURIComponent(locationId)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      Version: highLevelApiVersion,
    },
  })
  if (!response.ok) throw new Error(`HighLevel location lookup failed (${response.status}).`)
  const body = await response.json() as { location?: { name?: string } }
  const name = body.location?.name?.trim()
  if (!name) throw new Error('HighLevel location lookup returned no name.')
  return name
}

export async function saveConnection(uid: string, tokens: TokenResponse, locationName?: string) {
  const db = getFirestore()
  await db.collection('highlevelConnections').doc(uid).set({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Timestamp.fromMillis(Date.now() + tokens.expires_in * 1_000),
    locationId: tokens.locationId,
    locationName: locationName ?? null,
    companyId: tokens.companyId ?? null,
    scope: tokens.scope ?? null,
    connectedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
}

async function refreshConnection(uid: string) {
  const db = getFirestore()
  const reference = db.collection('highlevelConnections').doc(uid)
  const leaseId = randomUUID()

  const claim = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    const connection = snapshot.data() as HighLevelConnection | undefined
    if (!connection) throw new Error('HighLevel is not connected.')
    if (connection.expiresAt.toMillis() > Date.now() + 60_000) {
      return { needsRefresh: false as const, connection }
    }
    if (connection.refreshingUntil?.toMillis() && connection.refreshingUntil.toMillis() > Date.now()) {
      throw new Error('HighLevel token refresh is already in progress. Please retry.')
    }
    transaction.update(reference, {
      refreshLeaseId: leaseId,
      refreshingUntil: Timestamp.fromMillis(Date.now() + 30_000),
    })
    return { needsRefresh: true as const, connection }
  })

  if (!claim.needsRefresh) return claim.connection
  const current = claim.connection

  const { clientId, clientSecret } = requireHighLevelConfig()
  const response = await fetch(`${highLevelApiBase.value()}/oauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      user_type: 'Location',
    }),
  })
  if (!response.ok) {
    await reference.update({ refreshLeaseId: null, refreshingUntil: null })
    throw new Error(`HighLevel token refresh failed (${response.status}).`)
  }
  const tokens = await response.json() as TokenResponse
  const updated: HighLevelConnection = {
    ...current,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Timestamp.fromMillis(Date.now() + tokens.expires_in * 1_000),
  }
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    if (snapshot.get('refreshLeaseId') !== leaseId) throw new Error('HighLevel token refresh lease was lost.')
    transaction.update(reference, {
      accessToken: updated.accessToken,
      refreshToken: updated.refreshToken,
      expiresAt: updated.expiresAt,
      refreshLeaseId: null,
      refreshingUntil: null,
      updatedAt: Timestamp.now(),
    })
  })
  return updated
}

export async function getValidConnection(uid: string) {
  const snapshot = await getFirestore().collection('highlevelConnections').doc(uid).get()
  if (!snapshot.exists) throw new Error('HighLevel is not connected.')
  const connection = snapshot.data() as HighLevelConnection
  if (connection.expiresAt.toMillis() <= Date.now() + 60_000) return refreshConnection(uid)
  return connection
}

export async function getConnectionSummary(uid: string) {
  const reference = getFirestore().collection('highlevelConnections').doc(uid)
  const snapshot = await reference.get()
  if (!snapshot.exists) return undefined
  let connection = snapshot.data() as HighLevelConnection
  connection = connection.expiresAt.toMillis() <= Date.now() + 60_000
    ? await refreshConnection(uid)
    : connection
  if (!connection.locationName) {
    const locationName = await fetchLocationName(connection.accessToken, connection.locationId)
    await reference.update({ locationName, updatedAt: Timestamp.now() })
    connection = { ...connection, locationName }
  }
  return {
    locationId: connection.locationId,
    locationName: connection.locationName,
    connectedAt: snapshot.get('connectedAt')?.toDate?.().toISOString(),
  }
}
