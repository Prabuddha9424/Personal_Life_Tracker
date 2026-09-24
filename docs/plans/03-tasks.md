# M2 Tasks (Kanban) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read [`00-overview.md`](./00-overview.md) first. M0 and M1 must be merged.

**Goal:** A Kanban board with three fixed columns (To Do, In Progress, Done), drag-and-drop between and within columns, and tasks with title, description, priority, due date and tags, with tag filter and title search.

**Architecture:** Backend slice `features/tasks` (model, schemas, service, an ordering module, one router) exposing `taskRouter`, `exportTasksForUser` and `deleteTasksForUser`. Ordering uses a numeric `position` per task; a move sends the ids of the cards that will sit above and below, and the server picks the midpoint (rebalancing the column when the gap gets too small). Frontend slice `features/tasks`: one infinite query per column, optimistic drag with rollback, a form modal, filters.

**Tech Stack:** Express 5, Mongoose 9, Zod 4; React 19, TanStack Query (infinite queries), `@hello-pangea/dnd`, React Hook Form + Zod.

**Spec:** [`../PRD.md`](../PRD.md) TASK-1 to TASK-8, DASH-1 (the `useDueSoonTasks` hook), NFR-1, NFR-6.

## Global Constraints

- Every task query includes `userId` from `authUserId(req)`. Look up by `{ _id, userId }`. Never trust a `userId` in the body.
- Index `{ userId, status, position }`, `{ userId, dueDate }`, `{ userId, tags }`.
- Validate body, params and query with Zod through `validate`. Errors are `{ message }`.
- Paginate the list endpoint (`page`, `limit` default 50, max 200); use `.lean()` for reads.
- Dates: `dueDate` is `YYYY-MM-DD` on the wire and UTC midnight in Mongo. Tags: trimmed, lower-cased, at most 10 per task, at most 30 characters each.
- New tasks go to the top of their column. Delete asks for confirmation. Drag is keyboard-operable (provided by `@hello-pangea/dnd`).
- Every data view has loading, empty and error states. Feature pages are lazy-loaded with route-level `lazy`. Query keys live in the slice (`taskKeys`) and are invalidated after mutations.
- Work on branch `feature/tasks-board`. Every commit ends with `-m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"`. Lint, typecheck and tests must pass before each commit.

## Review Focus

1. **Drag while another tab changed the board.** A move whose neighbour was deleted, sits in a different column, is the moved card itself, or is in the wrong order must fail cleanly (`409` or `400`) and the board must refetch. [Tasks 3 and 7 tests]
2. **Tight positions.** Two cards squeezed to a gap below `1e-6`, and two cards with identical positions, must still allow a move and end in the right order (column rebalance). [Task 2 and 3 tests]
3. **Search text with regex characters.** `a.b`, `(`, `[` and `*` must be matched literally, never crash the query or match extra tasks. [Task 3 test]
4. **Tag hygiene.** `' Home '`, `'HOME'` and `'home'` are one tag; 11 tags or a 31-character tag is rejected. [Task 3 tests]
5. **Cross-tenant access.** Reading, changing, deleting or moving another user's task, or using it as a drop neighbour, must look like it does not exist. [Task 5 tests]

---

## Part A: Backend

### Task 1: Ordering logic

**Files:**
- Create: `backend/src/features/tasks/task.ordering.ts`, `task.ordering.test.ts`

**Interfaces:**
- Produces: `POSITION_STEP = 1024`, `MIN_GAP = 1e-6`, `positionBetween(above: number | undefined, below: number | undefined): number | null` (`above` is the position of the card that will sit above, `below` of the card that will sit below; returns `null` when both are given and the gap is too small to split).

- [ ] **Step 0: Create the branch**

```bash
git switch main && git switch -c feature/tasks-board
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { MIN_GAP, POSITION_STEP, positionBetween } from './task.ordering.ts'

describe('positionBetween', () => {
  it('starts an empty column at 0', () => {
    expect(positionBetween(undefined, undefined)).toBe(0)
  })

  it('goes one step above the first card when dropped at the top', () => {
    expect(positionBetween(undefined, 10)).toBe(10 - POSITION_STEP)
  })

  it('goes one step below the last card when dropped at the bottom', () => {
    expect(positionBetween(10, undefined)).toBe(10 + POSITION_STEP)
  })

  it('takes the midpoint between two cards', () => {
    expect(positionBetween(0, 1024)).toBe(512)
    expect(positionBetween(-1024, 0)).toBe(-512)
  })

  it('asks for a rebalance when the gap is too small to split', () => {
    expect(positionBetween(1, 1 + MIN_GAP / 2)).toBeNull()
    expect(positionBetween(5, 5)).toBeNull()
  })

  it('still splits a gap that is just large enough', () => {
    const position = positionBetween(0, MIN_GAP * 4)

    expect(position).not.toBeNull()
    expect(position).toBeGreaterThan(0)
    expect(position).toBeLessThan(MIN_GAP * 4)
  })
})
```

Run: `cd backend && npx vitest run src/features/tasks/task.ordering.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement**

```ts
/** Distance between cards when a column is (re)numbered, and the offset for top and bottom drops. */
export const POSITION_STEP = 1024

/** Below this gap two positions can no longer be split reliably as floating-point numbers. */
export const MIN_GAP = 1e-6

/**
 * The position for a card dropped between `above` and `below` (either may be missing when the
 * card goes to the top, the bottom, or an empty column). `position` is an ordering key, not money.
 * Returns null when both neighbours are given but too close to split: the caller renumbers the
 * column and tries again.
 */
export function positionBetween(above: number | undefined, below: number | undefined): number | null {
  if (above === undefined && below === undefined) return 0
  if (above === undefined) return (below ?? 0) - POSITION_STEP
  if (below === undefined) return above + POSITION_STEP
  if (below - above < MIN_GAP) return null
  return (above + below) / 2
}
```

Run → PASS.

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(tasks): add card ordering logic" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Task model, schemas, DTO and helpers

**Files:**
- Create: `backend/src/features/tasks/task.model.ts`, `task.schemas.ts`, `task.dto.ts`, `task.test-helpers.ts`

**Interfaces:**
- Consumes: shared `calendarDateSchema`, `objectIdSchema`, `paginationQuerySchema`.
- Produces: `Task` model, `TASK_STATUSES`, `TASK_PRIORITIES`, `type TaskStatus`, `type TaskPriority`, `type TaskAttrs`, `type TaskRecord` (lean shape with `_id`, `createdAt`, `updatedAt`); schemas `createTaskSchema`, `updateTaskSchema`, `moveTaskSchema`, `listTasksQuerySchema` and inferred types `CreateTaskInput`, `UpdateTaskInput`, `MoveTaskInput`, `ListTasksQuery`; `TaskDto` and `toTaskDto(record: TaskRecord): TaskDto`; test helper `insertTask(userId: string, overrides?): Promise<TaskRecord>`.

(No behaviour to test in isolation here: the schemas are exercised through the API in Task 3. This task exists so the next two can stay focused.)

- [ ] **Step 1: Write the model**

`backend/src/features/tasks/task.model.ts`:

```ts
import { model, Schema, type Types } from 'mongoose'

export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export interface TaskAttrs {
  userId: Types.ObjectId
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  /** UTC midnight of the due calendar day. */
  dueDate?: Date
  tags: string[]
  /** Ordering key inside a column, ascending. Not money. */
  position: number
}

/** What `.lean()` and `.toObject()` return: the attributes plus id and timestamps. */
export type TaskRecord = TaskAttrs & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date }

const taskSchema = new Schema<TaskAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 5000 },
    status: { type: String, enum: TASK_STATUSES, default: 'todo', required: true },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'medium', required: true },
    dueDate: { type: Date },
    tags: { type: [String], default: [] },
    position: { type: Number, required: true },
  },
  { timestamps: true },
)

taskSchema.index({ userId: 1, status: 1, position: 1 })
taskSchema.index({ userId: 1, dueDate: 1 })
taskSchema.index({ userId: 1, tags: 1 })

export const Task = model<TaskAttrs>('Task', taskSchema)
```

- [ ] **Step 2: Write the schemas**

`backend/src/features/tasks/task.schemas.ts`:

```ts
import { z } from 'zod'
import {
  calendarDateSchema,
  objectIdSchema,
  paginationQuerySchema,
} from '../../shared/validation/requestSchemas.ts'
import { TASK_PRIORITIES, TASK_STATUSES } from './task.model.ts'

const tagSchema = z.string().trim().toLowerCase().min(1).max(30)

/** Trimmed, lower-cased, de-duplicated, at most 10. */
const tagsSchema = z
  .array(tagSchema)
  .max(10, 'Use at most 10 tags')
  .transform((tags) => [...new Set(tags)])

const titleSchema = z.string().trim().min(1, 'Title is required').max(200)
const descriptionSchema = z.string().max(5000)

export const createTaskSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.default(''),
  status: z.enum(TASK_STATUSES).default('todo'),
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  dueDate: calendarDateSchema.nullish(),
  tags: tagsSchema.default([]),
})

