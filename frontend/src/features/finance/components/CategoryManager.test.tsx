import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import type { Category } from '../types'
import { CategoryManager } from './CategoryManager'

vi.mock('../api/financeApi')

const categories: Category[] = [
  { id: 'e1', name: 'Groceries', kind: 'expense' },
  { id: 'i1', name: 'Salary', kind: 'income' },
]

function apiError(status: number, message: string) {
  return new AxiosError(message, 'ERR_BAD_REQUEST', undefined, null, {
    status,
    statusText: '',
    data: { message },
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(financeApi.listCategories).mockResolvedValue(categories)
})

async function open() {
  const rendered = renderWithProviders(<CategoryManager onClose={() => {}} />)
  await screen.findByText('Groceries')
  return rendered
}

describe('CategoryManager', () => {
  it('lists expense and income categories separately', async () => {
    renderWithProviders(<CategoryManager onClose={() => {}} />)

    const expense = await screen.findByRole('list', { name: 'Expense categories' })
    const income = screen.getByRole('list', { name: 'Income categories' })
    expect(within(expense).getByText('Groceries')).toBeInTheDocument()
    expect(within(income).getByText('Salary')).toBeInTheDocument()
  })

  it('says so when a type has no categories', async () => {
    vi.mocked(financeApi.listCategories).mockResolvedValue([categories[0] as Category])
    renderWithProviders(<CategoryManager onClose={() => {}} />)

    expect(await screen.findByText('No income categories yet')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Income categories' })).not.toBeInTheDocument()
  })

  it('shows loading, then an error with a retry', async () => {
    vi.mocked(financeApi.listCategories).mockRejectedValueOnce(new Error('boom'))
    renderWithProviders(<CategoryManager onClose={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading categories')

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Groceries')).toBeInTheDocument()
  })

  describe('adding', () => {
    it('adds a category of the chosen type, then clears and refocuses the name', async () => {
      vi.mocked(financeApi.createCategory).mockResolvedValue({
        id: 'e2',
        name: 'Pets',
        kind: 'income',
      })
      await open()

      await userEvent.type(screen.getByLabelText('New category name'), '  Pets ')
      await userEvent.selectOptions(screen.getByLabelText(/^type/i), 'income')
      await userEvent.click(screen.getByRole('button', { name: 'Add category' }))

      await vi.waitFor(() => expect(financeApi.createCategory).toHaveBeenCalled())
      expect(vi.mocked(financeApi.createCategory).mock.calls[0]?.[0]).toEqual({
        name: 'Pets',
        kind: 'income',
      })
      await vi.waitFor(() => expect(screen.getByLabelText('New category name')).toHaveValue(''))
      expect(screen.getByLabelText('New category name')).toHaveFocus()
    })

    it('does not add a blank name', async () => {
      await open()

      await userEvent.click(screen.getByRole('button', { name: 'Add category' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Enter a name')
      expect(screen.getByLabelText('New category name')).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByLabelText('New category name')).toHaveAccessibleDescription('Enter a name')
      expect(financeApi.createCategory).not.toHaveBeenCalled()
    })

    it('does not add a name longer than the server allows', async () => {
      await open()

      fireEvent.change(screen.getByLabelText('New category name'), {
        target: { value: 'x'.repeat(41) },
      })
      await userEvent.click(screen.getByRole('button', { name: 'Add category' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Use at most 40 characters')
      expect(financeApi.createCategory).not.toHaveBeenCalled()
    })

    it.each([
      ['a duplicate name', 'A category with that name already exists'],
      ['the per-type limit', 'You can have at most 100 expense categories'],
    ])('shows %s inline and drops it on the next attempt', async (_name, message) => {
      vi.mocked(financeApi.createCategory).mockRejectedValueOnce(apiError(409, message))
      await open()
      await userEvent.type(screen.getByLabelText('New category name'), 'Pets')
      await userEvent.click(screen.getByRole('button', { name: 'Add category' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(message)

      vi.mocked(financeApi.createCategory).mockReturnValue(new Promise(() => {}))
      await userEvent.click(screen.getByRole('button', { name: 'Add category' }))

      await vi.waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    })

    it('sends a second submit in the same tick only once', async () => {
      vi.mocked(financeApi.createCategory).mockReturnValue(new Promise(() => {}))
      await open()
      await userEvent.type(screen.getByLabelText('New category name'), 'Pets')
      const form = screen
        .getByRole('button', { name: 'Add category' })
        .closest('form') as HTMLFormElement

      fireEvent.submit(form)
      fireEvent.submit(form)

      await vi.waitFor(() => expect(financeApi.createCategory).toHaveBeenCalledTimes(1))
    })
  })

  describe('renaming', () => {
    async function startRename(name = 'Groceries') {
      await userEvent.click(screen.getByRole('button', { name: `Rename ${name}` }))
      return screen.getByLabelText(`New name for ${name}`)
    }

    it('renames a category, refreshes every report and returns focus to its Rename button', async () => {
      vi.mocked(financeApi.renameCategory).mockResolvedValue({
        ...categories[0],
        name: 'Food',
      } as Category)
      const { queryClient } = await open()
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

      const field = await startRename()
      expect(field).toHaveFocus()
      await userEvent.clear(field)
      await userEvent.type(field, ' Food ')
      await userEvent.click(screen.getByRole('button', { name: 'Save name' }))

      await vi.waitFor(() => expect(financeApi.renameCategory).toHaveBeenCalledWith('e1', 'Food'))
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['finance'] })
      expect(await screen.findByRole('button', { name: 'Rename Groceries' })).toHaveFocus()
    })

    it('shows the duplicate-name message inline when refused', async () => {
      vi.mocked(financeApi.renameCategory).mockRejectedValue(
        apiError(409, 'A category with that name already exists'),
      )
      await open()

      const field = await startRename()
      await userEvent.clear(field)
      await userEvent.type(field, 'Salary')
      await userEvent.click(screen.getByRole('button', { name: 'Save name' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'A category with that name already exists',
      )
      expect(vi.mocked(financeApi.renameCategory).mock.calls[0]).toEqual(['e1', 'Salary'])
      expect(screen.getByLabelText('New name for Groceries')).toHaveValue('Salary')
    })

    it('lets a name change only its capital letters', async () => {
      vi.mocked(financeApi.renameCategory).mockResolvedValue({
        ...categories[0],
        name: 'groceries',
      } as Category)
      await open()

      const field = await startRename()
      await userEvent.clear(field)
      await userEvent.type(field, 'groceries')
      await userEvent.click(screen.getByRole('button', { name: 'Save name' }))

      await vi.waitFor(() =>
        expect(financeApi.renameCategory).toHaveBeenCalledWith('e1', 'groceries'),
      )
    })

    it('closes without calling the API when the name is unchanged', async () => {
      await open()

      await startRename()
      await userEvent.click(screen.getByRole('button', { name: 'Save name' }))

      expect(financeApi.renameCategory).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Rename Groceries' })).toHaveFocus()
    })

    it('does not save a blank name', async () => {
      await open()

      const field = await startRename()
      await userEvent.clear(field)
      await userEvent.click(screen.getByRole('button', { name: 'Save name' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Enter a name')
      expect(financeApi.renameCategory).not.toHaveBeenCalled()
    })

    it('cancels and returns focus to the Rename button', async () => {
      await open()

      await startRename()
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByLabelText('New name for Groceries')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Rename Groceries' })).toHaveFocus()
    })
  })

  describe('deleting', () => {
    it('explains inline why a category in use cannot be deleted', async () => {
      vi.mocked(financeApi.deleteCategory).mockRejectedValue(
        apiError(409, '2 transactions use this category. Reassign or delete them first.'),
      )
      await open()

      await userEvent.click(screen.getByRole('button', { name: 'Delete Groceries' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(/2 transactions use this category/)
      expect(vi.mocked(financeApi.deleteCategory).mock.calls[0]?.[0]).toBe('e1')
      expect(screen.getByText('Groceries')).toBeInTheDocument()
    })

    it('removes the category, refreshes every report and moves focus to its list heading', async () => {
      vi.mocked(financeApi.deleteCategory).mockResolvedValue()
      const { queryClient } = await open()
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      vi.mocked(financeApi.listCategories).mockResolvedValue([categories[1] as Category])

      await userEvent.click(screen.getByRole('button', { name: 'Delete Groceries' }))

      await vi.waitFor(() => expect(screen.queryByText('Groceries')).not.toBeInTheDocument())
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['finance'] })
      expect(screen.getByRole('heading', { name: 'Expense' })).toHaveFocus()
    })

    it('sends a double click only once', async () => {
      vi.mocked(financeApi.deleteCategory).mockReturnValue(new Promise(() => {}))
      await open()

      const button = screen.getByRole('button', { name: 'Delete Groceries' })
      fireEvent.click(button)
      fireEvent.click(button)

      await vi.waitFor(() => expect(financeApi.deleteCategory).toHaveBeenCalledTimes(1))
      expect(screen.getByRole('button', { name: 'Delete Groceries' })).toBeDisabled()
    })
  })

  it('has no interactive control nested in another', async () => {
    const { container } = await open()

    for (const control of container.ownerDocument.querySelectorAll('button, input, select')) {
      expect(control.parentElement?.closest('button')).toBeNull()
    }
  })
})
