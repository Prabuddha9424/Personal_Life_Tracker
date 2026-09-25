import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/shared/ui/Button'
import { FormField } from '@/shared/ui/FormField'
import { Modal } from '@/shared/ui/Modal'
import { ErrorState, LoadingState } from '@/shared/ui/StateViews'
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useRenameCategory,
} from '../api/hooks'
import { describeSaveError } from '../saveError'
import type { Category, TransactionKind } from '../types'
import '../finance.css'

const MAX_NAME_LENGTH = 40
const KIND_LABELS: Record<TransactionKind, string> = { expense: 'Expense', income: 'Income' }

/** The message for a name the server would refuse, or null. Blank spaces around it do not count. */
function nameProblem(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'Enter a name'
  if (trimmed.length > MAX_NAME_LENGTH) return `Use at most ${MAX_NAME_LENGTH} characters`
  return null
}

interface CategoryRowProps {
  category: Category
  deleting: boolean
  deleteFailure: string | null
  onDelete: (category: Category) => void
  onKeep: () => void
  onWorkStart: () => void
  onWorkEnd: () => void
}

function CategoryRow({
  category,
  deleting,
  deleteFailure,
  onDelete,
  onKeep,
  onWorkStart,
  onWorkEnd,
}: CategoryRowProps) {
  const rename = useRenameCategory()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [name, setName] = useState(category.name)
  const [nameError, setNameError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRef = useRef<HTMLLIElement>(null)
  const wasEditing = useRef(false)
  const wasConfirming = useRef(false)
  const questionId = useId()
  const inFlight = useRef(false)
  const messageId = useId()
  const message = nameError ?? (rename.error ? describeSaveError(rename.error) : deleteFailure)

  // Hand focus to the field when editing starts and back to the Rename button when it ends.
  useEffect(() => {
    if (editing) inputRef.current?.focus()
    else if (wasEditing.current) {
      rowRef.current?.querySelector<HTMLElement>('.category-row__rename')?.focus()
    }
    wasEditing.current = editing
  }, [editing])

  // The button that opened the question unmounts, so hand focus to the safe choice and give it
  // back to the Delete button when the person keeps the category.
  useEffect(() => {
    if (confirming) {
      rowRef.current?.querySelector<HTMLElement>('.category-row__keep')?.focus()
    } else if (wasConfirming.current) {
      rowRef.current?.querySelector<HTMLElement>('.category-row__delete')?.focus()
    }
    wasConfirming.current = confirming
  }, [confirming])

  function keep() {
    // Cancelling a running request would drop its result and leave the row stuck.
    if (deleting) return
    onKeep()
    setConfirming(false)
  }

  function startEditing() {
    rename.reset()
    setNameError(null)
    setName(category.name)
    setEditing(true)
  }

  function stopEditing() {
    rename.reset()
    setNameError(null)
    setEditing(false)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    rename.reset()
    const problem = nameProblem(name)
    setNameError(problem)
    if (problem) return
    const next = name.trim()
    // Only an exact match is "unchanged": a different capitalisation is a real rename.
    if (next === category.name) {
      setEditing(false)
      return
    }
    inFlight.current = true
    onWorkStart()
    rename.mutate(
      { id: category.id, name: next },
      {
        onSettled: () => {
          inFlight.current = false
          onWorkEnd()
        },
        onSuccess: () => setEditing(false),
      },
    )
  }

  return (
    <li ref={rowRef} className="category-row">
      {editing ? (
        <form onSubmit={onSubmit} noValidate>
          <input
            ref={inputRef}
            aria-label={`New name for ${category.name}`}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? messageId : undefined}
            value={name}
            disabled={rename.isPending}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" variant="primary" loading={rename.isPending}>
            Save name
          </Button>
          <Button onClick={stopEditing} disabled={rename.isPending}>
            Cancel
          </Button>
        </form>
      ) : confirming ? (
        <div
          className="category-row__confirm"
          role="group"
          aria-label={`Confirm deletion of ${category.name}`}
          aria-describedby={questionId}
        >
          <span id={questionId}>Delete &quot;{category.name}&quot;? This cannot be undone.</span>
          <Button className="category-row__keep" onClick={keep} disabled={deleting}>
            Keep it
          </Button>
          <Button
            variant="danger"
            aria-label={`Yes, delete ${category.name}`}
            loading={deleting}
            onClick={() => onDelete(category)}
          >
            Yes, delete
          </Button>
        </div>
      ) : (
        <>
          <span className="category-row__name">{category.name}</span>
          <Button
            className="category-row__rename"
            variant="ghost"
            aria-label={`Rename ${category.name}`}
            onClick={startEditing}
          >
            Rename
          </Button>
          <Button
            className="category-row__delete"
            variant="ghost"
            aria-label={`Delete ${category.name}`}
            onClick={() => setConfirming(true)}
          >
            Delete
          </Button>
        </>
      )}
      {message && (
        <p id={messageId} className="form-error" role="alert">
          {message}
        </p>
      )}
    </li>
  )
}

