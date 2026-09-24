import type { Request, Response } from 'express'
import { authUserId } from '../../shared/auth/requestUser.ts'
import { moveTask } from './task.move.ts'
import type {
  CreateTaskInput,
  ListTasksQuery,
  MoveTaskInput,
  UpdateTaskInput,
} from './task.schemas.ts'
import * as taskService from './task.service.ts'

export async function list(req: Request, res: Response) {
  res.json(await taskService.listTasks(authUserId(req), req.query as unknown as ListTasksQuery))
}

export async function tags(req: Request, res: Response) {
  res.json({ tags: await taskService.listTags(authUserId(req)) })
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await taskService.createTask(authUserId(req), req.body as CreateTaskInput))
}

export async function get(req: Request, res: Response) {
  res.json(await taskService.getTask(authUserId(req), req.params.id as string))
}

export async function update(req: Request, res: Response) {
  res.json(
    await taskService.updateTask(
      authUserId(req),
      req.params.id as string,
      req.body as UpdateTaskInput,
    ),
  )
}

export async function remove(req: Request, res: Response) {
  await taskService.deleteTask(authUserId(req), req.params.id as string)
  res.status(204).end()
}

export async function move(req: Request, res: Response) {
  res.json(await moveTask(authUserId(req), req.params.id as string, req.body as MoveTaskInput))
}
