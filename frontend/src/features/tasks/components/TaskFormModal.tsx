import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
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
  const actionsRef = useRef<HTMLDivElement>(null)
  const wasConfirming = useRef(false)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: toFormValues(editing ? mode.task : undefined),
  })

  const saving = createTask.isPending || updateTask.isPending
  const busy = saving || deleteTask.isPending
  const failure = createTask.error ?? updateTask.error ?? deleteTask.error

  // The button that opened the confirmation unmounts, so hand focus to the safe choice and give
  // it back to the delete button when the user backs out.
  useEffect(() => {
    if (confirmingDelete) {
      actionsRef.current?.querySelector<HTMLElement>('[role="group"] button')?.focus()
    } else if (wasConfirming.current) {
      actionsRef.current?.querySelector<HTMLElement>('.btn--danger')?.focus()
    }
    wasConfirming.current = confirmingDelete
  }, [confirmingDelete])

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

        {failure && (
          <p className="form-error" role="alert">
            {getErrorMessage(failure)}
          </p>
        )}

        <div className="form-actions" ref={actionsRef}>
          {mode.kind === 'edit' &&
            (confirmingDelete ? (
              <div className="form-actions__confirm" role="group" aria-label="Confirm deletion">
                <span>Delete this task? This cannot be undone.</span>
                <Button onClick={() => setConfirmingDelete(false)} disabled={deleteTask.isPending}>
                  Keep it
                </Button>
                <Button variant="danger" onClick={onDelete} loading={deleteTask.isPending}>
                  Yes, delete
                </Button>
              </div>
            ) : (
              <Button variant="danger" onClick={() => setConfirmingDelete(true)} disabled={busy}>
                Delete task
              </Button>
            ))}
          <Button type="submit" variant="primary" loading={saving} disabled={deleteTask.isPending}>
            {editing ? 'Save changes' : 'Create task'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
