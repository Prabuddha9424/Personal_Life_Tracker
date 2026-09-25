import { useId, useState } from 'react'
import { formatDate } from '@/shared/lib/dates'
import { formatMinorUnits } from '@/shared/lib/money'
import { Button } from '@/shared/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/StateViews'
import type { ListTransactionsParams } from '../api/financeApi'
import { useCategories, useTransactions } from '../api/hooks'
import { isReportableDate } from '../transactionForm'
import type { Transaction, TransactionKind } from '../types'
import '../finance.css'

const PAGE_SIZE = 20
/** The years the server accepts in a date filter. */
const FIRST_DATE = '2000-01-01'
const LAST_DATE = '2100-12-31'

interface DateRange {
  from: string
  to: string
}

interface TransactionListProps {
  onEdit: (transaction: Transaction) => void
}

function dateProblem({ from, to }: DateRange): string | null {
  if ([from, to].some((value) => value !== '' && !isReportableDate(value))) {
    return 'Use dates from 2000 to 2100'
  }
  if (from !== '' && to !== '' && from > to) return 'The start date must not be after the end date'
  return null
}

export function TransactionList({ onEdit }: TransactionListProps) {
  const problemId = useId()
  const [kind, setKind] = useState<TransactionKind | ''>('')
  const [categoryId, setCategoryId] = useState('')
  // What the inputs show, and the last range that was valid to send.
  const [dates, setDates] = useState<DateRange>({ from: '', to: '' })
  const [applied, setApplied] = useState<DateRange>({ from: '', to: '' })
  const [page, setPage] = useState(1)
  const categoriesQuery = useCategories()
  const categories = categoriesQuery.data ?? []
  const problem = dateProblem(dates)

  const params: ListTransactionsParams = { page, limit: PAGE_SIZE }
  if (kind) params.kind = kind
  if (categoryId) params.categoryId = categoryId
  if (applied.from) params.from = applied.from
  if (applied.to) params.to = applied.to
  const query = useTransactions(params)

  const categoryName = (id: string): string => {
    if (categoriesQuery.isError && !categoriesQuery.data) return 'Category unavailable'
    if (!categoriesQuery.data) return '…'
    return categoriesQuery.data.find((category) => category.id === id)?.name ?? 'Deleted category'
  }

  function onKindChange(next: TransactionKind | '') {
    setKind(next)
    const current = categories.find((category) => category.id === categoryId)
    if (next && current && current.kind !== next) setCategoryId('')
    setPage(1)
  }

  function onDateChange(key: keyof DateRange, value: string) {
    const next = { ...dates, [key]: value }
    setDates(next)
    if (dateProblem(next) === null) {
      setApplied(next)
      setPage(1)
    }
  }

  const data = query.data
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1
  // A page can empty from under the reader (its last row was deleted): step back to one that exists.
  if (data && !query.isPlaceholderData && page > pageCount) setPage(pageCount)

  const filtered = kind !== '' || categoryId !== '' || applied.from !== '' || applied.to !== ''
  const items = data?.items ?? []
  const waitingForPage = query.isPlaceholderData && items.length === 0
  const categoryOptions = kind
    ? categories.filter((category) => category.kind === kind)
    : categories
  const describedBy = problem ? problemId : undefined

  return (
    <section aria-label="Transactions" aria-busy={query.isPlaceholderData || undefined}>
      <div className="tx-filters">
        <label>
          Type
          <select
            value={kind}
            onChange={(event) => onKindChange(event.target.value as TransactionKind | '')}
          >
            <option value="">All</option>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </label>
        <label>
          Category
          <select
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value)
              setPage(1)
            }}
          >
            <option value="">All</option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            min={FIRST_DATE}
            max={LAST_DATE}
            value={dates.from}
            aria-invalid={problem ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => onDateChange('from', event.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            min={FIRST_DATE}
            max={LAST_DATE}
            value={dates.to}
            aria-invalid={problem ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => onDateChange('to', event.target.value)}
          />
        </label>
      </div>
      {problem && (
        <p id={problemId} className="form-error" role="alert">
          {problem}
        </p>
      )}

      {!problem && (query.isPending || waitingForPage) && (
        <LoadingState label="Loading transactions…" />
      )}
      {!problem && query.isError && (
        <ErrorState message="Could not load transactions" onRetry={() => query.refetch()} />
      )}

      {!problem && query.isSuccess && !waitingForPage && items.length === 0 && (
        <EmptyState
          title={filtered ? 'No transactions match these filters' : 'No transactions yet'}
          description={
            filtered
              ? 'Try widening the dates or clearing a filter.'
              : 'Add your first transaction to get started.'
          }
        />
      )}

      {!problem && query.isSuccess && items.length > 0 && (
        <>
          <div className="tx-table-wrap">
            <table className="tx-table">
              <caption className="visually-hidden">Transactions</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Category</th>
                  <th scope="col">Note</th>
                  <th scope="col" className="tx-table__amount">
                    Amount
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((transaction) => {
                  const income = transaction.kind === 'income'
                  const name = categoryName(transaction.categoryId)
                  return (
                    <tr key={transaction.id}>
                      <td>{formatDate(transaction.date)}</td>
                      <td className="tx-table__text">{name}</td>
                      <td className="tx-table__text">{transaction.note}</td>
                      <td className="tx-table__amount">
                        <span className={income ? 'is-positive' : undefined}>
                          {income ? '+' : '-'}
                          {formatMinorUnits(transaction.amountMinor, transaction.currency)}
                        </span>
                        <span className="tx-table__kind">{income ? 'Income' : 'Expense'}</span>
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          className="tx-table__edit"
                          aria-label={`Edit ${transaction.note || `${name} on ${formatDate(transaction.date)}`}`}
                          onClick={() => onEdit(transaction)}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="tx-pager">
            <Button
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <span aria-live="polite">
              Page {page} of {pageCount}
            </span>
            <Button
              aria-label="Next page"
              disabled={page >= pageCount}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