/** Status and position are deliberately absent: they change only through the move endpoint. */
export const updateTaskSchema = z
  .object({
    title: titleSchema,
    description: descriptionSchema,
    priority: z.enum(TASK_PRIORITIES),
    dueDate: calendarDateSchema.nullable(),
    tags: tagsSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update')

export const moveTaskSchema = z.object({
  status: z.enum(TASK_STATUSES),
  afterId: objectIdSchema.optional(),
  beforeId: objectIdSchema.optional(),
})

export const listTasksQuerySchema = paginationQuerySchema.extend({
  status: z.enum(TASK_STATUSES).optional(),
  tag: tagSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  dueBefore: calendarDateSchema.optional(),
  open: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  sort: z.enum(['position', 'dueDate']).default('position'),
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>
export type MoveTaskInput = z.infer<typeof moveTaskSchema>
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>
```

- [ ] **Step 3: Write the DTO and the test helper**

`backend/src/features/tasks/task.dto.ts`:

```ts
import { formatCalendarDate } from '../../shared/dates/calendarDate.ts'
import type { TaskPriority, TaskRecord, TaskStatus } from './task.model.ts'

export interface TaskDto {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null
  tags: string[]
  position: number
  createdAt: string
  updatedAt: string
}

export function toTaskDto(task: TaskRecord): TaskDto {
  return {
    id: task._id.toString(),
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ? formatCalendarDate(task.dueDate) : null,
    tags: task.tags,
    position: task.position,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}
```

`backend/src/features/tasks/task.test-helpers.ts`:

```ts
import { Types } from 'mongoose'
import { Task, type TaskAttrs, type TaskRecord } from './task.model.ts'

/** Inserts a task straight into the database, bypassing the API (for arranging test state). */
export async function insertTask(
  userId: string,
  overrides: Partial<Omit<TaskAttrs, 'userId'>> = {},
): Promise<TaskRecord> {
  const task = await Task.create({
    userId: new Types.ObjectId(userId),
    title: 'A task',
    description: '',
    status: 'todo',
    priority: 'medium',
    tags: [],
    position: 0,
    ...overrides,
  })
  return task.toObject<TaskRecord>()
}
```

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(tasks): add task model, request schemas and DTO" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Task CRUD, list and tags endpoints

**Files:**
- Create: `backend/src/features/tasks/task.service.ts`, `task.controller.ts`, `task.routes.ts`, `index.ts`, `task.crud.test.ts`, `task.list.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2, `authUserId`, `requireAuth`, `validate`, `idParamsSchema`, `paginated`, `toSkip`.
- Produces: `createTask(userId, input): Promise<TaskDto>`, `getTask(userId, id)`, `updateTask(userId, id, input)`, `deleteTask(userId, id): Promise<void>`, `listTasks(userId, query): Promise<Paginated<TaskDto>>`, `listTags(userId): Promise<string[]>`; routes `GET/POST /api/tasks`, `GET /api/tasks/tags`, `GET/PATCH/DELETE /api/tasks/:id`.

- [ ] **Step 1: Write the failing CRUD tests**

`backend/src/features/tasks/task.crud.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { Task } from './task.model.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()
const create = (body: object, user = alice) =>
  request(app).post('/api/tasks').set(user.headers).send(body)
const list = (query = '', user = alice) =>
  request(app).get(`/api/tasks${query}`).set(user.headers)

describe('POST /api/tasks', () => {
  it('requires authentication', async () => {
    await request(app).post('/api/tasks').send({ title: 'x' }).expect(401)
  })

  it('creates a task with sensible defaults', async () => {
    const res = await create({ title: '  Buy milk  ' })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      id: expect.stringMatching(/^[a-f\d]{24}$/),
      title: 'Buy milk',
      description: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      tags: [],
    })
    expect(res.body.createdAt).toEqual(expect.any(String))
  })

  it('stores the fields it was given, including the due date as a calendar date', async () => {
    const res = await create({
      title: 'Pay rent',
      description: 'Before the 1st',
      priority: 'high',
      dueDate: '2026-10-01',
      status: 'in_progress',
    })

    expect(res.body).toMatchObject({
      description: 'Before the 1st',
      priority: 'high',
      dueDate: '2026-10-01',
      status: 'in_progress',
    })
    expect((await Task.findById(res.body.id))?.dueDate?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('normalises tags: trimmed, lower-cased and de-duplicated', async () => {
    const res = await create({ title: 'x', tags: [' Home ', 'HOME', 'work'] })

    expect(res.body.tags).toEqual(['home', 'work'])
  })

  it('puts a new task at the top of its column', async () => {
    const first = await create({ title: 'first' })
    const second = await create({ title: 'second' })
    const otherColumn = await create({ title: 'elsewhere', status: 'done' })

    const todo = await list('?status=todo')

    expect(todo.body.items.map((t: { title: string }) => t.title)).toEqual(['second', 'first'])
    expect(second.body.position).toBeLessThan(first.body.position)
    expect(otherColumn.body.position).toBe(0)
  })

  it.each([
    ['an empty title', { title: '   ' }],
    ['a 201-character title', { title: 'x'.repeat(201) }],
    ['a missing title', {}],
    ['an unknown priority', { title: 'x', priority: 'urgent' }],
    ['an unknown status', { title: 'x', status: 'archived' }],
    ['an impossible date', { title: 'x', dueDate: '2026-02-30' }],
    ['a date with a time', { title: 'x', dueDate: '2026-02-03T10:00:00Z' }],
    ['11 tags', { title: 'x', tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ['a 31-character tag', { title: 'x', tags: ['t'.repeat(31)] }],
    ['an empty tag', { title: 'x', tags: ['  '] }],
  ])('rejects %s with 400 and stores nothing', async (_name, body) => {
    const res = await create(body)

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Validation failed')
    expect(await Task.countDocuments()).toBe(0)
  })

  it('ignores a userId sent by the client', async () => {
    const bob = testUser()

    const res = await create({ title: 'mine', userId: alice.id }, bob)

    expect((await Task.findById(res.body.id))?.userId.toString()).toBe(bob.id)
  })
})

describe('GET /api/tasks/:id', () => {
  it('returns the task', async () => {
    const created = await create({ title: 'x' })

    const res = await request(app).get(`/api/tasks/${created.body.id}`).set(alice.headers)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(created.body.id)
  })

  it('answers 404 for an unknown id and 400 for a malformed one', async () => {
    await request(app).get('/api/tasks/65f1c2a4b3d4e5f6a7b8c9d0').set(alice.headers).expect(404)
    await request(app).get('/api/tasks/not-an-id').set(alice.headers).expect(400)
  })
})

describe('PATCH /api/tasks/:id', () => {
  const patch = (id: string, body: object) =>
    request(app).patch(`/api/tasks/${id}`).set(alice.headers).send(body)

  it('updates only the fields it is given', async () => {
    const created = await create({ title: 'old', description: 'keep me', priority: 'low' })

    const res = await patch(created.body.id, { title: 'new', priority: 'high' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ title: 'new', priority: 'high', description: 'keep me' })
  })

  it('sets and clears the due date, and normalises tags', async () => {
    const created = await create({ title: 'x', dueDate: '2026-10-01' })

    const cleared = await patch(created.body.id, { dueDate: null, tags: ['B', 'a', 'b'] })

    expect(cleared.body.dueDate).toBeNull()
    expect(cleared.body.tags).toEqual(['b', 'a'])
    expect((await patch(created.body.id, { dueDate: '2027-01-31' })).body.dueDate).toBe('2027-01-31')
  })

  it('cannot change status or position (only the move endpoint can)', async () => {
    const created = await create({ title: 'x' })

    const res = await patch(created.body.id, { title: 'y', status: 'done', position: 999 })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('todo')
    expect(res.body.position).toBe(created.body.position)
  })

  it('rejects an empty update, a blank title and an unknown id', async () => {
    const created = await create({ title: 'x' })

    await patch(created.body.id, {}).expect(400)
    await patch(created.body.id, { title: ' ' }).expect(400)
    await patch('65f1c2a4b3d4e5f6a7b8c9d0', { title: 'y' }).expect(404)
  })
})

describe('DELETE /api/tasks/:id', () => {
  it('deletes the task with 204, then answers 404', async () => {
    const created = await create({ title: 'x' })

    await request(app).delete(`/api/tasks/${created.body.id}`).set(alice.headers).expect(204)

    await request(app).delete(`/api/tasks/${created.body.id}`).set(alice.headers).expect(404)
    expect(await Task.countDocuments()).toBe(0)
  })
})
```

- [ ] **Step 2: Write the failing list tests**

`backend/src/features/tasks/task.list.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { insertTask } from './task.test-helpers.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()
const list = (query = '') => request(app).get(`/api/tasks${query}`).set(alice.headers)
const titles = (res: request.Response) => res.body.items.map((t: { title: string }) => t.title)
const date = (value: string) => new Date(`${value}T00:00:00.000Z`)

describe('GET /api/tasks', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/tasks').expect(401)
  })

  it('returns an empty page for a user with no tasks', async () => {
    const res = await list()

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items: [], page: 1, limit: 50, total: 0 })
  })

  it('filters by status and orders by position', async () => {
    await insertTask(alice.id, { title: 'b', position: 2 })
    await insertTask(alice.id, { title: 'a', position: 1 })
    await insertTask(alice.id, { title: 'done', status: 'done' })

    const res = await list('?status=todo')

    expect(titles(res)).toEqual(['a', 'b'])
    expect(res.body.total).toBe(2)
  })

  it('filters by tag', async () => {
    await insertTask(alice.id, { title: 'home one', tags: ['home'] })
    await insertTask(alice.id, { title: 'work one', tags: ['work', 'urgent'] })

    expect(titles(await list('?tag=urgent'))).toEqual(['work one'])
    expect(titles(await list('?tag=nope'))).toEqual([])
  })

  it('searches titles case-insensitively', async () => {
    await insertTask(alice.id, { title: 'Buy Milk' })
    await insertTask(alice.id, { title: 'Call mum' })

    expect(titles(await list('?q=milk'))).toEqual(['Buy Milk'])
  })

  it.each(['a.b', '(', '[', '*', '\\', 'a|b', '$'])(
    'treats %j in the search text literally',
    async (q) => {
      await insertTask(alice.id, { title: 'a.b' })
      await insertTask(alice.id, { title: 'axb' })
      await insertTask(alice.id, { title: '(x) [y] *z* \\ $ a|b' })

      const res = await list(`?q=${encodeURIComponent(q)}`)

      expect(res.status).toBe(200)
      const expected = q === 'a.b' ? ['a.b'] : ['(x) [y] *z* \\ $ a|b']
      expect(titles(res).sort()).toEqual(expected.sort())
    },
  )

  it('lists open tasks due on or before a date, soonest first', async () => {
    await insertTask(alice.id, { title: 'late', dueDate: date('2026-10-05') })
    await insertTask(alice.id, { title: 'soon', dueDate: date('2026-09-25') })
    await insertTask(alice.id, { title: 'done soon', dueDate: date('2026-09-24'), status: 'done' })
    await insertTask(alice.id, { title: 'no date' })
    await insertTask(alice.id, { title: 'too far', dueDate: date('2026-12-01') })

    const res = await list('?open=true&dueBefore=2026-10-05&sort=dueDate')

    expect(titles(res)).toEqual(['soon', 'late'])
  })

  it('open=true with status=done matches nothing', async () => {
    await insertTask(alice.id, { status: 'done' })

    expect((await list('?open=true&status=done')).body.total).toBe(0)
  })

  it('paginates and reports the total', async () => {
    for (let position = 1; position <= 5; position += 1) {
      await insertTask(alice.id, { title: `t${position}`, position })
    }

    const page2 = await list('?limit=2&page=2')
    const page3 = await list('?limit=2&page=3')

    expect(titles(page2)).toEqual(['t3', 't4'])
    expect(page2.body).toMatchObject({ page: 2, limit: 2, total: 5 })
    expect(titles(page3)).toEqual(['t5'])
  })

  it.each(['?page=0', '?limit=201', '?status=archived', '?dueBefore=2026-02-30', '?open=maybe', '?tag=a&tag=b'])(
    'rejects %s with 400',
    async (query) => {
      await list(query).expect(400)
    },
  )
})

describe('GET /api/tasks/tags', () => {
  it('returns the user\'s distinct tags, sorted', async () => {
    await insertTask(alice.id, { tags: ['work', 'home'] })
    await insertTask(alice.id, { tags: ['home', 'urgent'] })

    const res = await request(app).get('/api/tasks/tags').set(alice.headers)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ tags: ['home', 'urgent', 'work'] })
  })
})
```

Run: `npx vitest run src/features/tasks` → FAIL (404 for `/api/tasks`).

- [ ] **Step 3: Implement the service**

`backend/src/features/tasks/task.service.ts`:

```ts
import { Types, type QueryFilter } from 'mongoose'
import { parseCalendarDate } from '../../shared/dates/calendarDate.ts'
import { AppError } from '../../shared/errors/AppError.ts'
import { paginated, toSkip, type Paginated } from '../../shared/validation/requestSchemas.ts'
import { toTaskDto, type TaskDto } from './task.dto.ts'
import { Task, type TaskAttrs, type TaskRecord } from './task.model.ts'
import { positionBetween } from './task.ordering.ts'
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from './task.schemas.ts'

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export async function createTask(userId: string, input: CreateTaskInput): Promise<TaskDto> {
  const owner = new Types.ObjectId(userId)
  const top = await Task.findOne({ userId: owner, status: input.status })
    .sort({ position: 1, _id: 1 })
    .select('position')
    .lean<{ position: number } | null>()

  const task = await Task.create({
    userId: owner,
    title: input.title,
    description: input.description,
    status: input.status,
    priority: input.priority,
    dueDate: input.dueDate ? parseCalendarDate(input.dueDate) : undefined,
    tags: input.tags,
    position: positionBetween(undefined, top?.position) ?? 0,
  })
  return toTaskDto(task.toObject<TaskRecord>())
}

export async function getTask(userId: string, id: string): Promise<TaskDto> {
  const task = await Task.findOne({ _id: id, userId: new Types.ObjectId(userId) }).lean<TaskRecord | null>()
  if (!task) throw new AppError(404, 'Task not found')
  return toTaskDto(task)
}

export async function updateTask(userId: string, id: string, input: UpdateTaskInput): Promise<TaskDto> {
  const task = await Task.findOne({ _id: id, userId: new Types.ObjectId(userId) })
  if (!task) throw new AppError(404, 'Task not found')

  if (input.title !== undefined) task.title = input.title
  if (input.description !== undefined) task.description = input.description
  if (input.priority !== undefined) task.priority = input.priority
  if (input.tags !== undefined) task.tags = input.tags
  if (input.dueDate !== undefined) {
    task.dueDate = input.dueDate === null ? undefined : parseCalendarDate(input.dueDate)
  }

  await task.save()
  return toTaskDto(task.toObject<TaskRecord>())
}

export async function deleteTask(userId: string, id: string): Promise<void> {
  const result = await Task.deleteOne({ _id: id, userId: new Types.ObjectId(userId) })
  if (result.deletedCount === 0) throw new AppError(404, 'Task not found')
}

export async function listTasks(userId: string, query: ListTasksQuery): Promise<Paginated<TaskDto>> {
  const filter: QueryFilter<TaskAttrs> = { userId: new Types.ObjectId(userId) }
  if (query.status) filter.status = query.status
  if (query.open) {
    if (query.status === 'done') return paginated([], 0, query)
    filter.status = query.status ?? { $ne: 'done' }
  }
  if (query.tag) filter.tags = query.tag
  if (query.q) filter.title = { $regex: escapeRegExp(query.q), $options: 'i' }
  if (query.dueBefore) filter.dueDate = { $lte: parseCalendarDate(query.dueBefore) }

  const sort: Record<string, 1 | -1> =
    query.sort === 'dueDate' ? { dueDate: 1, position: 1, _id: 1 } : { position: 1, _id: 1 }

  const [tasks, total] = await Promise.all([
    Task.find(filter).sort(sort).skip(toSkip(query)).limit(query.limit).lean<TaskRecord[]>(),
    Task.countDocuments(filter),
  ])
  return paginated(tasks.map(toTaskDto), total, query)
}

export async function listTags(userId: string): Promise<string[]> {
  const tags = (await Task.distinct('tags', { userId: new Types.ObjectId(userId) })) as string[]
  return tags.sort()
}

/** For the account export. Returns every task, in board order. */
export async function exportTasks(userId: string): Promise<TaskDto[]> {
  const tasks = await Task.find({ userId: new Types.ObjectId(userId) })
    .sort({ status: 1, position: 1, _id: 1 })
    .lean<TaskRecord[]>()
  return tasks.map(toTaskDto)
}

export async function deleteAllTasks(userId: string): Promise<void> {
  await Task.deleteMany({ userId: new Types.ObjectId(userId) })
}
```

- [ ] **Step 4: Implement controller, routes and the slice entry**

`backend/src/features/tasks/task.controller.ts`:

```ts
import type { Request, Response } from 'express'
import { authUserId } from '../../shared/auth/requestUser.ts'
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from './task.schemas.ts'
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
    await taskService.updateTask(authUserId(req), req.params.id as string, req.body as UpdateTaskInput),
  )
}

export async function remove(req: Request, res: Response) {
  await taskService.deleteTask(authUserId(req), req.params.id as string)
  res.status(204).end()
}
```

`backend/src/features/tasks/task.routes.ts`:

```ts
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
```

`backend/src/features/tasks/index.ts`:

```ts
export { taskRouter } from './task.routes.ts'
```

In `backend/src/app.ts` add `import { taskRouter } from './features/tasks/index.ts'` and mount below the auth router: `app.use('/api/tasks', taskRouter)`.

Run: `npx vitest run src/features/tasks` → PASS.

- [ ] **Step 5: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(tasks): add task CRUD, list, search and tag endpoints" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Move endpoint (drag and drop)

**Files:**
- Create: `backend/src/features/tasks/task.move.ts`, `task.move.test.ts`
- Modify: `backend/src/features/tasks/task.controller.ts`, `task.routes.ts`

**Interfaces:**
- Consumes: `positionBetween`, `POSITION_STEP`, `Task`, `moveTaskSchema`.
- Produces: `moveTask(userId, id, input: MoveTaskInput): Promise<TaskDto>`; route `POST /api/tasks/:id/move`. Errors: `404` unknown task, `400` a neighbour is the moved task itself, `409` a neighbour does not exist or is in a different column, or `afterId` sits at or below `beforeId`.

- [ ] **Step 1: Write the failing tests**

`backend/src/features/tasks/task.move.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { Task, type TaskRecord } from './task.model.ts'
import { POSITION_STEP } from './task.ordering.ts'
import { insertTask } from './task.test-helpers.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()

const idOf = (task: TaskRecord) => task._id.toString()

const move = (id: string, body: object) =>
  request(app).post(`/api/tasks/${id}/move`).set(alice.headers).send(body)

/** Titles of a column in board order. */
async function column(status: string): Promise<string[]> {
  const res = await request(app).get(`/api/tasks?status=${status}`).set(alice.headers)
  return res.body.items.map((t: { title: string }) => t.title)
}

/** Three To Do cards A, B, C at positions 0, 1024, 2048. */
async function seedABC() {
  const a = await insertTask(alice.id, { title: 'A', position: 0 })
  const b = await insertTask(alice.id, { title: 'B', position: POSITION_STEP })
  const c = await insertTask(alice.id, { title: 'C', position: 2 * POSITION_STEP })
  return { a, b, c }
}

describe('POST /api/tasks/:id/move', () => {
  it('requires authentication', async () => {
    await request(app)
      .post('/api/tasks/65f1c2a4b3d4e5f6a7b8c9d0/move')
      .send({ status: 'done' })
      .expect(401)
  })

  it('moves a card into an empty column', async () => {
    const { a } = await seedABC()

    const res = await move(idOf(a), { status: 'in_progress' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ title: 'A', status: 'in_progress', position: 0 })
    expect(await column('todo')).toEqual(['B', 'C'])
    expect(await column('in_progress')).toEqual(['A'])
  })

  it('reorders within a column: between two cards', async () => {
    const { a, b, c } = await seedABC()

    await move(idOf(c), { status: 'todo', afterId: idOf(a), beforeId: idOf(b) })

    expect(await column('todo')).toEqual(['A', 'C', 'B'])
  })

  it('reorders within a column: to the top and to the bottom', async () => {
    const { a, b, c } = await seedABC()

    await move(idOf(c), { status: 'todo', beforeId: idOf(a) })
    expect(await column('todo')).toEqual(['C', 'A', 'B'])

    await move(idOf(c), { status: 'todo', afterId: idOf(b) })
    expect(await column('todo')).toEqual(['A', 'B', 'C'])
  })

  it('moves a card to another column at a chosen place', async () => {
    const { a } = await seedABC()
    const x = await insertTask(alice.id, { title: 'X', status: 'done', position: 0 })
    const y = await insertTask(alice.id, { title: 'Y', status: 'done', position: POSITION_STEP })

    await move(idOf(a), { status: 'done', afterId: idOf(x), beforeId: idOf(y) })

    expect(await column('done')).toEqual(['X', 'A', 'Y'])
    expect(await column('todo')).toEqual(['B', 'C'])
  })

  it('renumbers the column when two cards are too close to split, and keeps the order', async () => {
    const a = await insertTask(alice.id, { title: 'A', position: 1 })
    const b = await insertTask(alice.id, { title: 'B', position: 1 + 1e-9 })
    const x = await insertTask(alice.id, { title: 'X', position: 500 })

    await move(idOf(x), { status: 'todo', afterId: idOf(a), beforeId: idOf(b) }).expect(200)

    expect(await column('todo')).toEqual(['A', 'X', 'B'])
    const positions = (await Task.find().sort({ position: 1 })).map((task) => task.position)
    expect(new Set(positions).size).toBe(3)
  })

  it('handles two cards with exactly the same position', async () => {
    const a = await insertTask(alice.id, { title: 'A', position: 7 })
    const b = await insertTask(alice.id, { title: 'B', position: 7 })
    const x = await insertTask(alice.id, { title: 'X', position: 100 })

    await move(idOf(x), { status: 'todo', afterId: idOf(a), beforeId: idOf(b) }).expect(200)

    const order = await column('todo')
    expect(order.indexOf('X')).toBe(order.indexOf('A') + 1)
  })

  it('answers 404 for an unknown task', async () => {
    await move('65f1c2a4b3d4e5f6a7b8c9d0', { status: 'done' }).expect(404)
  })

  it('answers 400 when a neighbour is the moved card itself', async () => {
    const { a } = await seedABC()

    await move(idOf(a), { status: 'todo', afterId: idOf(a) }).expect(400)
  })

  it('answers 409 when a neighbour was deleted meanwhile', async () => {
    const { a, b } = await seedABC()
    await Task.deleteOne({ _id: b._id })

    const res = await move(idOf(a), { status: 'todo', afterId: idOf(b) })

    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/board changed/i)
  })

  it('answers 409 when a neighbour is in a different column', async () => {
    const { a } = await seedABC()
    const elsewhere = await insertTask(alice.id, { title: 'E', status: 'done' })

    await move(idOf(a), { status: 'todo', afterId: idOf(elsewhere) }).expect(409)
  })

  it('answers 409 when the neighbours are in the wrong order', async () => {
    const { a, b, c } = await seedABC()

    await move(idOf(c), { status: 'todo', afterId: idOf(b), beforeId: idOf(a) }).expect(409)
  })

  it('rejects a malformed body', async () => {
    const { a } = await seedABC()

    await move(idOf(a), { status: 'archived' }).expect(400)
    await move(idOf(a), { status: 'todo', afterId: 'nope' }).expect(400)
  })
})
```

Run: `npx vitest run src/features/tasks/task.move.test.ts` → FAIL (404 on the move route).

- [ ] **Step 2: Implement the move**

`backend/src/features/tasks/task.move.ts`:

```ts
import { Types } from 'mongoose'
import { AppError } from '../../shared/errors/AppError.ts'
import { toTaskDto, type TaskDto } from './task.dto.ts'
import { Task, type TaskRecord, type TaskStatus } from './task.model.ts'
import { POSITION_STEP, positionBetween } from './task.ordering.ts'
import type { MoveTaskInput } from './task.schemas.ts'

const STALE_BOARD = 'The board changed. Refresh and try again.'

/** The neighbour's position, or undefined when no neighbour was given. */
async function neighbourPosition(
  owner: Types.ObjectId,
  neighbourId: string | undefined,
  status: TaskStatus,
  movedId: string,
): Promise<number | undefined> {
  if (neighbourId === undefined) return undefined
  if (neighbourId === movedId) throw new AppError(400, 'A card cannot be next to itself')
  const neighbour = await Task.findOne({ _id: neighbourId, userId: owner, status })
    .select('position')
    .lean<{ position: number } | null>()
  if (!neighbour) throw new AppError(409, STALE_BOARD)
  return neighbour.position
}

async function positionsAround(owner: Types.ObjectId, id: string, input: MoveTaskInput) {
  const [above, below] = await Promise.all([
    neighbourPosition(owner, input.afterId, input.status, id),
    neighbourPosition(owner, input.beforeId, input.status, id),
  ])
  if (above !== undefined && below !== undefined && above > below) {
    throw new AppError(409, STALE_BOARD)
  }
  return { above, below }
}

/** Renumbers a column 0, 1024, 2048, ... in its current order. */
async function rebalance(owner: Types.ObjectId, status: TaskStatus): Promise<void> {
  const cards = await Task.find({ userId: owner, status })
    .sort({ position: 1, _id: 1 })
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>()
  await Task.bulkWrite(
    cards.map((card, index) => ({
      updateOne: {
        filter: { _id: card._id, userId: owner },
        update: { $set: { position: index * POSITION_STEP } },
      },
    })),
  )
}

export async function moveTask(userId: string, id: string, input: MoveTaskInput): Promise<TaskDto> {
  const owner = new Types.ObjectId(userId)
  if (!(await Task.exists({ _id: id, userId: owner }))) throw new AppError(404, 'Task not found')

  let neighbours = await positionsAround(owner, id, input)
  let position = positionBetween(neighbours.above, neighbours.below)

  if (position === null) {
    await rebalance(owner, input.status)
    neighbours = await positionsAround(owner, id, input)
    position = positionBetween(neighbours.above, neighbours.below)
  }
  if (position === null) throw new AppError(500, 'Could not place the card')

  const moved = await Task.findOneAndUpdate(
    { _id: id, userId: owner },
    { $set: { status: input.status, position } },
    { new: true },
  ).lean<TaskRecord | null>()
  if (!moved) throw new AppError(404, 'Task not found')
  return toTaskDto(moved)
}
```

One subtlety the tests cover: when two neighbours share a position, `rebalance` orders ties by `_id`, which keeps their relative order, and after renumbering the gap is 1024 so the split succeeds. The moved card is still in its old column while neighbours are read, but it can never be its own neighbour (checked above), so the midpoint is unaffected.

- [ ] **Step 3: Add the route**

In `task.controller.ts` add `import { moveTask } from './task.move.ts'`, `MoveTaskInput` to the schema type import, and:

```ts
export async function move(req: Request, res: Response) {
  res.json(await moveTask(authUserId(req), req.params.id as string, req.body as MoveTaskInput))
}
```

In `task.routes.ts` extend the imports (`move` from the controller, `moveTaskSchema` from the schemas) and append:

```ts
taskRouter.post('/:id/move', validate({ params: idParamsSchema, body: moveTaskSchema }), move)
```

Run: `npx vitest run src/features/tasks` → PASS.

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(tasks): add move endpoint with column rebalancing" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Tenant isolation and the slice's public API

**Files:**
- Create: `backend/src/features/tasks/task.isolation.test.ts`, `task.public-api.test.ts`
- Modify: `backend/src/features/tasks/index.ts`

**Interfaces:**
- Produces (from `features/tasks/index.ts`): `taskRouter`, `type TaskDto`, `exportTasksForUser(userId): Promise<TaskDto[]>`, `deleteTasksForUser(userId): Promise<void>`.

- [ ] **Step 1: Write the isolation test (NFR-1)**

`backend/src/features/tasks/task.isolation.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { Task } from './task.model.ts'
import { insertTask } from './task.test-helpers.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()
const bob = testUser()
let aliceTaskId: string
let aliceSecondId: string

beforeEach(async () => {
  const first = await insertTask(alice.id, { title: 'alice secret', tags: ['private'], position: 0 })
  const second = await insertTask(alice.id, { title: 'alice second', position: 1024 })
  aliceTaskId = first._id.toString()
  aliceSecondId = second._id.toString()
})

const asBob = {
  get: (url: string) => request(app).get(url).set(bob.headers),
  patch: (url: string, body: object) => request(app).patch(url).set(bob.headers).send(body),
  delete: (url: string) => request(app).delete(url).set(bob.headers),
  post: (url: string, body: object) => request(app).post(url).set(bob.headers).send(body),
}

describe("another user's tasks look like they do not exist", () => {
  it('cannot be read, changed, deleted or moved by id', async () => {
    await asBob.get(`/api/tasks/${aliceTaskId}`).expect(404)
    await asBob.patch(`/api/tasks/${aliceTaskId}`, { title: 'hacked' }).expect(404)
    await asBob.post(`/api/tasks/${aliceTaskId}/move`, { status: 'done' }).expect(404)
    await asBob.delete(`/api/tasks/${aliceTaskId}`).expect(404)

    const stored = await Task.findById(aliceTaskId)
    expect(stored).toMatchObject({ title: 'alice secret', status: 'todo' })
  })

  it('never shows up in lists, searches, tag filters or the tag list', async () => {
    const all = await asBob.get('/api/tasks')
    const search = await asBob.get('/api/tasks?q=secret')
    const byTag = await asBob.get('/api/tasks?tag=private')
    const tags = await asBob.get('/api/tasks/tags')

    expect(all.body.total).toBe(0)
    expect(search.body.total).toBe(0)
    expect(byTag.body.total).toBe(0)
    expect(tags.body).toEqual({ tags: [] })
  })

  it("cannot be used as a neighbour in the other user's board", async () => {
    const mine = await insertTask(bob.id, { title: 'bob task' })

    const res = await asBob.post(`/api/tasks/${mine._id.toString()}/move`, {
      status: 'todo',
      afterId: aliceTaskId,
      beforeId: aliceSecondId,
    })

    expect(res.status).toBe(409)
    expect((await Task.findById(mine._id))?.position).toBe(0)
  })

  it('cannot be created for someone else by sending their user id', async () => {
    const res = await asBob.post('/api/tasks', { title: 'planted', userId: alice.id })

    expect((await Task.findById(res.body.id))?.userId.toString()).toBe(bob.id)
    expect(await Task.countDocuments({ userId: alice.id })).toBe(2)
  })

  it('keeps counts and pagination per user', async () => {
    await insertTask(bob.id, { title: 'bob only' })

    const bobs = await asBob.get('/api/tasks')
    const alices = await request(app).get('/api/tasks').set(alice.headers)

    expect(bobs.body.total).toBe(1)
    expect(alices.body.total).toBe(2)
  })
})
```

Run it: it should already PASS, because the service scopes by `userId` everywhere. If any assertion fails, that is a tenant leak: fix the service (never the test).

- [ ] **Step 2: Write the public API test**

`backend/src/features/tasks/task.public-api.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { deleteTasksForUser, exportTasksForUser } from './index.ts'
import { Task } from './task.model.ts'
import { insertTask } from './task.test-helpers.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

describe('tasks public API', () => {
  it('exports only the user\'s own tasks, in board order', async () => {
    const alice = testUser()
    const bob = testUser()
    await insertTask(alice.id, { title: 'todo 2', position: 2 })
    await insertTask(alice.id, { title: 'todo 1', position: 1 })
    await insertTask(alice.id, { title: 'done 1', status: 'done', dueDate: new Date('2026-10-01T00:00:00Z') })
    await insertTask(bob.id, { title: 'not yours' })

    const exported = await exportTasksForUser(alice.id)

    expect(exported.map((t) => t.title)).toEqual(['done 1', 'todo 1', 'todo 2'])
    expect(exported[0]?.dueDate).toBe('2026-10-01')
  })

  it("deletes all of one user's tasks and leaves everyone else's", async () => {
    const alice = testUser()
    const bob = testUser()
    await insertTask(alice.id)
    await insertTask(alice.id)
    await insertTask(bob.id)

    await deleteTasksForUser(alice.id)

    expect(await Task.countDocuments({ userId: alice.id })).toBe(0)
    expect(await Task.countDocuments({ userId: bob.id })).toBe(1)
  })
})
```

- [ ] **Step 3: Export the API**

Replace `backend/src/features/tasks/index.ts`:

```ts
export { exportTasks as exportTasksForUser, deleteAllTasks as deleteTasksForUser } from './task.service.ts'
export { taskRouter } from './task.routes.ts'
export type { TaskDto } from './task.dto.ts'
```

Run: `npx vitest run src/features/tasks` → PASS.

The export sorts by `status` then `position`; the alphabetical order of status names (`done`, `in_progress`, `todo`) is what the test above expects and is fine for a data export.

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(tasks): add tenant isolation tests and the slice public API" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Part B: Frontend

All commands in Part B run from `frontend/`.

### Task 6: Types, API, query keys, board cache logic and task-form logic

**Files:**
- Create: `frontend/src/features/tasks/types.ts`, `api/taskApi.ts`, `api/taskKeys.ts`, `boardCache.ts`, `boardCache.test.ts`, `taskForm.ts`, `taskForm.test.ts`

**Interfaces:**
- Produces: `TASK_STATUSES`, `TASK_PRIORITIES`, `STATUS_LABELS`, `PRIORITY_LABELS`, `type TaskStatus`, `type TaskPriority`, `isTaskStatus(value: string): value is TaskStatus`, `type Task`, `type TaskPage`, `type BoardFilters = { tag?: string; q?: string }`, `type TaskInput`; API functions `listTasks(params)`, `fetchTags()`, `createTask(input)`, `updateTask(id, input)`, `deleteTask(id)`, `moveTask(id, input)`; `taskKeys` (`all`, `columns`, `column(status, filters)`, `dueSoon(days)`, `tags`); `type ColumnData = InfiniteData<TaskPage, number>`, `flattenColumn(data)`, `removeTask(data, id)`, `insertTask(data, task, index)`, `neighboursFor(items, movedId, destIndex)`; `parseTags(text)`, `taskFormSchema`, `type TaskFormValues`, `toTaskInput(values)`, `toFormValues(task?)`.

- [ ] **Step 0: Create the branch**

```bash
git switch main && git switch -c feature/tasks-board
```

(Skip this step if you are continuing on the branch created in Part A.)

- [ ] **Step 1: Write types, API and query keys**

`frontend/src/features/tasks/types.ts`:

```ts
export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
}

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value)
}

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  /** YYYY-MM-DD */
  dueDate: string | null
  tags: string[]
  position: number
  createdAt: string
  updatedAt: string
}

export interface TaskPage {
  items: Task[]
  page: number
  limit: number
  total: number
}

export interface BoardFilters {
  tag?: string
  q?: string
}

export interface TaskInput {
  title: string
  description: string
  priority: TaskPriority
  dueDate: string | null
  tags: string[]
}
```

`frontend/src/features/tasks/api/taskApi.ts`:

```ts
import { httpClient } from '@/shared/api/httpClient'
import type { Task, TaskInput, TaskPage, TaskStatus } from '../types'

export interface ListTasksParams {
  status?: TaskStatus
  tag?: string
  q?: string
  dueBefore?: string
  open?: boolean
  sort?: 'position' | 'dueDate'
  page?: number
  limit?: number
}

export async function listTasks(params: ListTasksParams): Promise<TaskPage> {
  const { data } = await httpClient.get<TaskPage>('/tasks', { params })
  return data
}

export async function fetchTags(): Promise<string[]> {
  const { data } = await httpClient.get<{ tags: string[] }>('/tasks/tags')
  return data.tags
}

export async function createTask(input: TaskInput & { status?: TaskStatus }): Promise<Task> {
  const { data } = await httpClient.post<Task>('/tasks', input)
  return data
}

export async function updateTask(id: string, input: Partial<TaskInput>): Promise<Task> {
  const { data } = await httpClient.patch<Task>(`/tasks/${id}`, input)
  return data
}

export async function deleteTask(id: string): Promise<void> {
  await httpClient.delete(`/tasks/${id}`)
}

export async function moveTask(
  id: string,
  input: { status: TaskStatus; afterId?: string; beforeId?: string },
): Promise<Task> {
  const { data } = await httpClient.post<Task>(`/tasks/${id}/move`, input)
  return data
}
```

`frontend/src/features/tasks/api/taskKeys.ts`:

```ts
import type { BoardFilters, TaskStatus } from '../types'

export const taskKeys = {
  all: ['tasks'] as const,
  columns: ['tasks', 'column'] as const,
  column: (status: TaskStatus, filters: BoardFilters) => ['tasks', 'column', status, filters] as const,
  dueSoon: (days: number) => ['tasks', 'due-soon', days] as const,
  tags: ['tasks', 'tags'] as const,
}
```

- [ ] **Step 2: Write the failing board-cache tests**

`frontend/src/features/tasks/boardCache.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { flattenColumn, insertTask, neighboursFor, removeTask, type ColumnData } from './boardCache'
import type { Task } from './types'

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    tags: [],
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Two loaded pages of two cards each, out of 5 in the column. */
function twoPages(): ColumnData {
  return {
    pageParams: [1, 2],
    pages: [
      { items: [task('a'), task('b')], page: 1, limit: 2, total: 5 },
      { items: [task('c'), task('d')], page: 2, limit: 2, total: 5 },
    ],
  }
}

const ids = (data: ColumnData) => flattenColumn(data).map((t) => t.id)

describe('flattenColumn', () => {
  it('joins the loaded pages, and copes with no data', () => {
    expect(ids(twoPages())).toEqual(['a', 'b', 'c', 'd'])
    expect(flattenColumn(undefined)).toEqual([])
  })
})

describe('removeTask', () => {
  it('removes the card from whichever page holds it and lowers the total', () => {
    const result = removeTask(twoPages(), 'c')

    expect(ids(result)).toEqual(['a', 'b', 'd'])
    expect(result.pages.map((p) => p.total)).toEqual([4, 4])
    expect(result.pageParams).toEqual([1, 2])
  })

  it('leaves the data alone when the card is not loaded', () => {
    const data = twoPages()

    expect(removeTask(data, 'zzz')).toBe(data)
  })
})

describe('insertTask', () => {
  it.each([
    [0, ['x', 'a', 'b', 'c', 'd']],
    [1, ['a', 'x', 'b', 'c', 'd']],
    [2, ['a', 'b', 'x', 'c', 'd']],
    [3, ['a', 'b', 'c', 'x', 'd']],
    [4, ['a', 'b', 'c', 'd', 'x']],
  ])('inserts at flat index %i', (index, expected) => {
    const result = insertTask(twoPages(), task('x'), index)

    expect(ids(result)).toEqual(expected)
    expect(result.pages.map((p) => p.total)).toEqual([6, 6])
  })

  it('does not change the page parameters, so a refetch still asks for every page', () => {
    expect(insertTask(twoPages(), task('x'), 1).pageParams).toEqual([1, 2])
  })

  it('inserts into an empty column', () => {
    const empty: ColumnData = {
      pageParams: [1],
      pages: [{ items: [], page: 1, limit: 50, total: 0 }],
    }

    expect(ids(insertTask(empty, task('x'), 0))).toEqual(['x'])
  })

  it('does not mutate its input', () => {
    const data = twoPages()

    insertTask(data, task('x'), 1)

    expect(ids(data)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('neighboursFor', () => {
  const items = [task('a'), task('b'), task('c')]

  it('names the cards that will sit above and below the drop position', () => {
    expect(neighboursFor(items, 'x', 1)).toEqual({ afterId: 'a', beforeId: 'b' })
  })

  it('has no card above at the top and none below at the bottom', () => {
    expect(neighboursFor(items, 'x', 0)).toEqual({ afterId: undefined, beforeId: 'a' })
    expect(neighboursFor(items, 'x', 3)).toEqual({ afterId: 'c', beforeId: undefined })
  })

  it('ignores the moved card itself when it is reordered inside its own column', () => {
    // Dragging "a" to the end of [a, b, c]: the final list is [b, c, a], so index 2 is "after c".
    expect(neighboursFor(items, 'a', 2)).toEqual({ afterId: 'c', beforeId: undefined })
    // Dragging "c" to the top.
    expect(neighboursFor(items, 'c', 0)).toEqual({ afterId: undefined, beforeId: 'a' })
  })

  it('has no neighbours in an empty column', () => {
    expect(neighboursFor([], 'x', 0)).toEqual({ afterId: undefined, beforeId: undefined })
  })
})
```

Run: `npx vitest run src/features/tasks/boardCache.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the board cache logic**

`frontend/src/features/tasks/boardCache.ts`:

```ts
import type { InfiniteData } from '@tanstack/react-query'
import type { Task, TaskPage } from './types'

export type ColumnData = InfiniteData<TaskPage, number>

export function flattenColumn(data: ColumnData | undefined): Task[] {
  return data?.pages.flatMap((page) => page.items) ?? []
}

/** Removes a card from whichever loaded page holds it. Page parameters are left untouched. */
export function removeTask(data: ColumnData, taskId: string): ColumnData {
  if (!data.pages.some((page) => page.items.some((item) => item.id === taskId))) return data
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((item) => item.id !== taskId),
      total: page.total - 1,
    })),
  }
}

/**
 * Inserts a card at `index` counted across all loaded pages. Cards are edited in place per page
 * rather than merged into one page, so `pageParams` still lets a refetch reload every page.
 */
export function insertTask(data: ColumnData, task: Task, index: number): ColumnData {
  const pages = data.pages.map((page) => ({
    ...page,
    items: [...page.items],
    total: page.total + 1,
  }))
  let remaining = Math.max(0, index)

  for (const [position, page] of pages.entries()) {
    const isLastPage = position === pages.length - 1
    if (remaining < page.items.length || (remaining === page.items.length && isLastPage)) {
      page.items.splice(remaining, 0, task)
      break
    }
    remaining -= page.items.length
  }
  return { ...data, pages }
}

/**
 * The cards that will sit directly above and below a dropped card, ignoring the card itself.
 * `destIndex` is the final index in the destination list, which is what the drag library reports.
 */
export function neighboursFor(
  items: Task[],
  movedId: string,
  destIndex: number,
): { afterId: string | undefined; beforeId: string | undefined } {
  const others = items.filter((item) => item.id !== movedId)
  return { afterId: others[destIndex - 1]?.id, beforeId: others[destIndex]?.id }
}
```

Run → PASS (13 assertions across the cases).

- [ ] **Step 4: Write the failing task-form tests**

`frontend/src/features/tasks/taskForm.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseTags, taskFormSchema, toFormValues, toTaskInput } from './taskForm'
import type { Task } from './types'

