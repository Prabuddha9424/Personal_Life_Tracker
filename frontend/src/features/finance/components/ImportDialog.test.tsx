import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import type { Category, Transaction, TransactionInput } from '../types'
import { ImportDialog } from './ImportDialog'

const session = vi.hoisted(() => ({ currency: 'USD' as string | null }))
vi.mock('@/features/auth', () => ({
  useSessionUser: () =>
    session.currency === null
      ? null
      : { id: '1', email: 'a@b.c', name: 'Ada', currency: session.currency },
}))
vi.mock('../api/financeApi')

const categories: Category[] = [
  { id: 'e-other', name: 'Other', kind: 'expense' },
  { id: 'e-food', name: 'Groceries', kind: 'expense' },
  { id: 'i-other', name: 'Other', kind: 'income' },
  { id: 'i-pay', name: 'Salary', kind: 'income' },
]

const CSV = [
  'Date,Description,Amount',
  '2026-09-01,Coffee,-4.50',
  '2026-09-02,Salary,3000.00',
  'not a date,Broken,-1.00',
  '2026-09-03,"Lunch, with client",-25.00',
].join('\n')

function apiError(status: number, data: unknown) {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, null, {
    status,
    statusText: '',
    data,
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  })
}

async function open(onClose = () => {}, onImportingChange?: (importing: boolean) => void) {
  const view = renderWithProviders(
    <ImportDialog onClose={onClose} onImportingChange={onImportingChange} />,
  )
  await screen.findByLabelText('CSV file')
  return view
}

async function upload(csv: string, name = 'bank.csv', type = 'text/csv') {
  await userEvent.upload(screen.getByLabelText('CSV file'), new File([csv], name, { type }))
}

/** A bad row on line 2, so the valid row with index i is on file line i + 3. */
function bigCsv(count: number) {
  const rows = Array.from({ length: count }, (_, i) => `2026-09-01,Item ${i},-1.00`)
  return ['Date,Description,Amount', 'not a date,Broken,-1.00', ...rows].join('\n')
}

function sentBatches(): TransactionInput[][] {
  return vi.mocked(financeApi.bulkCreateTransactions).mock.calls.map(([rows]) => rows)
}

beforeEach(() => {
  vi.resetAllMocks()
  session.currency = 'USD'
  vi.mocked(financeApi.listCategories).mockResolvedValue(categories)
  vi.mocked(financeApi.listAllTransactionsInRange).mockResolvedValue({
    items: [],
    truncated: false,
  })
  vi.mocked(financeApi.bulkCreateTransactions).mockImplementation(async (rows) => ({
    created: rows.length,
  }))
})

