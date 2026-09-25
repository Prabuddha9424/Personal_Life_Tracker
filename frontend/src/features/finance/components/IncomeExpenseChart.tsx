import { useMemo } from 'react'
import { Bar } from 'react-chartjs-2'
import { formatMonth } from '@/shared/lib/dates'
import { formatMinorUnits, minorToMajor } from '@/shared/lib/money'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/StateViews'
import { useMonthlyTotals } from '../api/hooks'
import '../chartSetup'
import { baseOptions, moneyScales, tooltipColors } from '../chartOptions'
import type { MonthlyItem, RangeMonths } from '../types'
import { useChartColors } from '../useChartColors'
import { useReducedMotion } from '../useReducedMotion'
import '../finance.css'
import { ChartDataTable } from './ChartDataTable'
import { windowLabel } from './windowLabel'

interface PlotProps {
  months: RangeMonths
  /** The last month of the window, when the caller chose one. */
  to?: string
  currency: string
  items: MonthlyItem[]
}

function IncomeExpensePlot({ months, to, currency, items }: PlotProps) {
  const colors = useChartColors()
  const reducedMotion = useReducedMotion()
  const caption = `Income and expenses, ${windowLabel(months, to)}`

  const data = useMemo(
    () => ({
      labels: items.map((item) => formatMonth(item.month)),
      datasets: [
        {
          label: 'Income',
          // Display only: the stored amounts stay integers.
          data: items.map((item) => minorToMajor(item.incomeMinor, currency)),
          backgroundColor: colors.positive,
        },
        {
          label: 'Expenses',
          data: items.map((item) => minorToMajor(item.expenseMinor, currency)),
          backgroundColor: colors.danger,
        },
      ],
    }),
    [items, currency, colors.positive, colors.danger],
  )

  const options = useMemo(
    () => ({
      ...baseOptions(reducedMotion),
      plugins: {
        legend: { labels: { color: colors.text } },
        tooltip: {
          ...tooltipColors(colors),
          callbacks: {
            label: (context: { datasetIndex: number; dataIndex: number }) => {
              const item = items[context.dataIndex]
              if (!item) return ''
              return context.datasetIndex === 0
                ? `Income: ${formatMinorUnits(item.incomeMinor, currency)}`
                : `Expenses: ${formatMinorUnits(item.expenseMinor, currency)}`
            },
          },
        },
      },
      scales: moneyScales(colors, currency),
    }),
    [items, currency, colors, reducedMotion],
  )

  const first = items[0]
  const last = items[items.length - 1]
  const span =
    first && last && first !== last
      ? `${formatMonth(first.month)} to ${formatMonth(last.month)}`
      : formatMonth(first?.month ?? '')
  const summary = `Bar chart of income and expenses per month, ${span}. The same data is in the table that follows.`

  return (
    <figure className="chart">
      <figcaption>{caption}</figcaption>
      <div className="chart__canvas">
        <Bar role="img" aria-label={summary} data={data} options={options} />
      </div>
      <ChartDataTable
        caption={caption}
        columns={['Month', 'Income', 'Expenses']}
        rows={items.map((item) => [
          formatMonth(item.month),
          formatMinorUnits(item.incomeMinor, currency),
          formatMinorUnits(item.expenseMinor, currency),
        ])}
      />
    </figure>
  )
}

export function IncomeExpenseChart({ months = 6, to }: { months?: RangeMonths; to?: string }) {
  const query = useMonthlyTotals(months, to)

  if (query.isPending) return <LoadingState label="Loading chart…" />
  if (query.isError) {
    return <ErrorState message="Could not load totals" onRetry={() => query.refetch()} />
  }

  const { items, currency } = query.data
  if (items.every((item) => item.incomeMinor === 0 && item.expenseMinor === 0)) {
    return (
      <EmptyState
        title="No income or expenses yet"
        description="Add a transaction to see monthly totals."
      />
    )
  }

  return <IncomeExpensePlot months={months} to={to} currency={currency} items={items} />
}
