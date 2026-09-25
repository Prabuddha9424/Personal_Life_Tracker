import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { useState, useSyncExternalStore } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import type { Category, Transaction } from '../types'
import { TransactionFormModal } from './TransactionFormModal'

const session = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  let currency: string | null = 'USD'
  return {
    get: () => currency,
    set(next: string | null) {
      currency = next
      listeners.forEach((listener) => listener())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
})
vi.mock('@/features/auth', () => ({
  useSessionUser: () => {
    const currency = useSyncExternalStore(session.subscribe, session.get)
    return currency === null ? null : { id: '1', email: 'a@b.c', name: 'Ada', currency }
  },
}))
vi.mock('../api/financeApi')

const categories: Category[] = [
  { id: 'e1', name: 'Groceries', kind: 'expense' },
  { id: 'e2', name: 'Transport', kind: 'expense' },
  { id: 'i1', name: 'Salary', kind: 'income' },
]

const existing: Transaction = {
  id: 't1',
  kind: 'expense',
  amountMinor: 1250,
  currency: 'USD',
  categoryId: 'e1',
  date: '2026-09-15',
  note: 'Lunch',
}

function apiError(status: number, data: unknown) {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, null, {
    status,
    statusText: '',
    data,
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  session.set('USD')
  vi.mocked(financeApi.listCategories).mockResolvedValue(categories)
})

async function openCreate(onClose = () => {}) {
  renderWithProviders(<TransactionFormModal mode={{ kind: 'create' }} onClose={onClose} />)
  await screen.findByRole('option', { name: 'Groceries' })
}

async function openEdit(transaction: Transaction = existing, onClose = () => {}) {
  renderWithProviders(
    <TransactionFormModal mode={{ kind: 'edit', transaction }} onClose={onClose} />,
  )
  await screen.findByLabelText(/^amount/i)
}

