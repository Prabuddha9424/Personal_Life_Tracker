import type { Request, Response } from 'express'
import type { LoginInput } from './auth.schemas.ts'
import { clearRefreshCookie, readRefreshCookie } from './cookies.ts'
import { sendSession } from './session-response.ts'
import * as sessionService from './session.service.ts'

export async function login(req: Request, res: Response) {
  const { email, password } = req.body as LoginInput
  sendSession(res, await sessionService.login(email, password))
}

export async function refresh(req: Request, res: Response) {
  sendSession(res, await sessionService.refreshSession(readRefreshCookie(req)))
}

export async function logout(req: Request, res: Response) {
  await sessionService.logout(readRefreshCookie(req))
  clearRefreshCookie(res)
  res.status(204).end()
}
