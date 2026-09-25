import { formatMonth } from '@/shared/lib/dates'
import { formatMinorUnits } from '@/shared/lib/money'
import { Card } from '@/shared/ui/Card'
import { ErrorState, LoadingState } from '@/shared/ui/StateViews'
import { useMonthSummary } from '../api/hooks'
import '../finance.css'

function netClass(netMinor: number): string {
  if (netMinor < 0) return 'is-negative'
  return netMinor > 0 ? 'is-positive' : ''
}

/**
 * Income, expenses and net for one month. The live region stays mounted and holds a single
 * sentence once the totals are in, so a month change is announced once, not once per card.
 */
export function SummaryCards({ month }: { month: string }) {
  const query = useMonthSummary(month)
  const data = query.data
  const label = formatMonth(month)

  const announcement = data
    ? `${label}: income ${formatMinorUnits(data.incomeMinor, data.currency)}, expenses ${formatMinorUnits(data.expenseMinor, data.currency)}, net ${formatMinorUnits(data.netMinor, data.currency)}`
    : ''

  return (
    <>
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      {query.isPending && <LoadingState label="Loading totals…" />}
      {query.isError && (
        <ErrorState message="Could not load totals" onRetry={() => query.refetch()} />
      )}
      {query.isSuccess && (
        <>
          <div className="summary-cards">
            <Card title="Income">
              <p className="summary-cards__value is-positive">
                {formatMinorUnits(query.data.incomeMinor, query.data.currency)}
              </p>
            </Card>
            <Card title="Expenses">
              <p className="summary-cards__value">
                {formatMinorUnits(query.data.expenseMinor, query.data.currency)}
              </p>
            </Card>
            <Card title="Net">
              <p className={`summary-cards__value ${netClass(query.data.netMinor)}`}>
                {formatMinorUnits(query.data.netMinor, query.data.currency)}
              </p>
              {query.data.netMinor < 0 && (
                <p className="summary-cards__note">Spent more than earned</p>
              )}
            </Card>
          </div>
          {query.data.incomeMinor === 0 && query.data.expenseMinor === 0 && (
            <p className="summary-cards__note">No transactions in {label}</p>
          )}
        </>
      )}
    </>
  )
}
