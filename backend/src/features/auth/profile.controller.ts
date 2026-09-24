import type { Request, Response } from 'express'
import { authUserId } from '../../shared/auth/requestUser.ts'
import type { UpdateProfileInput } from './auth.schemas.ts'
import * as profileService from './profile.service.ts'

export async function me(req: Request, res: Response) {
  res.json({ user: await profileService.getMe(authUserId(req)) })
}

export async function updateMe(req: Request, res: Response) {
  const input = req.body as UpdateProfileInput
  res.json({ user: await profileService.updateProfile(authUserId(req), input) })
}