describe('TransactionFormModal (create)', () => {
  it('validates before calling the API', async () => {
    await openCreate()

    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

    expect(await screen.findByText('Enter an amount')).toBeInTheDocument()
    expect(screen.getByText('Choose a category')).toBeInTheDocument()
    expect(financeApi.createTransaction).not.toHaveBeenCalled()
  })

  it('offers only categories of the chosen type and resets the category when the type changes', async () => {
    await openCreate()

    expect(screen.queryByRole('option', { name: 'Salary' })).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries')

    await userEvent.click(screen.getByRole('radio', { name: 'Income' }))

    expect(screen.getByRole('option', { name: 'Salary' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Groceries' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^category/i)).toHaveValue('')
  })

  it('starts with an expense dated today and focus on the amount', async () => {
    await openCreate()

    expect(screen.getByRole('radio', { name: 'Expense' })).toBeChecked()
    expect(screen.getByLabelText('Date')).toHaveValue(
      new Intl.DateTimeFormat('en-CA').format(new Date()),
    )
    expect(screen.getByLabelText(/^amount/i)).toHaveFocus()
  })

  it('creates a transaction with the amount in integer minor units and closes', async () => {
    vi.mocked(financeApi.createTransaction).mockResolvedValue(existing)
    const onClose = vi.fn()
    await openCreate(onClose)

    await userEvent.type(screen.getByLabelText(/^amount/i), '12.50')
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries')
    await userEvent.type(screen.getByLabelText('Note'), 'Lunch')
    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(financeApi.createTransaction).mock.calls[0]?.[0]).toMatchObject({
      kind: 'expense',
      amountMinor: 1250,
      categoryId: 'e1',
      note: 'Lunch',
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })

  it.each([
    ['JPY', '500', 500, 'Enter a valid amount in JPY', '5.5'],
    ['BHD', '1.234', 1234, 'Enter a valid amount in BHD', '1.2345'],
  ])(
    'handles %s: accepts %s as %i minor units and rejects too many decimals',
    async (currency, good, minor, message, bad) => {
      session.set(currency)
      vi.mocked(financeApi.createTransaction).mockResolvedValue(existing)
      await openCreate()
      await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries')

      await userEvent.type(screen.getByLabelText(/^amount/i), bad)
      await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))
      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(financeApi.createTransaction).not.toHaveBeenCalled()

      await userEvent.clear(screen.getByLabelText(/^amount/i))
      await userEvent.type(screen.getByLabelText(/^amount/i), good)
      await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

      await vi.waitFor(() => expect(financeApi.createTransaction).toHaveBeenCalled())
      expect(vi.mocked(financeApi.createTransaction).mock.calls[0]?.[0].amountMinor).toBe(minor)
    },
  )

  it.each([
    ['BHD', '1,234', 'Enter a valid amount in BHD'],
    ['USD', '12.345', 'Enter a valid amount in USD'],
    ['USD', 'abc', 'Enter a valid amount in USD'],
    ['USD', '-5', 'Enter a valid amount in USD'],
    ['USD', '0', 'Amount must be greater than zero'],
    ['USD', '99999999999999', 'Amount is too large'],
  ])(
    'shows an inline error for %s amount "%s" and never sends it',
    async (currency, text, message) => {
      session.set(currency)
      await openCreate()
      await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries')

      await userEvent.type(screen.getByLabelText(/^amount/i), text)
      await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(financeApi.createTransaction).not.toHaveBeenCalled()
    },
  )

  it('links a field error to its control and says how many decimals the currency takes', async () => {
    session.set('JPY')
    await openCreate()
    const amount = screen.getByLabelText(/^amount/i)
    expect(amount).toHaveAccessibleDescription('Whole numbers only')

    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

    expect(amount).toHaveAttribute('aria-invalid', 'true')
    expect(amount).toHaveAccessibleDescription('Enter an amount')
  })

  it('rejects a date outside the years the server accepts', async () => {
    await openCreate()
    await userEvent.type(screen.getByLabelText(/^amount/i), '5')
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries')

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '1999-12-31' } })
    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

    expect(await screen.findByText('Choose a date between 2000 and 2100')).toBeInTheDocument()
    expect(financeApi.createTransaction).not.toHaveBeenCalled()
  })

  it('groups the type choice under a legend', async () => {
    await openCreate()

    expect(screen.getByRole('group', { name: 'Type' })).toBeInTheDocument()
  })

  it('keeps the dialog open and shows the server message when creation fails', async () => {
    vi.mocked(financeApi.createTransaction).mockRejectedValue(new Error('Network Error'))
    const onClose = vi.fn()
    await openCreate(onClose)
    await userEvent.type(screen.getByLabelText(/^amount/i), '5')
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries')

    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network Error')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/^amount/i)).toHaveValue('5')
  })

  it('lists the field messages the server sends with a 400', async () => {
    vi.mocked(financeApi.createTransaction).mockRejectedValue(
      apiError(400, {
        message: 'Validation failed',
        errors: [{ path: 'date', message: 'Expected a date between 2000 and 2100' }],
      }),
    )
    await openCreate()
    await userEvent.type(screen.getByLabelText(/^amount/i), '5')
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries')

    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Validation failed: date: Expected a date between 2000 and 2100',
    )
  })

  it('clears a failed create when the next submit fails validation', async () => {
    vi.mocked(financeApi.createTransaction).mockRejectedValue(new Error('Network Error'))
    await openCreate()
    await userEvent.type(screen.getByLabelText(/^amount/i), '5')
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries')
    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))
    expect(await screen.findByText('Network Error')).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText(/^amount/i))
    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

    expect(await screen.findByText('Enter an amount')).toBeInTheDocument()
    expect(screen.queryByText('Network Error')).not.toBeInTheDocument()
  })

  it('sends a create only once when submitted twice in the same tick, and disables the form while saving', async () => {
    let finish: (transaction: Transaction) => void = () => {}
    vi.mocked(financeApi.createTransaction).mockReturnValue(
      new Promise<Transaction>((resolve) => {
        finish = resolve
      }),
    )
    await openCreate()
    await userEvent.type(screen.getByLabelText(/^amount/i), '5')
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries')
    const form = screen
      .getByRole('button', { name: 'Add transaction' })
      .closest('form') as HTMLFormElement

    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(financeApi.createTransaction).toHaveBeenCalled())
    await act(async () => {})

    expect(financeApi.createTransaction).toHaveBeenCalledTimes(1)
    const submit = screen.getByRole('button', { name: 'Add transaction' })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByLabelText(/^amount/i)).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Income' })).toBeDisabled()
    fireEvent.submit(form)
    await act(async () => {})
    expect(financeApi.createTransaction).toHaveBeenCalledTimes(1)

    finish(existing)
    await waitFor(() => expect(submit).toBeEnabled())
  })
})

