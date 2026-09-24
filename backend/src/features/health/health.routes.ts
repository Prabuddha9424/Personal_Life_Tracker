import { Router } from 'express'
import { isDatabaseConnected } from '../../shared/db/connect.ts'

export const healthRouter = Router()

healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', database: isDatabaseConnected() ? 'up' : 'down' })
})
