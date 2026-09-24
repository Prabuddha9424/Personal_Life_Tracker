import type { Request, Response } from 'express'
import type { RegisterInput } from './auth.schemas.ts'
import * as registrationService from './registration.service.ts'

const CHECK_INBOX = 'Check your inbox for a message with the next steps.'

export async function register(req: Request, res: Response) {
  await registrationService.register(req.body as RegisterInput)
  res.status(202).json({ message: CHECK_INBOX })
}

export async function verifyEmail(req: Request, res: Response) {
  await registrationService.verifyEmail((req.body as { token: string }).token)
  res.json({ message: 'Your email is verified. You can log in now.' })
}

export async function resendVerification(req: Request, res: Response) {
  await registrationService.resendVerification((req.body as { email: string }).email)
  res.status(202).json({ message: CHECK_INBOX })
}
