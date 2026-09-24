import type { Request, Response } from 'express'
import { authUserId } from '../../shared/auth/requestUser.ts'
import type {
  BulkTransactionsInput,
  CreateTransactionInput,
  ListTransactionsQuery,
  UpdateTransactionInput,
} from './finance.schemas.ts'
import { bulkCreateTransactions } from './transaction.bulk.ts'
import * as transactionService from './transaction.service.ts'

export async function list(req: Request, res: Response) {
  res.json(
    await transactionService.listTransactions(
      authUserId(req),
      req.query as unknown as ListTransactionsQuery,
    ),
  )
}

export async function create(req: Request, res: Response) {
  res
    .status(201)
    .json(
      await transactionService.createTransaction(
        authUserId(req),
        req.body as CreateTransactionInput,
      ),
    )
}

export async function bulk(req: Request, res: Response) {
  res
    .status(201)
    .json(await bulkCreateTransactions(authUserId(req), req.body as BulkTransactionsInput))
}

export async function update(req: Request, res: Response) {
  res.json(
    await transactionService.updateTransaction(
      authUserId(req),
      req.params.id as string,
      req.body as UpdateTransactionInput,
    ),
  )
}

export async function remove(req: Request, res: Response) {
  await transactionService.deleteTransaction(authUserId(req), req.params.id as string)
  res.status(204).end()
}
