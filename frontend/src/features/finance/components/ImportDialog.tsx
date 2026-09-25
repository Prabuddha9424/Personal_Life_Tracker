import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import { useSessionUser } from '@/features/auth'
import { formatMinorUnits, isValidCurrencyCode } from '@/shared/lib/money'
import { Button } from '@/shared/ui/Button'
import { FormField } from '@/shared/ui/FormField'
import { Modal } from '@/shared/ui/Modal'
import { ErrorState, LoadingState } from '@/shared/ui/StateViews'
import { listAllTransactionsInRange } from '../api/financeApi'
import { financeKeys } from '../api/financeKeys'
import { useBulkCreateTransactions, useCategories } from '../api/hooks'
import type { CsvRow } from '../csv'
import {
  countExistingDuplicates,
  DATE_FORMATS,
  guessColumns,
  mapRows,
  type DateFormat,
  type ImportMapping,
  type ImportProblem,
} from '../csvImport'
import { planBatches, type PlannedBatch } from '../importBatches'
import { readImportFile } from '../importFile'
import { describeBatchFailure, type BatchFailure } from '../importFailure'
import type { Category, TransactionInput } from '../types'
import '../finance.css'

const PREVIEW_ROWS = 20
const PROBLEMS_SHOWN = 10
const MAX_COLUMNS = 100
const MAX_COLUMN_NAME = 30

// The duplicate check reads at most this many pages of 200, so it can miss older transactions.
const DUPLICATE_CHECK_PAGES = 5
const DUPLICATE_CHECK_LIMIT = DUPLICATE_CHECK_PAGES * 200

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

interface Plan {
  /** Frozen when the import starts: what each request holds and where it starts among the valid rows. */
  batches: PlannedBatch[]
  /** The file line of each valid row, in the order they were sent. */
  lines: number[]
  problems: ImportProblem[]
}

type Run =
  | { plan: Plan; next: number; status: 'running' }
  | { plan: Plan; next: number; status: 'failed'; failure: BatchFailure }
  | { plan: Plan; next: number; status: 'done' }

interface ImportDialogProps {
  onClose: () => void
}

/**
 * Imports the rows of a CSV file as transactions. The profile currency and the categories load
 * first: the currency decides how amounts are read, and rows need a default category.
 *
 * While a batch is being sent the dialog cannot be closed, so a failure is always reported.
 */
