import { useState } from 'react'
import { currentMonthIso, formatMonth } from '@/shared/lib/dates'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { useTransactions } from '../api/hooks'
import { CategoryManager } from '../components/CategoryManager'
import { ImportDialog } from '../components/ImportDialog'
import { IncomeExpenseChart } from '../components/IncomeExpenseChart'
import { MonthPicker } from '../components/MonthPicker'
import { NetTrendChart } from '../components/NetTrendChart'
import { SpendingByCategoryChart } from '../components/SpendingByCategoryChart'
import { SummaryCards } from '../components/SummaryCards'
import { TransactionFormModal, type TransactionFormMode } from '../components/TransactionFormModal'
import { TransactionList } from '../components/TransactionList'
import type { RangeMonths } from '../types'
import { useImportGuard } from '../useImportGuard'
import '../finance.css'

type Dialog =
  | { kind: 'transaction'; mode: TransactionFormMode }
  | { kind: 'import' }
  | { kind: 'categories' }
  | null

/**
 * One selected month drives the totals, the spending chart and the list's starting dates. The
 * income and balance charts show the months up to and including it. Everything shown is read
 * through the slice's query hooks, so a change made in a dialog reaches the page by invalidation.
 */
export default function FinancePage() {
  const [month, setMonth] = useState(currentMonthIso)
  const [months, setMonths] = useState<RangeMonths>(6)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [importing, setImporting] = useState(false)
  useImportGuard(importing)
  const close = () => setDialog(null)

  // The list below is filtered to one month, so it cannot tell a new account from a quiet month.
  const anyTransaction = useTransactions({ page: 1, limit: 1 })
  const isNewAccount = anyTransaction.isSuccess && anyTransaction.data.total === 0

  return (
    <div className="finance">
      <div className="finance__header">
        <h1>Finance</h1>
        <MonthPicker value={month} onChange={setMonth} />
        <div className="finance__actions">
          <Button onClick={() => setDialog({ kind: 'categories' })}>Categories</Button>
          <Button onClick={() => setDialog({ kind: 'import' })}>Import CSV</Button>
          <Button
            variant="primary"
            onClick={() => setDialog({ kind: 'transaction', mode: { kind: 'create' } })}
          >
            Add transaction
          </Button>
        </div>
      </div>

      {isNewAccount && (
        <section className="finance__welcome" aria-label="Getting started">
          <h2>No transactions yet</h2>
          <p className="muted">
            Add a transaction or import a CSV file from your bank to fill in the totals and charts
            below.
          </p>
        </section>
      )}

      <section aria-label="Summary">
        <SummaryCards month={month} />
      </section>

      <section className="finance__charts" aria-label="Charts">
        <Card title="Where the money went">
          <SpendingByCategoryChart month={month} />
        </Card>
        <div className="finance__range">
          <label>
            Chart range
            <select
              value={months}
              onChange={(event) => setMonths(Number(event.target.value) as RangeMonths)}
            >
              <option value={6}>6 months</option>
              <option value={12}>12 months</option>
            </select>
          </label>
          <span className="muted">ending {formatMonth(month)}</span>
        </div>
        <Card title="Income vs expenses">
          <IncomeExpenseChart months={months} to={month} />
        </Card>
        <Card title="Balance">
          <NetTrendChart months={months} to={month} />
        </Card>
      </section>

      <Card title="Transactions">
        <TransactionList
          key={month}
          month={month}
          onEdit={(transaction) =>
            setDialog({ kind: 'transaction', mode: { kind: 'edit', transaction } })
          }
        />
      </Card>

      {dialog?.kind === 'transaction' && (
        <TransactionFormModal mode={dialog.mode} onClose={close} />
      )}
      {dialog?.kind === 'import' && (
        <ImportDialog onClose={close} onImportingChange={setImporting} />
      )}
      {dialog?.kind === 'categories' && <CategoryManager onClose={close} />}
    </div>
  )
}