describe('parseTags', () => {
  it('splits on commas, trims, lower-cases and removes duplicates and blanks', () => {
    expect(parseTags(' Home, work ,HOME,, ')).toEqual(['home', 'work'])
    expect(parseTags('')).toEqual([])
  })
})

describe('taskFormSchema', () => {
  const valid = { title: 'Pay rent', description: '', priority: 'medium', dueDate: '', tags: '' }

  it('accepts a minimal task', () => {
    expect(taskFormSchema.safeParse(valid).success).toBe(true)
  })

  it.each([
    ['a blank title', { title: '   ' }, 'Enter a title'],
    ['a long title', { title: 'x'.repeat(201) }, 'Use at most 200 characters'],
    ['a malformed date', { dueDate: '01/02/2026' }, 'Use a valid date'],
    ['11 tags', { tags: 'a,b,c,d,e,f,g,h,i,j,k' }, 'Use at most 10 tags'],
    ['a 31-character tag', { tags: 't'.repeat(31) }, 'Each tag can have at most 30 characters'],
  ])('rejects %s', (_name, override, message) => {
    const result = taskFormSchema.safeParse({ ...valid, ...override })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toContain(message)
  })
})

describe('toTaskInput', () => {
  it('turns form values into an API payload', () => {
    expect(
      toTaskInput({
        title: ' Pay rent ',
        description: 'soon',
        priority: 'high',
        dueDate: '2026-10-01',
        tags: 'Home, bills',
      }),
    ).toEqual({
      title: 'Pay rent',
      description: 'soon',
      priority: 'high',
      dueDate: '2026-10-01',
      tags: ['home', 'bills'],
    })
  })

  it('sends null for an empty date so an existing date can be cleared', () => {
    expect(
      toTaskInput({ title: 'x', description: '', priority: 'low', dueDate: '', tags: '' }).dueDate,
    ).toBeNull()
  })
})

