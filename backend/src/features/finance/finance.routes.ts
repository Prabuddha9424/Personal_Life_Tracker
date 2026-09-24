import { Router } from 'express'
import { requireAuth } from '../../shared/middleware/requireAuth.ts'
import { categoryRouter } from './category.routes.ts'
import { transactionRouter } from './transaction.routes.ts'

/**
 * Mounted at /api. requireAuth is attached per path, never with router.use('/'), so it cannot
 * intercept other slices' routes such as /api/auth/login.
 */
export const financeRouter = Router()

financeRouter.use('/categories', requireAuth, categoryRouter)
financeRouter.use('/transactions', requireAuth, transactionRouter)
