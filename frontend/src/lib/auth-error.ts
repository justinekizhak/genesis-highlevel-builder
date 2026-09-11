type AuthError = Error & { code?: string }

export function getAuthErrorMessage(cause: unknown, mode: 'sign-in' | 'sign-up') {
  const code = cause instanceof Error ? (cause as AuthError).code : undefined

  if (mode === 'sign-in') {
    if (code === 'auth/user-not-found') {
      return 'No account exists for this email. Create an account to continue.'
    }

    // Firebase uses this combined code when email-enumeration protection is enabled,
    // so it cannot safely reveal whether the email or password was incorrect.
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
      return "We couldn't find an account with those details. Create an account first, or check your email and password."
    }
  }

  return cause instanceof Error ? cause.message : 'Authentication failed.'
}
