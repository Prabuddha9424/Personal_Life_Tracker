import type { Response } from 'express'
import { setRefreshCookie } from './cookies.ts'
import type { Session } from './session.service.ts'

/** Sets the refresh cookie and sends the access token. The refresh token never appears in the body. */
export function sendSession(res: Response, session: Session, status = 200): void {
  setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt)
  res.status(status).json({ accessToken: session.accessToken, user: session.user })
}