describe('ImportDialog: choosing a file', () => {
  it('asks for a file first and offers no import yet', async () => {
    await open()

    expect(screen.getByLabelText('CSV file')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Import \d/ })).not.toBeInTheDocument()
  })

  it('waits for the profile currency instead of guessing one', async () => {
    session.currency = null
    renderWithProviders(<ImportDialog onClose={() => {}} />)

    expect(await screen.findByText('Loading your currency…')).toBeInTheDocument()
    expect(screen.queryByLabelText('CSV file')).not.toBeInTheDocument()
  })

  it('waits for the categories, and offers a retry when they fail to load', async () => {
    vi.mocked(financeApi.listCategories).mockRejectedValueOnce(new Error('down'))
    renderWithProviders(<ImportDialog onClose={() => {}} />)

    expect(await screen.findByText('Could not load categories')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('CSV file')).toBeInTheDocument()
  })

  it.each([
    [
      'a file that is not text',
      new File(['x'], 'photo.png', { type: 'image/png' }),
      /Choose a \.csv or \.txt file/,
    ],
    ['an empty file', new File([''], 'empty.csv', { type: 'text/csv' }), /That file has no rows/],
    [
      'a binary file',
      new File(['PK\u0003\u0004\u0000\u0000 some binary content'], 'data.csv', {
        type: 'text/csv',
      }),
      /does not look like a text file/,
    ],
  ])('says so for %s', async (_name, file, message) => {
    await open()

    // fireEvent: userEvent.upload would drop a file the input's accept list refuses.
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } })

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('button', { name: /^Import \d/ })).not.toBeInTheDocument()
  })

  it('refuses a file over 5 MB', async () => {
    await open()
    const big = new File(['a,b'], 'big.csv', { type: 'text/csv' })
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 })

    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [big] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('larger than 5 MB')
  })

  it('warns about characters that could not be read, and still lets the user import', async () => {
    await open()
    // "Caf\xe9" in Windows-1252 is not valid UTF-8.
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('Date,Description,Amount\n2026-09-01,Caf'),
      0xe9,
      ...new TextEncoder().encode(',-4.50\n'),
    ])

    await userEvent.upload(
      screen.getByLabelText('CSV file'),
      new File([bytes], 'bank.csv', { type: 'text/csv' }),
    )

    expect(
      await screen.findByText(
        'Some characters could not be read \u2014 save the file as CSV UTF-8.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 1 transaction' })).toBeEnabled()
  })

  it('drops the previous preview when the next file is refused', async () => {
    await open()
    await upload(CSV)
    await screen.findByText('3 rows ready to import')

    fireEvent.change(screen.getByLabelText('CSV file'), {
      target: { files: [new File([''], 'empty.csv', { type: 'text/csv' })] },
    })

    expect(await screen.findByText('That file has no rows')).toBeInTheDocument()
    expect(screen.queryByText('3 rows ready to import')).not.toBeInTheDocument()
  })
})

describe('ImportDialog: the preview', () => {
  it('says how many rows are ready and which lines have problems, before anything is imported', async () => {
    await open()

    await upload(CSV)

    expect(await screen.findByText('3 rows ready to import')).toBeInTheDocument()
    expect(screen.getByText('1 row has a problem and will be skipped')).toBeInTheDocument()
    expect(screen.getByText('Line 4: Could not read the date "not a date"')).toBeInTheDocument()
    expect(financeApi.bulkCreateTransactions).not.toHaveBeenCalled()
  })

  it('guesses the columns from the header and defaults to the "Other" categories', async () => {
    await open()

    await upload(CSV)
    await screen.findByText('3 rows ready to import')

    expect(screen.getByLabelText(/^date column/i)).toHaveValue('0')
    expect(screen.getByLabelText(/^amount column/i)).toHaveValue('2')
    expect(screen.getByLabelText(/^note column/i)).toHaveValue('1')
    expect(screen.getByLabelText(/^category for spending/i)).toHaveValue('e-other')
    expect(screen.getByLabelText(/^category for income/i)).toHaveValue('i-other')
  })

  it('lists the rows to be imported in a captioned table', async () => {
    await open()

    await upload(CSV)

    const table = await screen.findByRole('table', { name: /preview.*3 of 3/i })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Line', 'Date', 'Type', 'Amount', 'Category', 'Note'])
    const row = within(table).getByRole('row', { name: /coffee/i })
    expect(within(row).getByRole('rowheader')).toHaveTextContent('2')
    expect(row).toHaveTextContent('$4.50')
    expect(row).toHaveTextContent('Spending')
  })

  it('shows at most 20 rows and says how many more will be imported', async () => {
    await open()

    await upload(bigCsv(45))

    const table = await screen.findByRole('table', { name: /first 20 of 45/i })
    expect(within(table).getAllByRole('row')).toHaveLength(21)
    expect(screen.getByRole('button', { name: 'Import 45 transactions' })).toBeInTheDocument()
  })

  it('lists at most 10 problems and counts the rest', async () => {
    await open()
    const bad = Array.from({ length: 15 }, (_, i) => `bad ${i},Broken,-1.00`)

    await upload(['Date,Description,Amount', ...bad, '2026-09-01,Ok,-1.00'].join('\n'))

    expect(await screen.findByText('15 rows have problems and will be skipped')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Rows that will be skipped' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(11)
    expect(within(list).getByText(/and 5 more/)).toBeInTheDocument()
    expect(within(list).getByText(/^Line 2:/)).toBeInTheDocument()
  })

  it('shows what a note says, never markup', async () => {
    const { container } = await open()

    await upload('Date,Description,Amount\n2026-09-01,<img src=x onerror=alert(1)>,-1.00\n')

    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(container.ownerDocument.querySelector('img')).toBeNull()
  })

  it('re-reads the file when the date format or sign convention changes', async () => {
    await open()
    await upload('Date,Description,Amount\n05/09/2026,Coffee,4.50\n')
    expect(await screen.findByText('0 rows ready to import')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText(/^date format/i), 'DD/MM/YYYY')
    await userEvent.click(screen.getByLabelText('Positive amounts are spending'))

    expect(await screen.findByText('1 row ready to import')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Import 1 transaction' }))
    await screen.findByText('Imported 1 transaction')
    expect(sentBatches()[0]?.[0]).toMatchObject({ kind: 'expense', date: '2026-09-05' })
  })

  it('offers no import for a file with only a header', async () => {
    await open()

    await upload('Date,Description,Amount\n')

    expect(await screen.findByText('0 rows ready to import')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Import \d/ })).not.toBeInTheDocument()
  })

  it('gives every column and category control its own name', async () => {
    await open()
    await upload(CSV)
    await screen.findByText('3 rows ready to import')

    const names = screen
      .getAllByRole<HTMLSelectElement>('combobox')
      .map((select) => select.labels[0]?.textContent)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toHaveLength(8)
    expect(screen.getByLabelText(/^type column/i)).toHaveValue('')
    expect(screen.getByLabelText(/^category column/i)).toHaveValue('')
  })
})

