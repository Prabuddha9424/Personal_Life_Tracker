import type { Request, Response } from 'express'
import { authUserId } from '../../shared/auth/requestUser.ts'
import * as profileService from './profile.service.ts'

export async function me(req: Request, res: Response) {
  res.json({ user: await profileService.getMe(authUserId(req)) })
}
