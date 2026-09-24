import { Router } from 'express'
import { requireAuth } from '../../shared/middleware/requireAuth.ts'
import { validate } from '../../shared/middleware/validate.ts'
import { idParamsSchema } from '../../shared/validation/requestSchemas.ts'
import { create, get, list, remove, tags, update } from './task.controller.ts'
import { createTaskSchema, listTasksQuerySchema, updateTaskSchema } from './task.schemas.ts'

export const taskRouter = Router()

taskRouter.use(requireAuth)
taskRouter.get('/', validate({ query: listTasksQuerySchema }), list)
taskRouter.post('/', validate({ body: createTaskSchema }), create)
taskRouter.get('/tags', tags)
taskRouter.get('/:id', validate({ params: idParamsSchema }), get)
taskRouter.patch('/:id', validate({ params: idParamsSchema, body: updateTaskSchema }), update)
taskRouter.delete('/:id', validate({ params: idParamsSchema }), remove)
