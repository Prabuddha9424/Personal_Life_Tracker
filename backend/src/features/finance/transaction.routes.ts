import { Router } from 'express'
import { validate } from '../../shared/middleware/validate.ts'
import { idParamsSchema } from '../../shared/validation/requestSchemas.ts'
import {
  bulkTransactionsSchema,
  createTransactionSchema,
  listTransactionsQuerySchema,
  updateTransactionSchema,
} from './finance.schemas.ts'
import { bulk, create, list, remove, update } from './transaction.controller.ts'

export const transactionRouter = Router()

transactionRouter.get('/', validate({ query: listTransactionsQuerySchema }), list)
transactionRouter.post('/', validate({ body: createTransactionSchema }), create)
transactionRouter.post('/bulk', validate({ body: bulkTransactionsSchema }), bulk)
transactionRouter.patch(
  '/:id',
  validate({ params: idParamsSchema, body: updateTransactionSchema }),
  update,
)
transactionRouter.delete('/:id', validate({ params: idParamsSchema }), remove)
