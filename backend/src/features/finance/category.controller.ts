import type { Request, Response } from 'express'
import { authUserId } from '../../shared/auth/requestUser.ts'
import * as categoryService from './category.service.ts'
import type { CategoryBody, ListCategoriesQuery } from './finance.schemas.ts'

export async function list(req: Request, res: Response) {
  const { kind } = req.query as unknown as ListCategoriesQuery
  res.json({ items: await categoryService.listCategories(authUserId(req), kind) })
}

export async function create(req: Request, res: Response) {
  res
    .status(201)
    .json(await categoryService.createCategory(authUserId(req), req.body as CategoryBody))
}

export async function rename(req: Request, res: Response) {
  const { name } = req.body as { name: string }
  res.json(await categoryService.renameCategory(authUserId(req), req.params.id as string, name))
}

export async function remove(req: Request, res: Response) {
  await categoryService.deleteCategory(authUserId(req), req.params.id as string)
  res.status(204).end()
}
