import { Router } from 'express'
import { validate } from '../../shared/middleware/validate.ts'
import { monthQuerySchema, rangeQuerySchema } from './finance.schemas.ts'
import { byCategory, monthly, summary, trend } from './report.controller.ts'

export const reportRouter = Router()

reportRouter.get('/summary', validate({ query: monthQuerySchema }), summary)
reportRouter.get('/by-category', validate({ query: monthQuerySchema }), byCategory)
reportRouter.get('/monthly', validate({ query: rangeQuerySchema }), monthly)
reportRouter.get('/trend', validate({ query: rangeQuerySchema }), trend)
