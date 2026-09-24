import type { CookieOptions, Request, Response } from 'express'
import { isProduction } from '../../shared/config/env.ts'

export const REFRESH_COOKIE = 'refresh_token'

const baseOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/api/auth',
}

/** Minimal Cookie header parser. cookie-parser is not in the approved stack. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    const name = part.slice(0, separator).trim()
    if (!name) continue
    const value = part.slice(separator + 1).trim()
    try {
      cookies[name] = decodeURIComponent(value)
    } catch {
      cookies[name] = value
    }
  }
  return cookies
}

export function readRefreshCookie(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[REFRESH_COOKIE]
}

export function setRefreshCookie(res: Response, token: string, expires: Date): void {
  res.cookie(REFRESH_COOKIE, token, { ...baseOptions, expires })
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions)
}
