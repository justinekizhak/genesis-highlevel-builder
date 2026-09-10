import type { Request } from 'express'
import { getAuth } from 'firebase-admin/auth'

export async function verifyFirebaseUser(request: Request) {
  const authorization = request.header('authorization')
  if (!authorization?.startsWith('Bearer ')) return undefined
  const token = authorization.slice('Bearer '.length)
  return getAuth().verifyIdToken(token)
}
