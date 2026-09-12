import type { Request } from 'express'
import { getAuth } from 'firebase-admin/auth'

export class AuthenticationError extends Error {}

const TOKEN_ERROR_MESSAGES: Record<string, string> = {
  'auth/id-token-expired': 'Your session has expired. Sign in again to continue.',
  'auth/argument-error': 'Your session is invalid. Sign in again to continue.',
  'auth/id-token-revoked': 'Your session was revoked. Sign in again to continue.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/user-not-found': 'This account no longer exists. Sign in again to continue.',
}

export async function verifyFirebaseUser(request: Request) {
  const authorization = request.header('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    throw new AuthenticationError('Sign in to continue: no session token was sent with this request.')
  }
  const token = authorization.slice('Bearer '.length)
  try {
    return await getAuth().verifyIdToken(token)
  } catch (cause) {
    const code = (cause as { code?: string }).code
    const message = (code && TOKEN_ERROR_MESSAGES[code]) ?? 'Your session could not be verified. Sign in again to continue.'
    throw new AuthenticationError(message)
  }
}

export async function requireFirebaseUser(request: Request) {
  return verifyFirebaseUser(request)
}
