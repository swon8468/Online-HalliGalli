/**
 * Extract a useful message from browser Errors and Supabase/PostgREST errors.
 * Supabase errors are often plain objects, so String(error) would expose the
 * unhelpful text "[object Object]" to the user.
 */
export function getErrorMessage(error: unknown, fallback = '') {
  if (error instanceof Error && error.message.trim()) return error.message

  if (error && typeof error === 'object' && 'message' in error) {
    const message = String(error.message ?? '').trim()
    if (message && message !== '[object Object]') return message
  }

  if (typeof error === 'string' && error.trim()) return error
  return fallback
}