describe('toFormValues', () => {
  it('defaults to a medium-priority empty task', () => {
    expect(toFormValues()).toEqual({
      title: '',
      description: '',
      priority: 'medium',
      dueDate: '',
      tags: '',
    })
  })

  it('fills the form from an existing task', () => {
    const task: Task = {
      id: '1',
      title: 'Pay rent',
      description: 'soon',
      status: 'todo',
      priority: 'high',
      dueDate: '2026-10-01',
      tags: ['home', 'bills'],
      position: 0,
      createdAt: '',
      updatedAt: '',
    }

    expect(toFormValues(task)).toEqual({
      title: 'Pay rent',
      description: 'soon',
      priority: 'high',
      dueDate: '2026-10-01',
      tags: 'home, bills',
    })
  })
})
```

Run → FAIL. Implement `frontend/src/features/tasks/taskForm.ts`:

```ts
import { z } from 'zod'
import { TASK_PRIORITIES, type Task, type TaskInput } from './types'

/** Comma-separated text to tags: trimmed, lower-cased, unique, no blanks. */
export function parseTags(text: string): string[] {
  const tags = text
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0)
  return [...new Set(tags)]
}

export const taskFormSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title').max(200, 'Use at most 200 characters'),
  description: z.string().max(5000, 'Use at most 5000 characters'),
  priority: z.enum(TASK_PRIORITIES),
  dueDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use a valid date'),
  tags: z
    .string()
    .max(400)
    .superRefine((value, context) => {
      const tags = parseTags(value)
      if (tags.length > 10) context.addIssue({ code: 'custom', message: 'Use at most 10 tags' })
      if (tags.some((tag) => tag.length > 30)) {
        context.addIssue({ code: 'custom', message: 'Each tag can have at most 30 characters' })
      }
    }),
})

