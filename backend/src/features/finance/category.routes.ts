import { Router } from 'express'
import { validate } from '../../shared/middleware/validate.ts'
import { idParamsSchema } from '../../shared/validation/requestSchemas.ts'
import { create, list, remove, rename } from './category.controller.ts'
import {
  categoryBodySchema,
  listCategoriesQuerySchema,
  renameCategorySchema,
} from './finance.schemas.ts'

export const categoryRouter = Router()

categoryRouter.get('/', validate({ query: listCategoriesQuerySchema }), list)
categoryRouter.post('/', validate({ body: categoryBodySchema }), create)
categoryRouter.patch(
  '/:id',
  validate({ params: idParamsSchema, body: renameCategorySchema }),
  rename,
)
categoryRouter.delete('/:id', validate({ params: idParamsSchema }), remove)