export function CategoryManager({ onClose }: { onClose: () => void }) {
  const query = useCategories()
  const create = useCreateCategory()
  const remove = useDeleteCategory()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<TransactionKind>('expense')
  const [nameError, setNameError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const headings = useRef<Record<TransactionKind, HTMLHeadingElement | null>>({
    expense: null,
    income: null,
  })
  const adding = useRef(false)
  const deleting = useRef(false)
  // How many changes are running. Closing mid-request would drop a failure that then goes unreported.
  const running = useRef(0)

  function startWork() {
    running.current += 1
  }

  function endWork() {
    running.current -= 1
  }

  function requestClose() {
    if (running.current === 0) onClose()
  }

  function onAdd(event: FormEvent) {
    event.preventDefault()
    if (adding.current) return
    create.reset()
    const problem = nameProblem(name)
    setNameError(problem)
    if (problem) return
    adding.current = true
    startWork()
    create.mutate(
      { name: name.trim(), kind },
      {
        onSettled: () => {
          adding.current = false
          endWork()
        },
        onSuccess: () => {
          setName('')
          nameRef.current?.focus()
        },
      },
    )
  }

  // The deleted row is gone, so leave focus on the heading of the list it was in.
  function onDelete(category: Category) {
    if (deleting.current) return
    deleting.current = true
    startWork()
    remove.mutate(category.id, {
      onSettled: () => {
        deleting.current = false
        endWork()
      },
      onSuccess: () => headings.current[category.kind]?.focus(),
    })
  }

  function onKeepCategory() {
    if (!deleting.current) remove.reset()
  }

  return (
    <Modal title="Categories" onClose={requestClose}>
      {!query.data && query.isPending && <LoadingState label="Loading categories…" />}
      {!query.data && query.isError && (
        <ErrorState message="Could not load categories" onRetry={() => query.refetch()} />
      )}
      {query.data &&
        (['expense', 'income'] as const).map((groupKind) => {
          const group = query.data.filter((category) => category.kind === groupKind)
          return (
            <div key={groupKind}>
              <h3
                tabIndex={-1}
                ref={(element) => {
                  headings.current[groupKind] = element
                }}
              >
                {KIND_LABELS[groupKind]}
              </h3>
              {group.length === 0 ? (
                <p className="muted">No {groupKind} categories yet</p>
              ) : (
                <ul className="category-list" aria-label={`${KIND_LABELS[groupKind]} categories`}>
                  {group.map((category) => (
                    <CategoryRow
                      key={category.id}
                      category={category}
                      deleting={remove.isPending && remove.variables === category.id}
                      deleteFailure={
                        remove.isError && remove.variables === category.id
                          ? describeSaveError(remove.error)
                          : null
                      }
                      onDelete={onDelete}
                      onKeep={onKeepCategory}
                      onWorkStart={startWork}
                      onWorkEnd={endWork}
                    />
                  ))}
                </ul>
              )}
            </div>
          )
        })}

      <form className="category-add" onSubmit={onAdd} noValidate>
        <FormField label="New category name" error={nameError ?? undefined}>
          <input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} />
        </FormField>
        <FormField label="Type">
          <select value={kind} onChange={(event) => setKind(event.target.value as TransactionKind)}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </FormField>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Add category
        </Button>
        {create.isError && (
          <p className="form-error" role="alert">
            {describeSaveError(create.error)}
          </p>
        )}
      </form>
    </Modal>
  )
}