export type TaskFormValues = z.infer<typeof taskFormSchema>

export function toTaskInput(values: TaskFormValues): TaskInput {
  return {
    title: values.title.trim(),
    description: values.description,
    priority: values.priority,
    dueDate: values.dueDate === '' ? null : values.dueDate,
    tags: parseTags(values.tags),
  }
}

export function toFormValues(task?: Task): TaskFormValues {
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    priority: task?.priority ?? 'medium',
    dueDate: task?.dueDate ?? '',
    tags: task?.tags.join(', ') ?? '',
  }
}
```

Run: `npx vitest run src/features/tasks` → PASS.

- [ ] **Step 5: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(tasks): add task types, API, query keys, board cache and form logic" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Query hooks and the optimistic move

**Files:**
- Create: `frontend/src/features/tasks/api/hooks.ts`, `api/hooks.test.tsx`

**Interfaces:**
- Consumes: Task 6 modules, `pushToast`, `getErrorMessage`.
- Produces: `useColumnTasks(status, filters)` (infinite query, 50 per page), `useTags()`, `useCreateTask()`, `useUpdateTask()`, `useDeleteTask()`, `useMoveTask()` (optimistic, rolls back on error, always refetches), `useDueSoonTasks(days = 7)`.

- [ ] **Step 1: Write the failing hook tests**

`frontend/src/features/tasks/api/hooks.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '@/shared/ui/toast'
import { flattenColumn, type ColumnData } from '../boardCache'
import type { Task, TaskPage } from '../types'
import * as taskApi from './taskApi'
import { useColumnTasks, useDueSoonTasks, useMoveTask } from './hooks'
import { taskKeys } from './taskKeys'

vi.mock('./taskApi')

function task(id: string, status: Task['status'] = 'todo'): Task {
  return {
    id,
    title: id,
    description: '',
    status,
    priority: 'medium',
    dueDate: null,
    tags: [],
    position: 0,
    createdAt: '',
    updatedAt: '',
  }
}

const page = (items: Task[], total = items.length): TaskPage => ({ items, page: 1, limit: 50, total })

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

const ids = (client: QueryClient, status: Task['status']) =>
  flattenColumn(client.getQueryData<ColumnData>(taskKeys.column(status, {}))).map((t) => t.id)

beforeEach(() => {
  vi.resetAllMocks()
  useToastStore.setState({ toasts: [] })
})

