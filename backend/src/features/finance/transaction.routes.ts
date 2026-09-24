import { Router } from 'express'
import { validate } from '../../shared/middleware/validate.ts'
import { idParamsSchema } from '../../shared/validation/requestSchemas.ts'
import {
  createTransactionSchema,
  listTransactionsQuerySchema,
  updateTransactionSchema,
} from './finance.schemas.ts'
import { create, list, remove, update } from './transaction.controller.ts'

export const transactionRouter = Router()

transactionRouter.get('/', validate({ query: listTransactionsQuerySchema }), list)
transactionRouter.post('/', validate({ body: createTransactionSchema }), create)
transactionRouter.patch(
  '/:id',
  validate({ params: idParamsSchema, body: updateTransactionSchema }),
  update,
)
transactionRouter.delete('/:id', validate({ params: idParamsSchema }), remove)