describe('ImportDialog: title rows, header and columns', () => {
  const TITLED = [
    'Bank export for Ada',
    'Date,Description,Amount',
    '2026-09-01,Coffee,-4.50',
    '2026-09-02,Salary,3000.00',
    'oops,Broken,-1.00',
  ].join('\n')

  it('lets the user skip title rows above the header and keeps the file line numbers', async () => {
    await open()
    await upload(TITLED)
    // Read as the header, the title has one column, so every data row looks too wide.
    expect(await screen.findByText('0 rows ready to import')).toBeInTheDocument()
    expect(screen.getAllByText(/the header has 1/).length).toBeGreaterThan(0)

    await userEvent.clear(screen.getByLabelText(/^rows to skip/i))
    await userEvent.type(screen.getByLabelText(/^rows to skip/i), '1')

    expect(await screen.findByText('2 rows ready to import')).toBeInTheDocument()
    expect(screen.getByText('Line 5: Could not read the date "oops"')).toBeInTheDocument()
    expect(screen.getByLabelText(/^amount column/i)).toHaveValue('2')
    expect(screen.getByLabelText(/^note column/i)).toHaveValue('1')
    const table = screen.getByRole('table')
    expect(
      within(within(table).getByRole('row', { name: /coffee/i })).getByRole('rowheader'),
    ).toHaveTextContent('3')
  })

  it('reads every row as data when the file has no header', async () => {
    await open()
    await upload('2026-09-01,-4.50,Coffee\n2026-09-02,3000.00,Salary\n')
    expect(await screen.findByText('1 row ready to import')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('First row is a header'))

    expect(await screen.findByText('2 rows ready to import')).toBeInTheDocument()
    expect(screen.getByLabelText(/^note column/i)).toHaveValue('2')
  })

  it('flags a note column that has no name in the header', async () => {
    await open()

    await upload('Date,Amount,\n2026-09-01,-4.50,Coffee\n')

    expect(await screen.findByText('1 row ready to import')).toBeInTheDocument()
    expect(screen.getByLabelText(/^note column/i)).toHaveValue('2')
    expect(
      within(screen.getByLabelText(/^note column/i)).getByRole('option', { name: '3: (no name)' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/has no name in the header/i)).toBeInTheDocument()
  })

  it('explains the header, skipped rows and unsupported currency symbols', async () => {
    await open()

    await upload(CSV)

    const help = await screen.findByText(/letter-only currency symbols/i)
    expect(help).toHaveTextContent(/Rs, kr, zł/)
    expect(help).toHaveTextContent(/ISO code/)
  })

  it('reads a type column and a category column from the file', async () => {
    await open()
    await upload(
      'Date,Description,Amount,Type,Group\n2026-09-01,Coffee,4.50,Debit,groceries\n2026-09-02,Pay,10.00,Credit,\n',
    )
    await screen.findByText('2 rows ready to import')

    await userEvent.selectOptions(screen.getByLabelText(/^type column/i), '3')
    await userEvent.selectOptions(screen.getByLabelText(/^category column/i), '4')
    await userEvent.click(screen.getByRole('button', { name: 'Import 2 transactions' }))

    await screen.findByText('Imported 2 transactions')
    expect(sentBatches()[0]).toEqual([
      {
        kind: 'expense',
        amountMinor: 450,
        categoryId: 'e-food',
        date: '2026-09-01',
        note: 'Coffee',
      },
      { kind: 'income', amountMinor: 1000, categoryId: 'i-other', date: '2026-09-02', note: 'Pay' },
    ])
  })
})

describe('ImportDialog: duplicates', () => {
  const existing: Transaction = {
    id: 't',
    kind: 'expense',
    amountMinor: 450,
    currency: 'USD',
    categoryId: 'e-other',
    date: '2026-09-01',
    note: 'coffee',
  }

  it('warns about rows that already exist, without blocking the import', async () => {
    vi.mocked(financeApi.listAllTransactionsInRange).mockResolvedValue({
      items: [existing],
      truncated: false,
    })
    await open()

    await upload(CSV)

    expect(
      await screen.findByText(/1 row looks like a transaction you already have/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 3 transactions' })).toBeEnabled()
    expect(screen.queryByText(/first 1000 transactions/)).not.toBeInTheDocument()
  })

  it('says when the check may have missed transactions because the range is large', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({
      ...existing,
      id: `t${i}`,
      note: `n${i}`,
    }))
    vi.mocked(financeApi.listAllTransactionsInRange).mockResolvedValue({
      items: many,
      truncated: true,
    })
    await open()

    await upload(CSV)

    expect(
      await screen.findByText(
        /Possible duplicates were checked against your first 1000 transactions in this date range/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 3 transactions' })).toBeEnabled()
  })

  it('does not warn about a large range when every transaction in it was checked', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({
      ...existing,
      id: `t${i}`,
      note: `n${i}`,
    }))
    vi.mocked(financeApi.listAllTransactionsInRange).mockResolvedValue({
      items: many,
      truncated: false,
    })
    await open()

    await upload(CSV)

    await screen.findByText('3 rows ready to import')
    await waitFor(() => expect(financeApi.listAllTransactionsInRange).toHaveBeenCalled())
    expect(screen.queryByText(/first 1000 transactions/)).not.toBeInTheDocument()
  })

  it('says when the check could not be made, and still lets the user import', async () => {
    vi.mocked(financeApi.listAllTransactionsInRange).mockRejectedValue(new Error('down'))
    await open()

    await upload(CSV)

    expect(await screen.findByText(/Could not check for duplicates/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 3 transactions' })).toBeEnabled()
  })
})

describe('ImportDialog: importing', () => {
  it('imports the good rows with the chosen categories and reports what was skipped', async () => {
    await open()
    await upload(CSV)
    await screen.findByText('3 rows ready to import')

    await userEvent.selectOptions(screen.getByLabelText(/^category for spending/i), 'e-food')
    await userEvent.click(screen.getByRole('button', { name: 'Import 3 transactions' }))

    expect(await screen.findByText('Imported 3 transactions')).toBeInTheDocument()
    expect(screen.getByText('Skipped 1 row with a problem')).toBeInTheDocument()
    expect(screen.getByText('Line 4: Could not read the date "not a date"')).toBeInTheDocument()
    expect(sentBatches()).toEqual([
      [
        {
          kind: 'expense',
          amountMinor: 450,
          categoryId: 'e-food',
          date: '2026-09-01',
          note: 'Coffee',
        },
        {
          kind: 'income',
          amountMinor: 300000,
          categoryId: 'i-other',
          date: '2026-09-02',
          note: 'Salary',
        },
        {
          kind: 'expense',
          amountMinor: 2500,
          categoryId: 'e-food',
          date: '2026-09-03',
          note: 'Lunch, with client',
        },
      ],
    ])
  })

  it('never sends a currency or a user', async () => {
    await open()
    await upload(CSV)
    await screen.findByText('3 rows ready to import')

    await userEvent.click(screen.getByRole('button', { name: 'Import 3 transactions' }))
    await screen.findByText('Imported 3 transactions')

    for (const row of sentBatches().flat()) {
      expect(Object.keys(row).sort()).toEqual(['amountMinor', 'categoryId', 'date', 'kind', 'note'])
    }
  })

  it('reads amounts in the profile currency', async () => {
    session.currency = 'JPY'
    await open()

    await upload('Date,Description,Amount\n2026-09-01,Ramen,-900\n2026-09-02,Bad,-9.5\n')
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1 transaction' }))

    await screen.findByText('Imported 1 transaction')
    expect(sentBatches()[0]?.[0]).toMatchObject({ amountMinor: 900 })
  })

  it('sends large files in batches of 200 rows', async () => {
    await open()

    await upload(bigCsv(1200))
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1200 transactions' }))

    expect(await screen.findByText('Imported 1200 transactions')).toBeInTheDocument()
    expect(sentBatches().map((rows) => rows.length)).toEqual([200, 200, 200, 200, 200, 200])
  })

  it('shows progress while a batch is being sent', async () => {
    let release: () => void = () => {}
    vi.mocked(financeApi.bulkCreateTransactions)
      .mockImplementationOnce(async (rows) => ({ created: rows.length }))
      .mockImplementationOnce(
        (rows) => new Promise((resolve) => (release = () => resolve({ created: rows.length }))),
      )
    await open()
    await upload(bigCsv(300))

    await userEvent.click(await screen.findByRole('button', { name: 'Import 300 transactions' }))

    expect(await screen.findByText(/Importing batch 2 of 2/)).toBeInTheDocument()
    expect(screen.getByText(/200 of 300 transactions imported/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Import progress' })).toHaveAttribute(
      'value',
      '200',
    )
    release()
    expect(await screen.findByText('Imported 300 transactions')).toBeInTheDocument()
  })

  it('ignores Escape, the backdrop and the close button while importing, and a second click', async () => {
    let release: () => void = () => {}
    vi.mocked(financeApi.bulkCreateTransactions).mockImplementation(
      (rows) => new Promise((resolve) => (release = () => resolve({ created: rows.length }))),
    )
    const onClose = vi.fn()
    await open(onClose)
    await upload(CSV)
    const button = await screen.findByRole('button', { name: 'Import 3 transactions' })

    fireEvent.click(button)
    fireEvent.click(button)
    await screen.findByText(/Importing batch 1 of 1/)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(document.querySelector('.modal-backdrop') as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(financeApi.bulkCreateTransactions).toHaveBeenCalledTimes(1)
    release()
    await screen.findByText('Imported 3 transactions')
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('tells its parent while batches are being sent, and again when that stops', async () => {
    let release: () => void = () => {}
    vi.mocked(financeApi.bulkCreateTransactions).mockImplementation(
      (rows) => new Promise((resolve) => (release = () => resolve({ created: rows.length }))),
    )
    const onImportingChange = vi.fn()
    await open(() => {}, onImportingChange)
    expect(onImportingChange).not.toHaveBeenCalledWith(true)
    await upload(CSV)

    await userEvent.click(await screen.findByRole('button', { name: 'Import 3 transactions' }))

    await waitFor(() => expect(onImportingChange).toHaveBeenLastCalledWith(true))
    release()
    await screen.findByText('Imported 3 transactions')
    expect(onImportingChange).toHaveBeenLastCalledWith(false)
  })

  it('tells its parent an import has stopped when a batch fails', async () => {
    vi.mocked(financeApi.bulkCreateTransactions).mockRejectedValue(apiError(500, {}))
    const onImportingChange = vi.fn()
    await open(() => {}, onImportingChange)
    await upload(CSV)

    await userEvent.click(await screen.findByRole('button', { name: 'Import 3 transactions' }))

    await screen.findByText(/Stopped early/)
    expect(onImportingChange).toHaveBeenCalledWith(true)
    expect(onImportingChange).toHaveBeenLastCalledWith(false)
  })

  it('tells its parent the import is over when the dialog goes away mid-import', async () => {
    vi.mocked(financeApi.bulkCreateTransactions).mockImplementation(() => new Promise(() => {}))
    const onImportingChange = vi.fn()
    const { unmount } = await open(() => {}, onImportingChange)
    await upload(CSV)
    await userEvent.click(await screen.findByRole('button', { name: 'Import 3 transactions' }))
    await waitFor(() => expect(onImportingChange).toHaveBeenLastCalledWith(true))

    unmount()

    expect(onImportingChange).toHaveBeenLastCalledWith(false)
  })

  it('sends no further batch once the dialog has been unmounted mid-import', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    let release: () => void = () => {}
    vi.mocked(financeApi.bulkCreateTransactions).mockImplementationOnce(
      (rows) => new Promise((resolve) => (release = () => resolve({ created: rows.length }))),
    )
    const { unmount } = await open()
    await upload(bigCsv(700))
    await userEvent.click(await screen.findByRole('button', { name: 'Import 700 transactions' }))
    await screen.findByText(/Importing batch 1 of 4/)

    unmount()
    release()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(financeApi.bulkCreateTransactions).toHaveBeenCalledTimes(1)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('sends every batch of a full import under StrictMode', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <ImportDialog onClose={() => {}} />
        </QueryClientProvider>
      </StrictMode>,
    )
    await screen.findByLabelText('CSV file')
    await upload(bigCsv(450))

    await userEvent.click(await screen.findByRole('button', { name: 'Import 450 transactions' }))

    expect(await screen.findByText('Imported 450 transactions')).toBeInTheDocument()
    expect(sentBatches().map((rows) => rows.length)).toEqual([200, 200, 50])
  })

  it('has one live region from the start and announces progress and the result in it', async () => {
    let release: () => void = () => {}
    vi.mocked(financeApi.bulkCreateTransactions).mockImplementation(
      (rows) => new Promise((resolve) => (release = () => resolve({ created: rows.length }))),
    )
    await open()
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()
    await upload(CSV)

    await userEvent.click(await screen.findByRole('button', { name: 'Import 3 transactions' }))

    await waitFor(() => expect(status).toHaveTextContent(/Importing batch 1 of 1/))
    release()
    await waitFor(() => expect(status).toHaveTextContent('Imported 3 transactions'))
    expect(status.isConnected).toBe(true)
    expect(screen.getAllByRole('status')).toEqual([status])
  })

  it('locks the settings while importing', async () => {
    vi.mocked(financeApi.bulkCreateTransactions).mockImplementation(() => new Promise(() => {}))
    await open()
    await upload(CSV)

    await userEvent.click(await screen.findByRole('button', { name: 'Import 3 transactions' }))

    await screen.findByText(/Importing batch 1 of 1/)
    expect(screen.getByLabelText(/^date column/i)).toBeDisabled()
    expect(screen.getByLabelText('CSV file')).toBeDisabled()
  })

  it('blocks the import when rows need a category the user does not have', async () => {
    vi.mocked(financeApi.listCategories).mockResolvedValue(
      categories.filter((category) => category.kind === 'expense'),
    )
    await open()

    await upload(CSV)

    expect(
      await screen.findByText(
        /1 row needs a category you do not have \(income\)\. Add one in Manage categories first\./,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 3 transactions' })).toBeDisabled()
  })

  it('moves focus to the result when the import ends', async () => {
    await open()
    await upload(CSV)

    await userEvent.click(await screen.findByRole('button', { name: 'Import 3 transactions' }))

    await screen.findByText('Imported 3 transactions')
    await waitFor(() => expect(screen.getByTestId('import-root')).toHaveFocus())
  })
})

describe('ImportDialog: a batch fails', () => {
  it('maps the server\'s "Row N" to the file line, and says what was and was not imported', async () => {
    vi.mocked(financeApi.bulkCreateTransactions)
      .mockImplementationOnce(async (rows) => ({ created: rows.length }))
      .mockRejectedValueOnce(apiError(400, { message: 'Row 3: unknown category' }))
    await open()
    await upload(bigCsv(700))

    await userEvent.click(await screen.findByRole('button', { name: 'Import 700 transactions' }))

    // Batch 2 starts at valid index 200, so its Row 3 is valid index 202, on file line 205.
    expect(await screen.findByText('Line 205: unknown category')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Stopped early: 200 of 700 were imported')
    expect(
      screen.getByText(/Imported: batch 1 of 4 \(200 transactions, lines 3 to 202\)/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Failed: batch 2 of 4 \(lines 203 to 402\)\. Nothing from this batch was imported/,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Not sent: batches 3 to 4 of 4 \(lines 403 to 702\)/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Row 3/)).not.toBeInTheDocument()
  })

  it('tells the user what to remove from the file before importing it again', async () => {
    vi.mocked(financeApi.bulkCreateTransactions)
      .mockImplementationOnce(async (rows) => ({ created: rows.length }))
      .mockRejectedValueOnce(new Error('Network Error'))
    await open()
    await upload(bigCsv(700))

    await userEvent.click(await screen.findByRole('button', { name: 'Import 700 transactions' }))

    expect(
      await screen.findByText(
        'If you import this file again, remove lines 3 to 202 (already saved) first, or they will be added twice.',
      ),
    ).toBeInTheDocument()
  })

  it('gives no such advice when nothing was saved', async () => {
    vi.mocked(financeApi.bulkCreateTransactions).mockRejectedValueOnce(new Error('Network Error'))
    await open()
    await upload(CSV)

    await userEvent.click(await screen.findByRole('button', { name: 'Import 3 transactions' }))

    await screen.findByText(/Stopped early/)
    expect(screen.queryByText(/If you import this file again/)).not.toBeInTheDocument()
  })

  it('retries from the failed batch without sending the batches that succeeded again', async () => {
    vi.mocked(financeApi.bulkCreateTransactions)
      .mockImplementationOnce(async (rows) => ({ created: rows.length }))
      .mockRejectedValueOnce(apiError(400, { message: 'Row 3: unknown category' }))
    await open()
    await upload(bigCsv(700))
    await userEvent.click(await screen.findByRole('button', { name: 'Import 700 transactions' }))
    await screen.findByText('Line 205: unknown category')
    const failed = sentBatches()[1]

    await userEvent.click(screen.getByRole('button', { name: 'Retry from batch 2 of 4' }))

    expect(await screen.findByText('Imported 700 transactions')).toBeInTheDocument()
    expect(sentBatches().map((rows) => rows.length)).toEqual([200, 200, 200, 200, 100])
    expect(sentBatches()[2]).toEqual(failed)
    expect(sentBatches()[3]?.[0]).toMatchObject({ note: 'Item 400' })
  })

  it('does not claim a batch was not saved when the connection dropped', async () => {
    vi.mocked(financeApi.bulkCreateTransactions)
      .mockImplementationOnce(async (rows) => ({ created: rows.length }))
      .mockRejectedValueOnce(new Error('Network Error'))
    await open()
    await upload(bigCsv(700))

    await userEvent.click(await screen.findByRole('button', { name: 'Import 700 transactions' }))

    expect(await screen.findByText(/200 of 700 were imported/)).toBeInTheDocument()
    expect(screen.getByText('Network Error')).toBeInTheDocument()
    expect(screen.getByText(/Failed: batch 2 of 4 \(lines 203 to 402\)/)).toBeInTheDocument()
    expect(screen.getByText(/it may have been saved/)).toBeInTheDocument()
    expect(screen.queryByText(/Nothing from this batch was imported/)).not.toBeInTheDocument()
  })

  it('says nothing was imported when the first batch fails', async () => {
    vi.mocked(financeApi.bulkCreateTransactions).mockRejectedValueOnce(
      apiError(400, { message: 'Row 1: unknown category' }),
    )
    await open()
    await upload(CSV)

    await userEvent.click(await screen.findByRole('button', { name: 'Import 3 transactions' }))

    expect(await screen.findByText('Line 2: unknown category')).toBeInTheDocument()
    expect(screen.getByText('Stopped early: 0 of 3 were imported.')).toBeInTheDocument()
    expect(screen.getByText(/Imported: nothing yet/)).toBeInTheDocument()
  })

  it('sends multibyte notes in batches under the size the API accepts, and maps errors across uneven batches', async () => {
    const note = '\u0d85'.repeat(200)
    const csv = [
      'Date,Description,Amount',
      'not a date,Broken,-1.00',
      ...Array.from({ length: 400 }, () => `2026-09-01,${note},-1.00`),
    ].join('\n')
    vi.mocked(financeApi.bulkCreateTransactions)
      .mockImplementationOnce(async (rows) => ({ created: rows.length }))
      .mockImplementationOnce(async (rows) => ({ created: rows.length }))
      .mockRejectedValueOnce(apiError(400, { message: 'Row 5: unknown category' }))
    await open()
    await upload(csv)

    await userEvent.click(await screen.findByRole('button', { name: 'Import 400 transactions' }))

    // The valid row with index i is on file line i + 3.
    await screen.findByText(/Stopped early/)
    const sizes = sentBatches().map((rows) => rows.length)
    for (const rows of sentBatches()) {
      expect(new TextEncoder().encode(JSON.stringify({ rows })).length).toBeLessThanOrEqual(
        90 * 1024,
      )
    }
    expect(sizes[0]).toBeLessThan(200)
    const start = (sizes[0] ?? 0) + (sizes[1] ?? 0)
    expect(screen.getByText(`Line ${start + 5 + 2}: unknown category`)).toBeInTheDocument()
    expect(
      screen.getByText(
        new RegExp(
          `Failed: batch 3 of \\d \\(lines ${start + 3} to ${start + (sizes[2] ?? 0) + 2}\\)`,
        ),
      ),
    ).toBeInTheDocument()
  })

  it('reports a failure of the last batch, with nothing left unsent, and retries only that batch', async () => {
    vi.mocked(financeApi.bulkCreateTransactions)
      .mockImplementationOnce(async (rows) => ({ created: rows.length }))
      .mockImplementationOnce(async (rows) => ({ created: rows.length }))
      .mockImplementationOnce(async (rows) => ({ created: rows.length }))
      .mockRejectedValueOnce(apiError(400, { message: 'Row 2: unknown category' }))
    await open()
    await upload(bigCsv(700))

    await userEvent.click(await screen.findByRole('button', { name: 'Import 700 transactions' }))

    // Batch 4 holds valid rows 600 to 699, so its Row 2 is valid index 601 on file line 604.
    expect(await screen.findByText('Line 604: unknown category')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Stopped early: 600 of 700 were imported')
    expect(
      screen.getByText(/Imported: batches 1 to 3 of 4 \(600 transactions, lines 3 to 602\)/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Failed: batch 4 of 4 \(lines 603 to 702\)/)).toBeInTheDocument()
    expect(screen.queryByText(/Not sent/)).not.toBeInTheDocument()
    expect(
      screen.getByText(
        /remove lines 3 to 602 \(already saved\) first, or they will be added twice/,
      ),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Retry from batch 4 of 4' }))

    expect(await screen.findByText('Imported 700 transactions')).toBeInTheDocument()
    expect(sentBatches().map((rows) => rows.length)).toEqual([200, 200, 200, 100, 100])
  })

  it('lets the user close the dialog with Escape once a failed import has stopped', async () => {
    vi.mocked(financeApi.bulkCreateTransactions).mockRejectedValueOnce(new Error('Network Error'))
    const onClose = vi.fn()
    await open(onClose)
    await upload(CSV)
    await userEvent.click(await screen.findByRole('button', { name: 'Import 3 transactions' }))
    await screen.findByText(/Stopped early/)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