describe('useColumnTasks', () => {
  it('asks for one page of one column and offers the next page while there is more', async () => {
    vi.mocked(taskApi.listTasks).mockResolvedValue(page([task('a')], 120))
    const { wrapper } = setup()

    const { result } = renderHook(() => useColumnTasks('todo', { tag: 'home' }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(vi.mocked(taskApi.listTasks).mock.calls[0]?.[0]).toEqual({
      status: 'todo',
      tag: 'home',
      page: 1,
      limit: 50,
    })
    expect(result.current.hasNextPage).toBe(true)
  })

  it('stops offering pages once everything is loaded', async () => {
    vi.mocked(taskApi.listTasks).mockResolvedValue(page([task('a')], 1))
    const { wrapper } = setup()

    const { result } = renderHook(() => useColumnTasks('todo', {}), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.hasNextPage).toBe(false)
  })
})

describe('useDueSoonTasks', () => {
  it('asks for open tasks due within the window, soonest first', async () => {
    vi.mocked(taskApi.listTasks).mockResolvedValue(page([]))
    const { wrapper } = setup()

    const { result } = renderHook(() => useDueSoonTasks(7), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(vi.mocked(taskApi.listTasks).mock.calls[0]?.[0]).toMatchObject({
      open: true,
      sort: 'dueDate',
      dueBefore: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })
})

describe('useMoveTask', () => {
  function seed(client: QueryClient) {
    client.setQueryData<ColumnData>(taskKeys.column('todo', {}), {
      pageParams: [1],
      pages: [page([task('a'), task('b')])],
    })
    client.setQueryData<ColumnData>(taskKeys.column('done', {}), {
      pageParams: [1],
      pages: [page([task('x', 'done')])],
    })
  }

  it('moves the card in the cache immediately, then refetches', async () => {
    let finish: (value: Task) => void = () => {}
    vi.mocked(taskApi.moveTask).mockReturnValue(new Promise<Task>((resolve) => (finish = resolve)))
    vi.mocked(taskApi.listTasks).mockResolvedValue(page([]))
    const { client, wrapper } = setup()
    seed(client)
    const { result } = renderHook(() => useMoveTask(), { wrapper })

    act(() => {
      result.current.mutate({ task: task('a'), toStatus: 'done', toIndex: 0, filters: {}, beforeId: 'x' })
    })

    await waitFor(() => expect(ids(client, 'done')).toEqual(['a', 'x']))
    expect(ids(client, 'todo')).toEqual(['b'])
    expect(vi.mocked(taskApi.moveTask).mock.calls[0]).toEqual([
      'a',
      { status: 'done', afterId: undefined, beforeId: 'x' },
    ])

    finish(task('a', 'done'))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('rolls the board back and tells the user when the server refuses the move', async () => {
    vi.mocked(taskApi.moveTask).mockRejectedValue(new Error('Network Error'))
    vi.mocked(taskApi.listTasks).mockResolvedValue(page([]))
    const { client, wrapper } = setup()
    seed(client)
    const { result } = renderHook(() => useMoveTask(), { wrapper })

    act(() => {
      result.current.mutate({ task: task('a'), toStatus: 'done', toIndex: 1, filters: {} })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(useToastStore.getState().toasts[0]).toMatchObject({ kind: 'error' })
    expect(useToastStore.getState().toasts[0]?.message).toMatch(/could not move/i)
  })
})
```

Run: `npx vitest run src/features/tasks/api/hooks.test.tsx` → FAIL (module missing).

- [ ] **Step 2: Implement the hooks**

`frontend/src/features/tasks/api/hooks.ts`:

```ts
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getErrorMessage } from '@/shared/api/httpClient'
import { addDaysIso, todayIso } from '@/shared/lib/dates'
import { pushToast } from '@/shared/ui/toast'
import { insertTask, removeTask, type ColumnData } from '../boardCache'
import type { BoardFilters, Task, TaskStatus } from '../types'
import { createTask, deleteTask, fetchTags, listTasks, moveTask, updateTask } from './taskApi'
import { taskKeys } from './taskKeys'

const PAGE_SIZE = 50

export function useColumnTasks(status: TaskStatus, filters: BoardFilters) {
  return useInfiniteQuery({
    queryKey: taskKeys.column(status, filters),
    queryFn: ({ pageParam }) => listTasks({ status, ...filters, page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
  })
}

export function useTags() {
  return useQuery({ queryKey: taskKeys.tags, queryFn: fetchTags })
}

/** Open tasks due within the next `days` days, or already overdue. For the dashboard. */
export function useDueSoonTasks(days = 7) {
  return useQuery({
    queryKey: taskKeys.dueSoon(days),
    queryFn: () =>
      listTasks({
        open: true,
        dueBefore: addDaysIso(todayIso(), days),
        sort: 'dueDate',
        limit: 50,
      }),
  })
}

export function useCreateTask() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: createTask,
    onSuccess: () => client.invalidateQueries({ queryKey: taskKeys.all }),
  })
}

export function useUpdateTask() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateTask>[1] }) =>
      updateTask(id, input),
    onSuccess: () => client.invalidateQueries({ queryKey: taskKeys.all }),
  })
}

export function useDeleteTask() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: deleteTask,
    onSuccess: () => client.invalidateQueries({ queryKey: taskKeys.all }),
  })
}

interface MoveVariables {
  task: Task
  toStatus: TaskStatus
  /** Final index in the destination column, as reported by the drag library. */
  toIndex: number
  filters: BoardFilters
  afterId?: string
  beforeId?: string
}

/** Moves a card in the cache at once, rolls back if the server refuses, and always refetches. */
export function useMoveTask() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: ({ task, toStatus, afterId, beforeId }: MoveVariables) =>
      moveTask(task.id, { status: toStatus, afterId, beforeId }),

    onMutate: async ({ task, toStatus, toIndex, filters }) => {
      await client.cancelQueries({ queryKey: taskKeys.columns })
      const fromKey = taskKeys.column(task.status, filters)
      const toKey = taskKeys.column(toStatus, filters)
      const previous = [
        { key: fromKey, data: client.getQueryData<ColumnData>(fromKey) },
        { key: toKey, data: client.getQueryData<ColumnData>(toKey) },
      ]

      client.setQueryData<ColumnData>(fromKey, (data) => data && removeTask(data, task.id))
      client.setQueryData<ColumnData>(
        toKey,
        (data) => data && insertTask(data, { ...task, status: toStatus }, toIndex),
      )
      return { previous }
    },

    onError: (error, _variables, context) => {
      for (const { key, data } of context?.previous ?? []) client.setQueryData(key, data)
      pushToast(`Could not move the task. ${getErrorMessage(error)}`, 'error')
    },

    onSettled: () => client.invalidateQueries({ queryKey: taskKeys.all }),
  })
}
```

Run: `npx vitest run src/features/tasks/api/hooks.test.tsx` → PASS.

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(tasks): add task query hooks with optimistic drag and rollback" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Task card, form modal and board toolbar

**Files:**
- Create: `frontend/src/features/tasks/components/TaskCard.tsx`, `TaskCard.test.tsx`, `TaskFormModal.tsx`, `TaskFormModal.test.tsx`, `BoardToolbar.tsx`, `BoardToolbar.test.tsx`, `frontend/src/features/tasks/tasks.css`

**Interfaces:**
- Produces: `TaskCard({ task })` (presentational: title, priority chip, due date, overdue badge, tags); `TaskFormModal({ mode, onClose })` with `mode: { kind: 'create'; status: TaskStatus } | { kind: 'edit'; task: Task }` (exported type `TaskFormMode`); `BoardToolbar({ filters, onChange, onNew })`.

- [ ] **Step 1: Write the failing TaskCard test**

`frontend/src/features/tasks/components/TaskCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Task } from '../types'
import { TaskCard } from './TaskCard'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: '1',
    title: 'Pay rent',
    description: '',
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    tags: [],
    position: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('TaskCard', () => {
  it('shows the title, priority and tags', () => {
    render(<TaskCard task={task({ priority: 'high', tags: ['home', 'bills'] })} />)

    expect(screen.getByText('Pay rent')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('home')).toBeInTheDocument()
    expect(screen.getByText('bills')).toBeInTheDocument()
  })

  it('shows the due date without a badge when it is in the future', () => {
    render(<TaskCard task={task({ dueDate: '2999-12-31' })} />)

    expect(screen.getByText(/Dec 31, 2999|31 Dec 2999/)).toBeInTheDocument()
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument()
  })

  it('badges a task whose due date has passed', () => {
    render(<TaskCard task={task({ dueDate: '2000-01-01' })} />)

    expect(screen.getByText('Overdue')).toBeInTheDocument()
  })

  it('does not badge a finished task even when its due date has passed', () => {
    render(<TaskCard task={task({ dueDate: '2000-01-01', status: 'done' })} />)

    expect(screen.queryByText('Overdue')).not.toBeInTheDocument()
  })

  it('omits the due line when there is no date', () => {
    render(<TaskCard task={task()} />)

    expect(screen.queryByText(/Due/)).not.toBeInTheDocument()
  })
})
```

Run → FAIL. Implement `frontend/src/features/tasks/components/TaskCard.tsx`:

```tsx
import { formatDate, todayIso } from '@/shared/lib/dates'
import { PRIORITY_LABELS, type Task } from '../types'
import '../tasks.css'