describe('TransactionFormModal (currency)', () => {
  it('shows a loading state, not a partial form, until the profile currency is known', async () => {
    session.set(null)
    renderWithProviders(
      <TransactionFormModal
        mode={{ kind: 'edit', transaction: { ...existing, currency: 'BHD', amountMinor: 1234 } }}
        onClose={() => {}}
      />,
    )

    expect(await screen.findByRole('status')).toHaveTextContent('Loading your currency')
    expect(screen.queryByLabelText(/^amount/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()

    act(() => session.set('BHD'))

    expect(await screen.findByLabelText(/^amount/i)).toHaveValue('1.234')
  })

  it.each(['', 'US', 'US1', 'DOLLARS'])(
    'refuses to guess when the profile currency is "%s"',
    async (currency) => {
      session.set(currency)
      renderWithProviders(<TransactionFormModal mode={{ kind: 'create' }} onClose={() => {}} />)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Your profile currency is missing or invalid',
      )
      expect(screen.queryByLabelText(/^amount/i)).not.toBeInTheDocument()
      expect(financeApi.createTransaction).not.toHaveBeenCalled()
    },
  )

  it('keeps the currency the transaction was recorded in when it differs from the profile', async () => {
    session.set('JPY')
    vi.mocked(financeApi.updateTransaction).mockResolvedValue(existing)
    await openEdit()

    expect(screen.getByLabelText('Amount (USD)')).toHaveValue('12.50')
    await userEvent.clear(screen.getByLabelText(/^amount/i))
    await userEvent.type(screen.getByLabelText(/^amount/i), '20.25')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await vi.waitFor(() => expect(financeApi.updateTransaction).toHaveBeenCalled())
    expect(vi.mocked(financeApi.updateTransaction).mock.calls[0]?.[1].amountMinor).toBe(2025)
  })
})

describe('TransactionFormModal (categories)', () => {
  it('shows a loading state, then the form', async () => {
    renderWithProviders(<TransactionFormModal mode={{ kind: 'create' }} onClose={() => {}} />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading categories')
    expect(await screen.findByLabelText(/^amount/i)).toBeInTheDocument()
  })

  it('shows an error with a retry when categories cannot be loaded', async () => {
    vi.mocked(financeApi.listCategories).mockRejectedValueOnce(new Error('boom'))
    renderWithProviders(<TransactionFormModal mode={{ kind: 'create' }} onClose={() => {}} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByLabelText(/^amount/i)).toBeInTheDocument()
  })
})

describe('TransactionFormModal (edit)', () => {
  it('fills the form and saves through update', async () => {
    vi.mocked(financeApi.updateTransaction).mockResolvedValue(existing)
    const onClose = vi.fn()
    await openEdit(existing, onClose)

    expect(screen.getByLabelText(/^amount/i)).toHaveValue('12.50')
    expect(screen.getByLabelText('Note')).toHaveValue('Lunch')
    expect(screen.getByLabelText(/^category/i)).toHaveValue('e1')
    await userEvent.clear(screen.getByLabelText(/^amount/i))
    await userEvent.type(screen.getByLabelText(/^amount/i), '20')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(financeApi.updateTransaction).mock.calls[0]).toEqual([
      't1',
      { kind: 'expense', amountMinor: 2000, categoryId: 'e1', date: '2026-09-15', note: 'Lunch' },
    ])
    expect(financeApi.createTransaction).not.toHaveBeenCalled()
  })

  it.each([
    ['JPY', 500, '500'],
    ['BHD', 1234, '1.234'],
  ])(
    'round-trips %s: %i minor units show as %s and save back unchanged',
    async (currency, minor, text) => {
      session.set(currency)
      vi.mocked(financeApi.updateTransaction).mockResolvedValue(existing)
      await openEdit({ ...existing, currency, amountMinor: minor })

      expect(screen.getByLabelText(/^amount/i)).toHaveValue(text)
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      await vi.waitFor(() => expect(financeApi.updateTransaction).toHaveBeenCalled())
      expect(vi.mocked(financeApi.updateTransaction).mock.calls[0]?.[1].amountMinor).toBe(minor)
    },
  )

  it('shows the server message inline when saving fails', async () => {
    vi.mocked(financeApi.updateTransaction).mockRejectedValue(new Error('Transaction not found'))
    const onClose = vi.fn()
    await openEdit(existing, onClose)

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Transaction not found')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not crash when its category was deleted, and asks for another one', async () => {
    vi.mocked(financeApi.updateTransaction).mockResolvedValue(existing)
    await openEdit({ ...existing, categoryId: 'gone' })

    expect(screen.getByLabelText(/^category/i)).toHaveValue('')
    expect(screen.getByLabelText(/^category/i)).toHaveAccessibleDescription(
      'The original category no longer exists. Choose another.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Choose a category')).toBeInTheDocument()
    expect(financeApi.updateTransaction).not.toHaveBeenCalled()

    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Transport')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await vi.waitFor(() => expect(financeApi.updateTransaction).toHaveBeenCalled())
    expect(vi.mocked(financeApi.updateTransaction).mock.calls[0]?.[1].categoryId).toBe('e2')
  })

  it('resets an incompatible category when the type is switched, and again when switched back', async () => {
    await openEdit()

    await userEvent.click(screen.getByRole('radio', { name: 'Income' }))
    expect(screen.getByLabelText(/^category/i)).toHaveValue('')
    await userEvent.click(screen.getByRole('radio', { name: 'Expense' }))

    expect(screen.getByLabelText(/^category/i)).toHaveValue('')
    expect(screen.getByRole('option', { name: 'Groceries' })).toBeInTheDocument()
  })

  it('asks for confirmation before deleting', async () => {
    vi.mocked(financeApi.deleteTransaction).mockResolvedValue()
    const onClose = vi.fn()
    await openEdit(existing, onClose)

    await userEvent.click(screen.getByRole('button', { name: 'Delete transaction' }))
    expect(financeApi.deleteTransaction).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(financeApi.deleteTransaction).mock.calls[0]?.[0]).toBe('t1')
  })

  it('can back out of a delete, moving focus to the safe choice and back', async () => {
    await openEdit()

    await userEvent.click(screen.getByRole('button', { name: 'Delete transaction' }))
    expect(screen.getByRole('group', { name: 'Confirm deletion' })).toHaveAccessibleDescription(
      'Delete this transaction? This cannot be undone.',
    )
    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(screen.getByLabelText(/^amount/i)).toBeDisabled()

    await userEvent.keyboard('{Enter}')

    expect(screen.getByRole('button', { name: 'Delete transaction' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    expect(financeApi.deleteTransaction).not.toHaveBeenCalled()
  })

  it('shows a failed delete inline and keeps the dialog open', async () => {
    vi.mocked(financeApi.deleteTransaction).mockRejectedValue(new Error('Server down'))
    const onClose = vi.fn()
    await openEdit(existing, onClose)

    await userEvent.click(screen.getByRole('button', { name: 'Delete transaction' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Server down')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('TransactionFormModal (closing)', () => {
  it('closes on Escape, the backdrop and the close button when nothing is being saved', async () => {
    const onClose = vi.fn()
    await openCreate(onClose)

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('returns focus to the control that opened it when closed', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open form
          </button>
          {open && (
            <TransactionFormModal mode={{ kind: 'create' }} onClose={() => setOpen(false)} />
          )}
        </>
      )
    }
    renderWithProviders(<Harness />)

    await userEvent.click(screen.getByRole('button', { name: 'Open form' }))
    await screen.findByLabelText(/^amount/i)
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open form' })).toHaveFocus()
  })

  async function submitPending() {
    const settle = {
      resolve: (transaction: Transaction): void => void transaction,
      reject: (error: Error): void => void error,
    }
    vi.mocked(financeApi.createTransaction).mockReturnValue(
      new Promise<Transaction>((resolve, reject) => {
        settle.resolve = resolve
        settle.reject = reject
      }),
    )
    const onClose = vi.fn()
    await openCreate(onClose)
    await userEvent.type(screen.getByLabelText(/^amount/i), '5')
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries')
    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))
    await vi.waitFor(() => expect(financeApi.createTransaction).toHaveBeenCalled())
    return { onClose, settle }
  }

  it('ignores Escape, the backdrop and the close button while the request is pending', async () => {
    const { onClose } = await submitPending()

    await userEvent.keyboard('{Escape}')
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('still shows the inline error when the request fails after Escape was pressed', async () => {
    const { onClose, settle } = await submitPending()

    await userEvent.keyboard('{Escape}')
    await act(async () => settle.reject(new Error('Network Error')))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network Error')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when the request succeeds', async () => {
    const { onClose, settle } = await submitPending()

    await act(async () => settle.resolve(existing))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
