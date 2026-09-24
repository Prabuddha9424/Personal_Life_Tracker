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
