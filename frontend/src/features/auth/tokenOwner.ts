/**
 * The user id (`sub`) inside the bearer token a request was sent with, or null when the header
 * is not a token this app issued. The token is NOT verified here (the server does that); the
 * answer only decides whether a request that got a 401 may be sent again, so an unreadable or
 * forged token simply means "do not resend".
 */
export function tokenOwnerId(authorization: string): string | null {
  const [scheme, token] = authorization.split(' ')
  const payload = scheme === 'Bearer' ? token?.split('.')[1] : undefined
  if (!payload) return null
  try {
    const base64 = payload.replaceAll('-', '+').replaceAll('_', '/')
    const json = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    const claims: unknown = JSON.parse(json)
    if (typeof claims !== 'object' || claims === null || !('sub' in claims)) return null
    return typeof claims.sub === 'string' && claims.sub !== '' ? claims.sub : null
  } catch {
    return null
  }
}
