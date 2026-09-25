import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useSessionUser } from '@/features/auth'
import { isValidCurrencyCode, minorUnitDigits } from '@/shared/lib/money'
import { Button } from '@/shared/ui/Button'
import { FormField } from '@/shared/ui/FormField'
import { Modal } from '@/shared/ui/Modal'
import { ErrorState, LoadingState } from '@/shared/ui/StateViews'
import { pushToast } from '@/shared/ui/toast'
import {
  useCategories,
  useCreateTransaction,
  useDeleteTransaction,
  useUpdateTransaction,
} from '../api/hooks'
import { describeSaveError } from '../saveError'
import {
  makeTransactionFormSchema,
  toFormValues,
  toTransactionInput,
  type TransactionFormValues,
} from '../transactionForm'
import type { Category, Transaction } from '../types'
import '../finance.css'

export type TransactionFormMode = { kind: 'create' } | { kind: 'edit'; transaction: Transaction }

interface TransactionFormModalProps {
  mode: TransactionFormMode
  onClose: () => void
}

/**
 * The form mounts only once the profile currency and the categories are known. The amount is
 * written in the currency's own scale (12.34 for USD, 1234 for JPY, 1.234 for BHD), so a form
 * that appeared before the currency would prefill an existing amount at the wrong scale, and a
 * select whose saved value is not among its options yet would lose the category on save.
 *
 * An edited transaction keeps the currency it was recorded in (the server never changes it), which
 * can differ from the profile currency if that was changed later.
 */
export function TransactionFormModal({ mode, onClose }: TransactionFormModalProps) {
  const profileCurrency = useSessionUser()?.currency
  const categories = useCategories()
  // The ref (not the mutation state) is the guard: it is set in the same tick as the submit.
  const inFlightRef = useRef(false)
  const currency = mode.kind === 'edit' ? mode.transaction.currency : profileCurrency

  // Closing mid-request would unmount the form and drop the per-call callbacks, so a failed save
  // would go unreported. Escape, the backdrop and the close button wait for the result.
  function requestClose() {
    if (!inFlightRef.current) onClose()
  }

  let body
  if (profileCurrency === undefined) {
    body = <LoadingState label="Loading your currency…" />
  } else if (currency === undefined || !isValidCurrencyCode(currency)) {
    body = <ErrorState message="Your profile currency is missing or invalid. Update it first." />
  } else if (categories.data) {
    body = (
      <TransactionForm
        mode={mode}
        currency={currency}
        categories={categories.data}
        inFlightRef={inFlightRef}
        onClose={onClose}
      />
    )
  } else if (categories.isError) {
    body = <ErrorState message="Could not load categories" onRetry={() => categories.refetch()} />
  } else {
    body = <LoadingState label="Loading categories…" />
  }

  return (
    <Modal
      title={mode.kind === 'edit' ? 'Edit transaction' : 'Add transaction'}
      onClose={requestClose}
    >
      {body}
    </Modal>
  )
}

interface TransactionFormProps {
  mode: TransactionFormMode
  currency: string
  categories: Category[]
  inFlightRef: RefObject<boolean>
  onClose: () => void
}