export function ImportDialog({ onClose }: ImportDialogProps) {
  const currency = useSessionUser()?.currency
  const categories = useCategories()
  // The ref (not state) is the guard: it is set in the same tick as the click.
  const inFlightRef = useRef(false)

  function requestClose() {
    if (!inFlightRef.current) onClose()
  }

  let body
  if (currency === undefined) {
    body = <LoadingState label="Loading your currency…" />
  } else if (!isValidCurrencyCode(currency)) {
    body = <ErrorState message="Your profile currency is missing or invalid. Update it first." />
  } else if (categories.data) {
    body = (
      <ImportForm
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
    <Modal title="Import transactions from CSV" onClose={requestClose}>
      {body}
    </Modal>
  )
}

interface ImportFormProps {
  currency: string
  categories: Category[]
  inFlightRef: RefObject<boolean>
  onClose: () => void
}

function ImportForm({ currency, categories, inFlightRef, onClose }: ImportFormProps) {
  const bulk = useBulkCreateTransactions()
  const readToken = useRef(0)

  const [rows, setRows] = useState<CsvRow[] | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [skip, setSkip] = useState(0)
  const [hasHeader, setHasHeader] = useState(true)
  const [dateColumn, setDateColumn] = useState(0)
  const [amountColumn, setAmountColumn] = useState(1)
  const [noteColumn, setNoteColumn] = useState<number | null>(null)
  const [kindColumn, setKindColumn] = useState<number | null>(null)
  const [categoryColumn, setCategoryColumn] = useState<number | null>(null)
  const [dateFormat, setDateFormat] = useState<DateFormat>('YYYY-MM-DD')
  const [negativeIsExpense, setNegativeIsExpense] = useState(true)
  const [expenseChoice, setExpenseChoice] = useState('')
  const [incomeChoice, setIncomeChoice] = useState('')
  const [run, setRun] = useState<Run | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  const importing = run?.status === 'running'
  const finished = run !== null && run.status !== 'running'

  useEffect(() => {
    if (finished) resultRef.current?.focus()
  }, [finished])

  const expenseCategories = categories.filter((category) => category.kind === 'expense')
  const incomeCategories = categories.filter((category) => category.kind === 'income')
  const expenseCategoryId = chosenOrDefault(expenseCategories, expenseChoice)
  const incomeCategoryId = chosenOrDefault(incomeCategories, incomeChoice)

  const dataRows = useMemo(() => rows?.slice(skip) ?? [], [rows, skip])
  const header = hasHeader ? dataRows[0]?.cells : undefined
  const columnCount = useMemo(
    () =>
      Math.min(
        MAX_COLUMNS,
        dataRows.reduce((most, row) => Math.max(most, row.cells.length), 0),
      ),
    [dataRows],
  )

  const mapped = useMemo(() => {
    const mapping: ImportMapping = {
      dateColumn,
      amountColumn,
      noteColumn,
      kindColumn,
      categoryColumn,
      categories,
      dateFormat,
      negativeIsExpense,
      expenseCategoryId,
      incomeCategoryId,
      currency,
    }
    return mapRows(dataRows, mapping, hasHeader)
  }, [
    dataRows,
    hasHeader,
    dateColumn,
    amountColumn,
    noteColumn,
    kindColumn,
    categoryColumn,
    categories,
    dateFormat,
    negativeIsExpense,
    expenseCategoryId,
    incomeCategoryId,
    currency,
  ])

  const dateRange = useMemo(() => {
    let first: string | undefined
    let last: string | undefined
    for (const row of mapped.valid) {
      if (first === undefined || row.date < first) first = row.date
      if (last === undefined || row.date > last) last = row.date
    }
    return first === undefined || last === undefined ? null : { from: first, to: last }
  }, [mapped.valid])
  const existing = useQuery({
    queryKey: financeKeys.existingInRange(dateRange?.from ?? '', dateRange?.to ?? ''),
    queryFn: () =>
      listAllTransactionsInRange(dateRange?.from ?? '', dateRange?.to ?? '', DUPLICATE_CHECK_PAGES),
    // Each imported batch invalidates finance queries; the check is no use once writing starts.
    enabled: dateRange !== null && run === null,
  })
  const duplicates = useMemo(
    () => (existing.data ? countExistingDuplicates(mapped.valid, existing.data) : 0),
    [existing.data, mapped.valid],
  )
  const checkMayBeIncomplete = (existing.data?.length ?? 0) >= DUPLICATE_CHECK_LIMIT

  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  )
  const ready = mapped.valid.length
  const problems = mapped.problems.length
  const withoutCategory = mapped.valid.filter((row) => row.categoryId === '')
  const missingKinds = new Set(withoutCategory.map((row) => row.kind))

  function applyGuess(nextRows: CsvRow[], nextSkip: number, nextHasHeader: boolean) {
    const first = nextRows[nextSkip]?.cells ?? []
    const guess = guessColumns(nextHasHeader ? first : first.map(() => ''))
    setDateColumn(guess.dateColumn)
    setAmountColumn(guess.amountColumn)
    setNoteColumn(guess.noteColumn)
    setKindColumn(null)
    setCategoryColumn(null)
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const token = (readToken.current += 1)
    const result = await readImportFile(file)
    if (token !== readToken.current) return

    if ('error' in result) {
      setRows(null)
      setFileError(result.error)
      return
    }
    setFileError(null)
    setRows(result.rows)
    setSkip(0)
    setHasHeader(true)
    setDateFormat('YYYY-MM-DD')
    setNegativeIsExpense(true)
    applyGuess(result.rows, 0, true)
  }

  function onSkipChange(event: ChangeEvent<HTMLInputElement>) {
    if (!rows) return
    const wanted = Number.parseInt(event.target.value, 10)
    const next = Number.isNaN(wanted) ? 0 : Math.min(Math.max(wanted, 0), rows.length - 1)
    setSkip(next)
    applyGuess(rows, next, hasHeader)
  }

  function onHeaderChange(next: boolean) {
    setHasHeader(next)
    if (rows) applyGuess(rows, skip, next)
  }

  async function send(plan: Plan, first: number) {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      for (const [index, batch] of plan.batches.entries()) {
        if (index < first) continue
        setRun({ plan, next: index, status: 'running' })
        try {
          await bulk.mutateAsync(batch.rows)
        } catch (error) {
          const failure = describeBatchFailure(error, plan.lines, batch.start)
          setRun({ plan, next: index, status: 'failed', failure })
          return
        }
      }
      setRun({ plan, next: plan.batches.length, status: 'done' })
    } finally {
      inFlightRef.current = false
    }
  }

  function onImport() {
    if (inFlightRef.current || ready === 0 || withoutCategory.length > 0) return
    void send(
      { batches: planBatches(mapped.valid), lines: mapped.lines, problems: mapped.problems },
      0,
    )
  }

  if (finished) {
    return (
      <ImportResult
        run={run}
        resultRef={resultRef}
        onRetry={() => void send(run.plan, run.next)}
        onClose={onClose}
      />
    )
  }

  const noteHint =
    header && noteColumn !== null && (header[noteColumn] ?? '').trim() === ''
      ? 'This column has no name in the header. Check that it holds the descriptions.'
      : undefined
  return (
    <div className="import">
      <fieldset className="import__fields" disabled={importing}>
        <FormField label="CSV file" error={fileError ?? undefined}>
          <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} />
        </FormField>

        {rows && (
          <>
            <p className="muted import__help">
              The first row is normally a header with the column names. If the file starts with a
              title or other lines above the header, enter how many rows to skip. Rows that cannot
              be read are skipped and listed below, and a column with no name in the header is
              marked. Letter-only currency symbols (Rs, kr, zł) are not supported: remove the symbol
              or use the ISO code, such as {currency}.
            </p>
            <div className="import__grid">
              <FormField label="Rows to skip at the top">
                <input
                  type="number"
                  min={0}
                  max={rows.length - 1}
                  inputMode="numeric"
                  value={skip}
                  onChange={onSkipChange}
                />
              </FormField>
              <label className="import__check">
                <input
                  type="checkbox"
                  checked={hasHeader}
                  onChange={(event) => onHeaderChange(event.target.checked)}
                />
                First row is a header
              </label>
            </div>
            <div className="import__grid">
              <ColumnSelect
                label="Date column"
                value={dateColumn}
                onChange={(next) => setDateColumn(next ?? 0)}
                header={header}
                count={columnCount}
              />
              <ColumnSelect
                label="Amount column"
                value={amountColumn}
                onChange={(next) => setAmountColumn(next ?? 0)}
                header={header}
                count={columnCount}
              />
              <ColumnSelect
                label="Note column"
                value={noteColumn}
                onChange={setNoteColumn}
                header={header}
                count={columnCount}
                optional
                hint={noteHint}
              />
              <ColumnSelect
                label="Type column (income or expense)"
                value={kindColumn}
                onChange={setKindColumn}
                header={header}
                count={columnCount}
                optional
              />
              <ColumnSelect
                label="Category column"
                value={categoryColumn}
                onChange={setCategoryColumn}
                header={header}
                count={columnCount}
                optional
              />
              <FormField label="Date format">
                <select
                  value={dateFormat}
                  onChange={(event) => setDateFormat(event.target.value as DateFormat)}
                >
                  {DATE_FORMATS.map((format) => (
                    <option key={format} value={format}>
                      {format}
                    </option>
                  ))}
                </select>
              </FormField>
              <CategorySelect
                label="Category for spending"
                list={expenseCategories}
                value={expenseCategoryId}
                onChange={setExpenseChoice}
              />
              <CategorySelect
                label="Category for income"
                list={incomeCategories}
                value={incomeCategoryId}
                onChange={setIncomeChoice}
              />
            </div>
            <label className="import__check">
              <input
                type="checkbox"
                checked={!negativeIsExpense}
                disabled={kindColumn !== null}
                onChange={(event) => setNegativeIsExpense(!event.target.checked)}
              />
              Positive amounts are spending
            </label>
            <p className="muted import__help">
              {kindColumn === null
                ? 'By default a negative amount is spending and a positive amount is income. Tick the box for card exports that list purchases as positive numbers.'
                : 'The type column decides which rows are spending and which are income, so the sign of the amount is ignored.'}
            </p>
            {columnCount === MAX_COLUMNS && (
              <p className="muted import__help">
                Only the first {MAX_COLUMNS} columns of the file can be chosen.
              </p>
            )}

            <p aria-live="polite">{plural(ready, 'row', 'rows')} ready to import</p>
            {problems > 0 && (
              <>
                <p role="alert">
                  {plural(problems, 'row has a problem', 'rows have problems')} and will be skipped
                </p>
                <ProblemList problems={mapped.problems} label="Rows that will be skipped" />
              </>
            )}
            {withoutCategory.length > 0 && (
              <p className="form-error" role="alert">
                {plural(withoutCategory.length, 'row needs', 'rows need')} a category you do not
                have ({[...missingKinds].join(' and ')}). Add one in Manage categories first.
              </p>
            )}
            {existing.isError && (
              <p className="muted">
                Could not check for duplicates. The rows can still be imported.
              </p>
            )}
            {duplicates > 0 && (
              <p className="muted">
                {plural(
                  duplicates,
                  'row looks like a transaction you already have',
                  'rows look like transactions you already have',
                )}
                . They will still be imported.
              </p>
            )}
            {checkMayBeIncomplete && (
              <p className="muted">
                Possible duplicates were checked against your first {DUPLICATE_CHECK_LIMIT}{' '}
                transactions in this date range, so some may not have been found.
              </p>
            )}

            {ready > 0 && (
              <PreviewTable
                valid={mapped.valid}
                lines={mapped.lines}
                total={ready}
                currency={currency}
                categoryNames={categoryNames}
              />
            )}

            <div className="form-actions">
              {ready > 0 && (
                <Button
                  variant="primary"
                  onClick={onImport}
                  loading={importing}
                  disabled={withoutCategory.length > 0}
                >
                  {`Import ${plural(ready, 'transaction', 'transactions')}`}
                </Button>
              )}
            </div>
          </>
        )}
      </fieldset>
      {run?.status === 'running' && (
        <div role="status" className="import__progress">
          <p>
            Importing batch {run.next + 1} of {run.plan.batches.length}:{' '}
            {countBefore(run.plan, run.next)} of {countAll(run.plan)} transactions imported
          </p>
          <progress
            aria-label="Import progress"
            value={countBefore(run.plan, run.next)}
            max={countAll(run.plan)}
          />
        </div>
      )}
    </div>
  )
}

