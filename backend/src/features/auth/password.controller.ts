import type { Request, Response } from 'express'
import { authUserId } from '../../shared/auth/requestUser.ts'
import type { ChangePasswordInput } from './auth.schemas.ts'
import * as passwordService from './password.service.ts'
import { sendSession } from './session-response.ts'

export async function forgotPassword(req: Request, res: Response) {
  await passwordService.forgotPassword((req.body as { email: string }).email)
  res
    .status(202)
    .json({ message: 'If an account exists for that email, a reset link is on its way.' })
}

export async function resetPassword(req: Request, res: Response) {
  const { token, password } = req.body as { token: string; password: string }
  await passwordService.resetPassword(token, password)
  res.json({ message: 'Your password has been changed. You can log in now.' })
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = req.body as ChangePasswordInput
  sendSession(
    res,
    await passwordService.changePassword(authUserId(req), currentPassword, newPassword),
  )
}