function TransactionForm({
  mode,
  currency,
  categories,
  inFlightRef,
  onClose,
}: TransactionFormProps) {
  const editing = mode.kind === 'edit'
  const createTransaction = useCreateTransaction()
  const updateTransaction = useUpdateTransaction()
  const deleteTransaction = useDeleteTransaction()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const actionsRef = useRef<HTMLDivElement>(null)
  const wasConfirming = useRef(false)
  const questionId = useId()
  const schema = useMemo(() => makeTransactionFormSchema(currency), [currency])
  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    setFocus,
    formState: { errors },
  } = useForm<TransactionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues(currency, mode, categories),
  })

  const kind = useWatch({ control, name: 'kind' })
  const selectedCategoryId = useWatch({ control, name: 'categoryId' })
  const options = categories.filter((category) => category.kind === kind)
  const categoryMissing =
    mode.kind === 'edit' &&
    selectedCategoryId === '' &&
    !categories.some(
      (category) =>
        category.id === mode.transaction.categoryId && category.kind === mode.transaction.kind,
    )
  const digits = minorUnitDigits(currency)

  const saving = createTransaction.isPending || updateTransaction.isPending
  const busy = saving || deleteTransaction.isPending
  const locked = confirmingDelete || busy
  const failure = createTransaction.error ?? updateTransaction.error ?? deleteTransaction.error

  // The dialog opened on its close button while the categories loaded.
  useEffect(() => {
    setFocus('amount')
  }, [setFocus])

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

  function clearFailures() {
    createTransaction.reset()
    updateTransaction.reset()
    deleteTransaction.reset()
  }

  function onFormSubmit(event: FormEvent<HTMLFormElement>) {
    if (!inFlightRef.current) clearFailures()
    return handleSubmit(onSubmit)(event)
  }

  function onSubmit(values: TransactionFormValues) {
    if (inFlightRef.current || confirmingDelete) return
    inFlightRef.current = true
    const input = toTransactionInput(values, currency)
    const settle = { onSettled: () => (inFlightRef.current = false) }
    if (mode.kind === 'edit') {
      updateTransaction.mutate(
        { id: mode.transaction.id, input },
        {
          ...settle,
          onSuccess: () => {
            pushToast('Transaction saved', 'success')
            onClose()
          },
        },
      )
    } else {
      createTransaction.mutate(input, { ...settle, onSuccess: onClose })
    }
  }

  function onDelete() {
    if (mode.kind !== 'edit' || inFlightRef.current) return
    inFlightRef.current = true
    deleteTransaction.mutate(mode.transaction.id, {
      onSettled: () => (inFlightRef.current = false),
      onSuccess: () => {
        pushToast('Transaction deleted', 'success')
        onClose()
      },
    })
  }

  function onKeepTransaction() {
    // Resetting a running delete would drop its callbacks and leave the form locked for good.
    if (inFlightRef.current) return
    deleteTransaction.reset()
    setConfirmingDelete(false)
  }

  /** A category of the other type is not a valid choice, so leave none selected. */
  function onKindChange(nextKind: string) {
    const current = getValues('categoryId')
    if (!categories.some((category) => category.id === current && category.kind === nextKind)) {
      setValue('categoryId', '')
    }
  }

  return (
    <form onSubmit={onFormSubmit} noValidate>
      <fieldset className="tx-form__fields" disabled={locked}>
        <fieldset className="kind-toggle">
          <legend>Type</legend>
          {(['expense', 'income'] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                value={value}
                {...register('kind', { onChange: (event) => onKindChange(event.target.value) })}
              />
              {value === 'expense' ? 'Expense' : 'Income'}
            </label>
          ))}
        </fieldset>
        <FormField
          label={`Amount (${currency})`}
          error={errors.amount?.message}
          hint={digits === 0 ? 'Whole numbers only' : `Up to ${digits} decimal places`}
        >
          <input inputMode="decimal" autoComplete="off" {...register('amount')} />
        </FormField>
        <FormField
          label="Category"
          error={errors.categoryId?.message}
          hint={
            categoryMissing ? 'The original category no longer exists. Choose another.' : undefined
          }
        >
          <select {...register('categoryId')}>
            <option value="">Choose…</option>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Date" error={errors.date?.message}>
          <input type="date" min="2000-01-01" max="2100-12-31" {...register('date')} />
        </FormField>
        <FormField label="Note" error={errors.note?.message}>
          <input maxLength={200} {...register('note')} />
        </FormField>
      </fieldset>

      {failure && (
        <p className="form-error" role="alert">
          {describeSaveError(failure)}
        </p>
      )}

      <div className="form-actions" ref={actionsRef}>
        {mode.kind === 'edit' &&
          (confirmingDelete ? (
            <div
              className="form-actions__confirm"
              role="group"
              aria-label="Confirm deletion"
              aria-describedby={questionId}
            >
              <span id={questionId}>Delete this transaction? This cannot be undone.</span>
              <Button onClick={onKeepTransaction} disabled={deleteTransaction.isPending}>
                Keep it
              </Button>
              <Button variant="danger" onClick={onDelete} loading={deleteTransaction.isPending}>
                Yes, delete
              </Button>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirmingDelete(true)} disabled={busy}>
              Delete transaction
            </Button>
          ))}
        <Button type="submit" variant="primary" loading={saving} disabled={locked}>
          {editing ? 'Save changes' : 'Add transaction'}
        </Button>
      </div>
    </form>
  )
}

/** A transaction whose category is gone (or of the other type) starts with none chosen. */
function initialValues(
  currency: string,
  mode: TransactionFormMode,
  categories: Category[],
): TransactionFormValues {
  if (mode.kind === 'create') return toFormValues(currency)
  const { transaction } = mode
  const values = toFormValues(currency, transaction)
  const usable = categories.some(
    (category) => category.id === transaction.categoryId && category.kind === transaction.kind,
  )
  return usable ? values : { ...values, categoryId: '' }
}
