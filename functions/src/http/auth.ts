import type { Request } from 'express'
import { getAuth } from 'firebase-admin/auth'

export class AuthenticationError extends Error {}

export async function verifyFirebaseUser(request: Request) {
  const authorization = request.header('authorization')
  if (!authorization?.startsWith('Bearer ')) return undefined
  const token = authorization.slice('Bearer '.length)
  return getAuth().verifyIdToken(token)
}

export async function requireFirebaseUser(request: Request) {
  const user = await verifyFirebaseUser(request)
  if (!user) throw new AuthenticationError('A valid Firebase ID token is required.')
  return user
}