export function TaskCard({ task }: { task: Task }) {
  const overdue = task.status !== 'done' && task.dueDate !== null && task.dueDate < todayIso()

  return (
    <div className="task-card__body">
      <div className="task-card__top">
        <span className="task-card__title">{task.title}</span>
        <span className={`chip chip--priority-${task.priority}`}>{PRIORITY_LABELS[task.priority]}</span>
      </div>
      {task.dueDate && (
        <div className={`task-card__due${overdue ? ' is-overdue' : ''}`}>
          Due {formatDate(task.dueDate)}
          {overdue && <span className="chip chip--danger">Overdue</span>}
        </div>
      )}
      {task.tags.length > 0 && (
        <ul className="task-card__tags" aria-label="Tags">
          {task.tags.map((tag) => (
            <li key={tag} className="chip">
              {tag}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

The "Due" text query in the last test uses `/Due/`; in the third test `getByText('Overdue')` must not match "Due …" text, and it does not because the text node "Overdue" is its own element.

Run → PASS.

- [ ] **Step 2: Write the failing TaskFormModal test**

`frontend/src/features/tasks/components/TaskFormModal.test.tsx`:

```tsx
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as taskApi from '../api/taskApi'
import type { Task } from '../types'
import { TaskFormModal } from './TaskFormModal'

vi.mock('../api/taskApi')

const existing: Task = {
  id: 't1',
  title: 'Pay rent',
  description: 'before the 1st',
  status: 'in_progress',
  priority: 'high',
  dueDate: '2026-10-01',
  tags: ['home', 'bills'],
  position: 0,
  createdAt: '',
  updatedAt: '',
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(taskApi.fetchTags).mockResolvedValue(['home', 'work'])
})

describe('TaskFormModal (create)', () => {
  it('validates before calling the API', async () => {
    renderWithProviders(<TaskFormModal mode={{ kind: 'create', status: 'todo' }} onClose={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Create task' }))

    expect(await screen.findByText('Enter a title')).toBeInTheDocument()
    expect(taskApi.createTask).not.toHaveBeenCalled()
  })

  it('creates a task in the column it was opened from and closes', async () => {
    vi.mocked(taskApi.createTask).mockResolvedValue(existing)
    const onClose = vi.fn()
    renderWithProviders(<TaskFormModal mode={{ kind: 'create', status: 'in_progress' }} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Title'), 'Call the dentist')
    await userEvent.selectOptions(screen.getByLabelText(/^priority/i), 'high')
    await userEvent.type(screen.getByLabelText('Due date'), '2026-10-05')
    await userEvent.type(screen.getByLabelText('Tags'), 'Health, home')
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(taskApi.createTask).mock.calls[0]?.[0]).toEqual({
      title: 'Call the dentist',
      description: '',
      priority: 'high',
      dueDate: '2026-10-05',
      tags: ['health', 'home'],
      status: 'in_progress',
    })
  })

  it('keeps the dialog open and shows the server message when creation fails', async () => {
    vi.mocked(taskApi.createTask).mockRejectedValue(new Error('Network Error'))
    const onClose = vi.fn()
    renderWithProviders(<TaskFormModal mode={{ kind: 'create', status: 'todo' }} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Title'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }))

    expect(await screen.findByText('Network Error')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('TaskFormModal (edit)', () => {
  it('fills the form from the task and saves only through update', async () => {
    vi.mocked(taskApi.updateTask).mockResolvedValue(existing)
    renderWithProviders(<TaskFormModal mode={{ kind: 'edit', task: existing }} onClose={() => {}} />)

    expect(screen.getByLabelText('Title')).toHaveValue('Pay rent')
    expect(screen.getByLabelText('Tags')).toHaveValue('home, bills')
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await vi.waitFor(() => expect(taskApi.updateTask).toHaveBeenCalled())
    expect(vi.mocked(taskApi.updateTask).mock.calls[0]).toEqual([
      't1',
      {
        title: 'Pay rent',
        description: 'before the 1st',
        priority: 'high',
        dueDate: null,
        tags: ['home', 'bills'],
      },
    ])
    expect(taskApi.createTask).not.toHaveBeenCalled()
  })

  it('asks for confirmation before deleting', async () => {
    vi.mocked(taskApi.deleteTask).mockResolvedValue()
    const onClose = vi.fn()
    renderWithProviders(<TaskFormModal mode={{ kind: 'edit', task: existing }} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    expect(taskApi.deleteTask).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.getByRole('button', { name: 'Delete task' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(taskApi.deleteTask).mock.calls[0]?.[0]).toBe('t1')
  })
})
```

Run → FAIL (module missing).

- [ ] **Step 3: Implement TaskFormModal**

`frontend/src/features/tasks/components/TaskFormModal.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { FormField } from '@/shared/ui/FormField'
import { Modal } from '@/shared/ui/Modal'
import { pushToast } from '@/shared/ui/toast'
import { useCreateTask, useDeleteTask, useTags, useUpdateTask } from '../api/hooks'
import { taskFormSchema, toFormValues, toTaskInput, type TaskFormValues } from '../taskForm'
import { PRIORITY_LABELS, TASK_PRIORITIES, type Task, type TaskStatus } from '../types'
import '../tasks.css'

export type TaskFormMode = { kind: 'create'; status: TaskStatus } | { kind: 'edit'; task: Task }

interface TaskFormModalProps {
  mode: TaskFormMode
  onClose: () => void
}

export function TaskFormModal({ mode, onClose }: TaskFormModalProps) {
  const editing = mode.kind === 'edit'
  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const { data: knownTags = [] } = useTags()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: toFormValues(editing ? mode.task : undefined),
  })

  const saving = createTask.isPending || updateTask.isPending
  const failure = createTask.error ?? updateTask.error ?? deleteTask.error

  function onSubmit(values: TaskFormValues) {
    const input = toTaskInput(values)
    if (mode.kind === 'edit') {
      updateTask.mutate(
        { id: mode.task.id, input },
        {
          onSuccess: () => {
            pushToast('Task saved', 'success')
            onClose()
          },
        },
      )
    } else {
      createTask.mutate({ ...input, status: mode.status }, { onSuccess: onClose })
    }
  }

  function onDelete() {
    if (mode.kind !== 'edit') return
    deleteTask.mutate(mode.task.id, {
      onSuccess: () => {
        pushToast('Task deleted', 'success')
        onClose()
      },
    })
  }

  return (
    <Modal title={editing ? 'Edit task' : 'New task'} onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField label="Title" error={errors.title?.message}>
          <input {...register('title')} />
        </FormField>
        <FormField label="Description" error={errors.description?.message}>
          <textarea rows={3} {...register('description')} />
        </FormField>
        <div className="form-row">
          <FormField label="Priority">
            <select {...register('priority')}>
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Due date" error={errors.dueDate?.message}>
            <input type="date" {...register('dueDate')} />
          </FormField>
        </div>
        <FormField label="Tags" error={errors.tags?.message} hint="Separate with commas">
          <input list="known-tags" {...register('tags')} />
        </FormField>
        <datalist id="known-tags">
          {knownTags.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>

        {failure && <p className="form-error">{getErrorMessage(failure)}</p>}

        <div className="form-actions">
          {mode.kind === 'edit' &&
            (confirmingDelete ? (
              <>
                <Button variant="danger" onClick={onDelete} loading={deleteTask.isPending}>
                  Yes, delete
                </Button>
                <Button onClick={() => setConfirmingDelete(false)}>Keep it</Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                Delete task
              </Button>
            ))}
          <Button type="submit" variant="primary" loading={saving}>
            {editing ? 'Save changes' : 'Create task'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
```

Run: `npx vitest run src/features/tasks/components/TaskFormModal.test.tsx` → PASS.

- [ ] **Step 4: Write the failing BoardToolbar test and implement it**

`frontend/src/features/tasks/components/BoardToolbar.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as taskApi from '../api/taskApi'
import { BoardToolbar } from './BoardToolbar'

vi.mock('../api/taskApi')

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(taskApi.fetchTags).mockResolvedValue(['home', 'work'])
})

describe('BoardToolbar', () => {
  it('filters by the chosen tag', async () => {
    const onChange = vi.fn()
    renderWithProviders(<BoardToolbar filters={{}} onChange={onChange} onNew={() => {}} />)
    await screen.findByRole('option', { name: 'work' })

    await userEvent.selectOptions(screen.getByLabelText('Filter by tag'), 'work')

    expect(onChange).toHaveBeenLastCalledWith({ tag: 'work' })
  })

  it('clears the tag filter but keeps the search', async () => {
    const onChange = vi.fn()
    renderWithProviders(
      <BoardToolbar filters={{ tag: 'work', q: 'milk' }} onChange={onChange} onNew={() => {}} />,
    )
    await screen.findByRole('option', { name: 'work' })

    await userEvent.selectOptions(screen.getByLabelText('Filter by tag'), '')

    expect(onChange).toHaveBeenLastCalledWith({ q: 'milk' })
  })

  it('searches when the form is submitted, keeping the tag filter', async () => {
    const onChange = vi.fn()
    renderWithProviders(<BoardToolbar filters={{ tag: 'home' }} onChange={onChange} onNew={() => {}} />)

    await userEvent.type(screen.getByLabelText('Search tasks'), 'milk{Enter}')

    expect(onChange).toHaveBeenLastCalledWith({ tag: 'home', q: 'milk' })
  })

  it('drops a blank search', async () => {
    const onChange = vi.fn()
    renderWithProviders(<BoardToolbar filters={{ q: 'milk' }} onChange={onChange} onNew={() => {}} />)

    await userEvent.clear(screen.getByLabelText('Search tasks'))
    await userEvent.type(screen.getByLabelText('Search tasks'), '   {Enter}')

    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('opens the new-task dialog', async () => {
    const onNew = vi.fn()
    renderWithProviders(<BoardToolbar filters={{}} onChange={() => {}} onNew={onNew} />)

    await userEvent.click(screen.getByRole('button', { name: 'New task' }))

    expect(onNew).toHaveBeenCalledTimes(1)
  })
})
```

`frontend/src/features/tasks/components/BoardToolbar.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { Button } from '@/shared/ui/Button'
import { useTags } from '../api/hooks'
import type { BoardFilters } from '../types'
import '../tasks.css'

interface BoardToolbarProps {
  filters: BoardFilters
  onChange: (filters: BoardFilters) => void
  onNew: () => void
}

export function BoardToolbar({ filters, onChange, onNew }: BoardToolbarProps) {
  const { data: tags = [] } = useTags()
  const [search, setSearch] = useState(filters.q ?? '')

  function applySearch(event: FormEvent) {
    event.preventDefault()
    const q = search.trim()
    onChange({ ...(filters.tag ? { tag: filters.tag } : {}), ...(q ? { q } : {}) })
  }

  function applyTag(tag: string) {
    onChange({ ...(tag ? { tag } : {}), ...(filters.q ? { q: filters.q } : {}) })
  }

  return (
    <div className="board-toolbar">
      <form role="search" onSubmit={applySearch}>
        <input
          type="search"
          aria-label="Search tasks"
          placeholder="Search tasks"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button type="submit">Search</Button>
      </form>
      <select
        aria-label="Filter by tag"
        value={filters.tag ?? ''}
        onChange={(event) => applyTag(event.target.value)}
      >
        <option value="">All tags</option>
        {tags.map((tag) => (
          <option key={tag} value={tag}>
            {tag}
          </option>
        ))}
      </select>
      <Button variant="primary" onClick={onNew}>
        New task
      </Button>
    </div>
  )
}
```

The search box is deliberately submit-only: it avoids a request per keystroke and keeps the tests free of timers.

- [ ] **Step 5: Add the styles**

Create `frontend/src/features/tasks/tasks.css`:

```css
.chip {
  display: inline-block;
  padding: 0 var(--space-2);
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--accent);
  font-size: 0.75rem;
  line-height: 1.6;
}
.chip--priority-high,
.chip--danger {
  background: var(--danger-bg);
  color: var(--danger);
}
.chip--priority-low {
  color: var(--text-muted);
}

.task-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.task-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
}
.task-card__title {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.task-card__due {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 0.85rem;
  color: var(--text-muted);
}
.task-card__due.is-overdue {
  color: var(--danger);
}
.task-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.board-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.board-toolbar form {
  display: flex;
  gap: var(--space-2);
}
.board-toolbar input,
.board-toolbar select {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text);
  font: inherit;
}
.board-toolbar .btn--primary {
  margin-left: auto;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}
.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
}
.form-actions > :first-child:not([type='submit']) {
  margin-right: auto;
}
.form-error {
  color: var(--danger);
}

.board {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(260px, 1fr);
  gap: var(--space-4);
  overflow-x: auto;
  padding-bottom: var(--space-2);
}
.column {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: var(--space-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.column__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.column__header h2 {
  margin: 0;
  font-size: 1rem;
}
.column__count {
  margin-right: auto;
}
.column__list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 120px;
  border-radius: var(--radius);
}
.column__list.is-over {
  background: var(--surface-2);
}
.task-card {
  padding: var(--space-3);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: grab;
}
.task-card.is-dragging {
  border-color: var(--accent);
}
```

- [ ] **Step 6: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(tasks): add task card, form modal and board toolbar" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: The board, the page and navigation

**Files:**
- Create: `frontend/src/features/tasks/components/BoardColumn.tsx`, `components/TaskBoard.tsx`, `pages/BoardPage.tsx`, `pages/BoardPage.test.tsx`, `routes.ts`, `index.ts`
- Modify: `frontend/src/app/navigation.ts`, `frontend/src/app/router.ts`

**Interfaces:**
- Produces (from `@/features/tasks`): `taskRoutes: RouteObject[]` (path `board`), `useDueSoonTasks`.

- [ ] **Step 1: Write the failing page tests**

`frontend/src/features/tasks/pages/BoardPage.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as taskApi from '../api/taskApi'
import type { Task, TaskPage, TaskStatus } from '../types'
import BoardPage from './BoardPage'

vi.mock('../api/taskApi')

function task(id: string, status: TaskStatus, title = id): Task {
  return {
    id,
    title,
    description: '',
    status,
    priority: 'medium',
    dueDate: null,
    tags: [],
    position: 0,
    createdAt: '',
    updatedAt: '',
  }
}

const page = (items: Task[], total = items.length): TaskPage => ({ items, page: 1, limit: 50, total })

function serve(byStatus: Partial<Record<TaskStatus, Task[]>>) {
  vi.mocked(taskApi.listTasks).mockImplementation(async (params) =>
    page(byStatus[params.status ?? 'todo'] ?? []),
  )
}

const column = (name: string) => screen.getByRole('region', { name })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(taskApi.fetchTags).mockResolvedValue(['home', 'work'])
})

describe('BoardPage', () => {
  it('shows the three columns with their cards and counts', async () => {
    serve({
      todo: [task('1', 'todo', 'Buy milk'), task('2', 'todo', 'Call mum')],
      in_progress: [task('3', 'in_progress', 'Write report')],
      done: [],
    })

    renderWithProviders(<BoardPage />)

    expect(await within(column('To Do')).findByText('Buy milk')).toBeInTheDocument()
    expect(within(column('To Do')).getByText('Call mum')).toBeInTheDocument()
    expect(within(column('In Progress')).getByText('Write report')).toBeInTheDocument()
    expect(within(column('To Do')).getByText('2')).toBeInTheDocument()
  })

  it('says so when a column is empty', async () => {
    serve({ todo: [task('1', 'todo')] })

    renderWithProviders(<BoardPage />)

    expect(await within(column('Done')).findByText('Nothing here yet')).toBeInTheDocument()
  })

  it('shows a loading state while a column loads', () => {
    vi.mocked(taskApi.listTasks).mockReturnValue(new Promise(() => {}))

    renderWithProviders(<BoardPage />)

    expect(within(column('To Do')).getByRole('status')).toHaveTextContent('Loading')
  })

  it('shows an error with a retry for a column that failed, without breaking the others', async () => {
    vi.mocked(taskApi.listTasks).mockImplementation(async (params) => {
      if (params.status === 'done') throw new Error('boom')
      return page([task('1', params.status ?? 'todo', `card ${params.status}`)])
    })

    renderWithProviders(<BoardPage />)

    expect(await within(column('Done')).findByRole('alert')).toBeInTheDocument()
    expect(within(column('To Do')).getByText('card todo')).toBeInTheDocument()
    expect(within(column('Done')).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('offers to load more when a column has further pages, and asks for the next page', async () => {
    vi.mocked(taskApi.listTasks).mockImplementation(async (params) =>
      params.status === 'todo'
        ? { items: [task('1', 'todo')], page: params.page ?? 1, limit: 1, total: 2 }
        : page([]),
    )
    renderWithProviders(<BoardPage />)

    await userEvent.click(await within(column('To Do')).findByRole('button', { name: 'Load more' }))

    const todoPages = vi
      .mocked(taskApi.listTasks)
      .mock.calls.filter(([params]) => params.status === 'todo')
      .map(([params]) => params.page)
    expect(todoPages).toContain(2)
  })

  it('filters every column by the chosen tag', async () => {
    serve({ todo: [task('1', 'todo')] })
    renderWithProviders(<BoardPage />)

    await userEvent.selectOptions(await screen.findByLabelText('Filter by tag'), 'work')

    await vi.waitFor(() => {
      const withTag = vi.mocked(taskApi.listTasks).mock.calls.filter(([params]) => params.tag === 'work')
      expect([...new Set(withTag.map(([params]) => params.status))].sort()).toEqual([
        'done',
        'in_progress',
        'todo',
      ])
    })
  })

  it('searches every column by title', async () => {
    serve({})
    renderWithProviders(<BoardPage />)

    await userEvent.type(screen.getByLabelText('Search tasks'), 'milk{Enter}')

    await vi.waitFor(() =>
      expect(vi.mocked(taskApi.listTasks).mock.calls.some(([params]) => params.q === 'milk')).toBe(true),
    )
  })

  it('opens the new-task dialog for the column whose plus button was used', async () => {
    serve({})
    renderWithProviders(<BoardPage />)

    await userEvent.click(within(column('In Progress')).getByRole('button', { name: 'Add task to In Progress' }))
    await userEvent.type(screen.getByLabelText('Title'), 'Ship it')
    vi.mocked(taskApi.createTask).mockResolvedValue(task('9', 'in_progress', 'Ship it'))
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await vi.waitFor(() => expect(taskApi.createTask).toHaveBeenCalled())
    expect(vi.mocked(taskApi.createTask).mock.calls[0]?.[0]).toMatchObject({
      title: 'Ship it',
      status: 'in_progress',
    })
  })

  it('opens a card for editing when it is clicked', async () => {
    serve({ todo: [task('1', 'todo', 'Buy milk')] })
    renderWithProviders(<BoardPage />)

    await userEvent.click(await screen.findByText('Buy milk'))

    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Buy milk')
  })
})
```

Run: `npx vitest run src/features/tasks/pages/BoardPage.test.tsx` → FAIL (module missing).

- [ ] **Step 2: Implement the column**

`frontend/src/features/tasks/components/BoardColumn.tsx`:

```tsx
import { Draggable, Droppable } from '@hello-pangea/dnd'
import { Button } from '@/shared/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/StateViews'
import { useColumnTasks } from '../api/hooks'
import { flattenColumn } from '../boardCache'
import { STATUS_LABELS, type BoardFilters, type Task, type TaskStatus } from '../types'
import { TaskCard } from './TaskCard'
import '../tasks.css'

interface BoardColumnProps {
  status: TaskStatus
  filters: BoardFilters
  onOpen: (task: Task) => void
  onAdd: (status: TaskStatus) => void
}

export function BoardColumn({ status, filters, onOpen, onAdd }: BoardColumnProps) {
  const query = useColumnTasks(status, filters)
  const label = STATUS_LABELS[status]
  const tasks = flattenColumn(query.data)
  const total = query.data?.pages[0]?.total ?? 0

  return (
    <section className="column" aria-label={label}>
      <header className="column__header">
        <h2>{label}</h2>
        <span className="column__count muted">{total}</span>
        <Button variant="ghost" onClick={() => onAdd(status)} aria-label={`Add task to ${label}`}>
          +
        </Button>
      </header>

      {query.isPending && <LoadingState label="Loading…" />}
      {query.isError && <ErrorState message="Could not load this column" onRetry={() => query.refetch()} />}

      {query.isSuccess && (
        <Droppable droppableId={status}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`column__list${snapshot.isDraggingOver ? ' is-over' : ''}`}
            >
              {tasks.length === 0 && !snapshot.isDraggingOver && (
                <EmptyState title="Nothing here yet" description="Drag a card here or add one." />
              )}
              {tasks.map((task, index) => (
                <Draggable key={task.id} draggableId={task.id} index={index}>
                  {(drag, dragSnapshot) => (
                    <div
                      ref={drag.innerRef}
                      {...drag.draggableProps}
                      {...drag.dragHandleProps}
                      className={`task-card${dragSnapshot.isDragging ? ' is-dragging' : ''}`}
                      onClick={() => onOpen(task)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') onOpen(task)
                      }}
                    >
                      <TaskCard task={task} />
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      )}

      {query.hasNextPage && (
        <Button onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>
          Load more
        </Button>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Implement the board and the page**

`frontend/src/features/tasks/components/TaskBoard.tsx`:

```tsx
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { useQueryClient } from '@tanstack/react-query'
import { useMoveTask } from '../api/hooks'
import { taskKeys } from '../api/taskKeys'
import { flattenColumn, neighboursFor, type ColumnData } from '../boardCache'
import { isTaskStatus, TASK_STATUSES, type BoardFilters, type Task, type TaskStatus } from '../types'
import { BoardColumn } from './BoardColumn'
import '../tasks.css'

interface TaskBoardProps {
  filters: BoardFilters
  onOpen: (task: Task) => void
  onAdd: (status: TaskStatus) => void
}

export function TaskBoard({ filters, onOpen, onAdd }: TaskBoardProps) {
  const client = useQueryClient()
  const { mutate: moveTask } = useMoveTask()

  const columnItems = (status: TaskStatus) =>
    flattenColumn(client.getQueryData<ColumnData>(taskKeys.column(status, filters)))

  function handleDragEnd({ source, destination, draggableId }: DropResult) {
    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return
    if (!isTaskStatus(source.droppableId) || !isTaskStatus(destination.droppableId)) return

    const task = columnItems(source.droppableId).find((item) => item.id === draggableId)
    if (!task) return

    const { afterId, beforeId } = neighboursFor(
      columnItems(destination.droppableId),
      task.id,
      destination.index,
    )
    moveTask({ task, toStatus: destination.droppableId, toIndex: destination.index, filters, afterId, beforeId })
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="board">
        {TASK_STATUSES.map((status) => (
          <BoardColumn key={status} status={status} filters={filters} onOpen={onOpen} onAdd={onAdd} />
        ))}
      </div>
    </DragDropContext>
  )
}
```

`frontend/src/features/tasks/pages/BoardPage.tsx`:

```tsx
import { useState } from 'react'
import { BoardToolbar } from '../components/BoardToolbar'
import { TaskBoard } from '../components/TaskBoard'
import { TaskFormModal, type TaskFormMode } from '../components/TaskFormModal'
import type { BoardFilters } from '../types'

export default function BoardPage() {
  const [filters, setFilters] = useState<BoardFilters>({})
  const [modal, setModal] = useState<TaskFormMode | null>(null)

  return (
    <div>
      <h1>Board</h1>
      <BoardToolbar
        filters={filters}
        onChange={setFilters}
        onNew={() => setModal({ kind: 'create', status: 'todo' })}
      />
      <TaskBoard
        filters={filters}
        onOpen={(task) => setModal({ kind: 'edit', task })}
        onAdd={(status) => setModal({ kind: 'create', status })}
      />
      {modal && <TaskFormModal mode={modal} onClose={() => setModal(null)} />}
    </div>
  )
}
```

Run: `npx vitest run src/features/tasks/pages/BoardPage.test.tsx` → PASS.

- [ ] **Step 4: Add the routes, the public API and the navigation**

`frontend/src/features/tasks/routes.ts`:

```ts
import type { RouteObject } from 'react-router'

export const taskRoutes: RouteObject[] = [
  {
    path: 'board',
    lazy: async () => ({ Component: (await import('./pages/BoardPage')).default }),
  },
]
```

`frontend/src/features/tasks/index.ts`:

```ts
export { useDueSoonTasks } from './api/hooks'
export { taskRoutes } from './routes'
```

In `frontend/src/app/navigation.ts` add `{ to: '/board', label: 'Board' }` after the Dashboard entry. In `frontend/src/app/router.ts` add `import { taskRoutes } from '@/features/tasks'` and change the shell's children to `[...dashboardRoutes, ...taskRoutes]`.

- [ ] **Step 5: Run all checks**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat(tasks): add the Kanban board page with filters and navigation" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Real-browser check and milestone wrap-up

Drag and drop, keyboard operation and the layout cannot be proven in jsdom, so check them by hand.

- [ ] **Step 1: Start the apps** (see M1 Task 13 for MongoDB, Mailpit and `.env`), register and log in.

- [ ] **Step 2: Walk the board**

| Do this | Expect |
|---|---|
| Open **Board** from the sidebar | Three empty columns with "Nothing here yet" |
| Add 3 tasks to To Do with **+** and **New task** | New cards appear at the top of the column |
| Drag a card to In Progress, then reload | It stays there |
| Reorder cards inside a column, reload | Order persists |
| Focus a card with Tab, press Space, use arrow keys, press Space | The card moves (keyboard drag works) and the move is announced |
| Press Enter on a focused card | The edit dialog opens |
| Give a task a past due date | An **Overdue** badge shows; moving it to Done removes the badge |
| Add tags, use the tag filter and search | Every column narrows to matching cards |
| Delete a task | Asked to confirm; then it disappears |
| Open the board in two tabs, delete a card in tab A, then drag its neighbour in tab B | A toast says the move failed and tab B refreshes to the true state |
| Shrink the window to about 400 px | Columns scroll sideways, nothing overflows the page |
| Toggle the light theme | Cards, chips and the overdue colour stay readable |

- [ ] **Step 3: Run the complete checks and finish the branch**

```bash
(cd backend && npm run lint && npm run typecheck && npm test && npm run build)
(cd frontend && npm run lint && npm run typecheck && npm test && npm run build)
git status
```

Expected: everything passes, tree clean. Then REQUIRED SUB-SKILL: use superpowers:finishing-a-development-branch to merge `feature/tasks-board` into `main`.