interface ColumnSelectProps {
  label: string
  value: number | null
  onChange: (next: number | null) => void
  header: readonly string[] | undefined
  count: number
  optional?: boolean
  hint?: string
}

function ColumnSelect({
  label,
  value,
  onChange,
  header,
  count,
  optional,
  hint,
}: ColumnSelectProps) {
  return (
    <FormField label={label} hint={hint}>
      <select
        value={value ?? ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
      >
        {optional && <option value="">None</option>}
        {Array.from({ length: count }, (_, index) => (
          <option key={index} value={index}>
            {columnLabel(header, index)}
          </option>
        ))}
      </select>
    </FormField>
  )
}

interface CategorySelectProps {
  label: string
  list: Category[]
  value: string
  onChange: (next: string) => void
}

function CategorySelect({ label, list, value, onChange }: CategorySelectProps) {
  return (
    <FormField label={label}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {list.length === 0 && <option value="">None available</option>}
        {list.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
    </FormField>
  )
}

/** The user's choice if it still exists, else "Other", else the first category, else none. */
function chosenOrDefault(list: Category[], choice: string): string {
  const found =
    list.find((category) => category.id === choice) ??
    list.find((category) => category.name === 'Other') ??
    list[0]
  return found?.id ?? ''
}

function countBefore(plan: Plan, batchIndex: number): number {
  return plan.batches.slice(0, batchIndex).reduce((sum, batch) => sum + batch.rows.length, 0)
}

function countAll(plan: Plan): number {
  return countBefore(plan, plan.batches.length)
}

function columnLabel(header: readonly string[] | undefined, index: number): string {
  if (!header) return `Column ${index + 1}`
  const name = (header[index] ?? '').trim()
  if (name === '') return `${index + 1}: (no name)`
  const short = name.length > MAX_COLUMN_NAME ? `${name.slice(0, MAX_COLUMN_NAME)}…` : name
  return `${index + 1}: ${short}`
}

/** A message that already names its lines ("Lines 3–5: ...") is not given a second prefix. */
function problemText({ line, message }: ImportProblem): string {
  return /^Lines \d/.test(message) ? message : `Line ${line}: ${message}`
}

function ProblemList({ problems, label }: { problems: ImportProblem[]; label: string }) {
  return (
    <ul className="import__problems" aria-label={label}>
      {problems.slice(0, PROBLEMS_SHOWN).map((problem) => (
        <li key={problem.line}>{problemText(problem)}</li>
      ))}
      {problems.length > PROBLEMS_SHOWN && <li>…and {problems.length - PROBLEMS_SHOWN} more</li>}
    </ul>
  )
}

interface PreviewTableProps {
  valid: TransactionInput[]
  lines: number[]
  total: number
  currency: string
  categoryNames: Map<string, string>
}

/** The first rows exactly as they will be saved. Cell text is only ever rendered as text. */
function PreviewTable({ valid, lines, total, currency, categoryNames }: PreviewTableProps) {
  const shown = Math.min(total, PREVIEW_ROWS)
  return (
    <div
      className="import__scroll"
      role="region"
      aria-label="Preview of rows to import"
      tabIndex={0}
    >
      <table className="import__table">
        <caption>
          Preview of the first {shown} of {total} rows to import
        </caption>
        <thead>
          <tr>
            <th scope="col">Line</th>
            <th scope="col">Date</th>
            <th scope="col">Type</th>
            <th scope="col">Amount</th>
            <th scope="col">Category</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {valid.slice(0, PREVIEW_ROWS).map((row, index) => (
            <tr key={lines[index]}>
              <th scope="row">{lines[index]}</th>
              <td>{row.date}</td>
              <td>{row.kind === 'income' ? 'Income' : 'Spending'}</td>
              <td className="import__amount">{formatMinorUnits(row.amountMinor, currency)}</td>
              <td className="import__text">{categoryNames.get(row.categoryId) ?? ''}</td>
              <td className="import__text">{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** "batch 2 of 4" or "batches 2 to 3 of 4" for the batches with index `from` up to (not including) `to`. */
function batchRange(from: number, to: number, count: number): string {
  return to - from === 1
    ? `batch ${from + 1} of ${count}`
    : `batches ${from + 1} to ${to} of ${count}`
}

/** "lines 3 to 202" for the valid rows with index `from` up to (not including) `to`. */
function lineRange(plan: Plan, from: number, to: number): string {
  const firstBatch = plan.batches[from]
  const lastBatch = plan.batches[to - 1]
  const first = plan.lines[firstBatch?.start ?? 0]
  const last = plan.lines[(lastBatch?.start ?? 0) + (lastBatch?.rows.length ?? 0) - 1]
  return first === last ? `line ${first}` : `lines ${first} to ${last}`
}

interface ImportResultProps {
  run: Extract<Run, { status: 'done' | 'failed' }>
  resultRef: RefObject<HTMLDivElement | null>
  onRetry: () => void
  onClose: () => void
}

function ImportResult({ run, resultRef, onRetry, onClose }: ImportResultProps) {
  const { plan } = run
  const batches = plan.batches.length
  const imported = countBefore(plan, run.next)
  const total = countAll(plan)
  const skipped = plan.problems.length

  return (
    <div
      className="import import__result"
      ref={resultRef}
      tabIndex={-1}
      data-testid="import-result"
    >
      {run.status === 'done' ? (
        <p role="status">Imported {plural(imported, 'transaction', 'transactions')}</p>
      ) : (
        <>
          <p role="alert">
            Stopped early: {imported} of {total} were imported.
          </p>
          <p className="form-error">{run.failure.message}</p>
          <ul className="import__batches">
            <li>
              Imported:{' '}
              {run.next === 0
                ? 'nothing yet'
                : `${batchRange(0, run.next, batches)} (${plural(imported, 'transaction', 'transactions')}, ${lineRange(plan, 0, run.next)})`}
            </li>
            <li>
              Failed: {batchRange(run.next, run.next + 1, batches)} (
              {lineRange(plan, run.next, run.next + 1)}).{' '}
              {run.failure.rejected
                ? 'Nothing from this batch was imported.'
                : 'The server saves a batch all or nothing and probably did not save this one, but if the connection dropped after it was sent it may have been saved. Check your transactions for these lines before retrying, or they may be added twice.'}
            </li>
            {run.next + 1 < batches && (
              <li>
                Not sent: {batchRange(run.next + 1, batches, batches)} (
                {lineRange(plan, run.next + 1, batches)}).
              </li>
            )}
          </ul>
        </>
      )}
      {skipped > 0 ? (
        <>
          <p>Skipped {plural(skipped, 'row with a problem', 'rows with problems')}</p>
          <ProblemList problems={plan.problems} label="Rows that were skipped" />
        </>
      ) : (
        <p>Nothing was skipped</p>
      )}
      <div className="form-actions">
        {run.status === 'failed' && (
          <Button variant="primary" onClick={onRetry}>
            {`Retry from ${batchRange(run.next, run.next + 1, batches)}`}
          </Button>
        )}
        <Button variant={run.status === 'failed' ? 'secondary' : 'primary'} onClick={onClose}>
          {run.status === 'failed' ? 'Close' : 'Done'}
        </Button>
      </div>
    </div>
  )
}
