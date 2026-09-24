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
    ['an impossible calendar date', { dueDate: '2026-02-31' }, 'Use a valid date'],
    ['a non-leap-year Feb 29', { dueDate: '2027-02-29' }, 'Use a valid date'],
    [
      'a description over 5000 characters',
      { description: 'x'.repeat(5001) },
      'Use at most 5000 characters',
    ],
    ['11 tags', { tags: 'a,b,c,d,e,f,g,h,i,j,k' }, 'Use at most 10 tags'],
    ['a 31-character tag', { tags: 't'.repeat(31) }, 'Each tag can have at most 30 characters'],
  ])('rejects %s', (_name, override, message) => {
    const result = taskFormSchema.safeParse({ ...valid, ...override })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toContain(message)
  })
})

describe('taskFormSchema boundaries', () => {
  const valid = { title: 'Pay rent', description: '', priority: 'medium', dueDate: '', tags: '' }

  it.each([
    ['a real calendar date', { dueDate: '2026-02-28' }],
    ['a leap day', { dueDate: '2028-02-29' }],
    ['an empty date', { dueDate: '' }],
    ['a 200-character title', { title: 'x'.repeat(200) }],
    ['a 5000-character description', { description: 'x'.repeat(5000) }],
    ['exactly 10 tags', { tags: 'a,b,c,d,e,f,g,h,i,j' }],
    ['a 30-character tag', { tags: 't'.repeat(30) }],
    [
      '10 maximum-length tags',
      { tags: Array.from({ length: 10 }, (_v, i) => `${i}`.padEnd(30, 't')).join(', ') },
    ],
    [
      'many repeats of the same tag',
      { tags: Array.from({ length: 200 }, () => 'home').join(', ') },
    ],
  ])('accepts %s', (_name, override) => {
    expect(taskFormSchema.safeParse({ ...valid, ...override }).success).toBe(true)
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
