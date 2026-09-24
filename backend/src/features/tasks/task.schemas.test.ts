import { describe, expect, it } from 'vitest'
import {
  createTaskSchema,
  listTasksQuerySchema,
  moveTaskSchema,
  updateTaskSchema,
} from './task.schemas.ts'

describe('createTaskSchema', () => {
  it('applies defaults', () => {
    const parsed = createTaskSchema.parse({ title: '  Write tests  ' })
    expect(parsed).toEqual({
      title: 'Write tests',
      description: '',
      status: 'todo',
      priority: 'medium',
      tags: [],
    })
  })

  it('trims, lower-cases and de-duplicates tags', () => {
    const parsed = createTaskSchema.parse({ title: 'x', tags: [' Home ', 'HOME', 'home', 'Work'] })
    expect(parsed.tags).toEqual(['home', 'work'])
  })

  it('rejects 11 tags', () => {
    const tags = Array.from({ length: 11 }, (_, index) => `tag${index}`)
    expect(createTaskSchema.safeParse({ title: 'x', tags }).success).toBe(false)
  })

  it('rejects a 31-character tag and accepts 30', () => {
    expect(createTaskSchema.safeParse({ title: 'x', tags: ['a'.repeat(31)] }).success).toBe(false)
    expect(createTaskSchema.safeParse({ title: 'x', tags: ['a'.repeat(30)] }).success).toBe(true)
  })

  it('rejects a blank title and an invalid due date', () => {
    expect(createTaskSchema.safeParse({ title: '   ' }).success).toBe(false)
    expect(createTaskSchema.safeParse({ title: 'x', dueDate: '2026-02-30' }).success).toBe(false)
  })
})

describe('updateTaskSchema', () => {
  it('rejects an empty update', () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(false)
  })

  it('allows clearing the due date and ignores status and position', () => {
    expect(updateTaskSchema.parse({ dueDate: null, status: 'done', position: 5 })).toEqual({
      dueDate: null,
    })
  })
})

describe('moveTaskSchema', () => {
  it('requires a valid status and well-formed neighbour ids', () => {
    expect(moveTaskSchema.safeParse({ status: 'done' }).success).toBe(true)
    expect(moveTaskSchema.safeParse({ status: 'nope' }).success).toBe(false)
    expect(moveTaskSchema.safeParse({ status: 'done', afterId: 'not-an-id' }).success).toBe(false)
  })
})

describe('listTasksQuerySchema', () => {
  it('coerces pagination, parses open and defaults the sort', () => {
    expect(listTasksQuerySchema.parse({ open: 'true', limit: '10' })).toEqual({
      page: 1,
      limit: 10,
      open: true,
      sort: 'position',
    })
  })

  it('normalises the tag filter', () => {
    expect(listTasksQuerySchema.parse({ tag: ' Home ' }).tag).toBe('home')
  })
})
