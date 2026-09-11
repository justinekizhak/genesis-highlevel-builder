import { describe, expect, it } from 'vitest'
import { getAuthErrorMessage } from './auth-error'

function authError(code: string) {
  return Object.assign(new Error('Firebase: Error (auth/internal-error).'), { code })
}

describe('getAuthErrorMessage', () => {
  it('directs users without an account to sign up', () => {
    expect(getAuthErrorMessage(authError('auth/user-not-found'), 'sign-in'))
      .toBe('No account exists for this email. Create an account to continue.')
  })

  it('gives actionable guidance for privacy-preserving invalid credentials', () => {
    expect(getAuthErrorMessage(authError('auth/invalid-credential'), 'sign-in'))
      .toBe("We couldn't find an account with those details. Create an account first, or check your email and password.")
  })

  it('keeps unrelated errors unchanged', () => {
    expect(getAuthErrorMessage(new Error('Network unavailable.'), 'sign-in'))
      .toBe('Network unavailable.')
  })
})
