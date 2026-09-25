import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import { formatMonth } from '@/shared/lib/dates'
import { formatMinorUnits, minorToMajor } from '@/shared/lib/money'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/StateViews'
import { useBalanceTrend } from '../api/hooks'
import '../chartSetup'
import { baseOptions, moneyScales, tooltipColors } from '../chartOptions'
import type { BalanceTrend, RangeMonths } from '../types'
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
  items: BalanceTrend['items']
}

function NetTrendPlot({ months, to, currency, items }: PlotProps) {
  const colors = useChartColors()
  const reducedMotion = useReducedMotion()
  const caption = `Balance, ${windowLabel(months, to)}`

  const data = useMemo(
    () => ({
      labels: items.map((item) => formatMonth(item.month)),
      datasets: [
        {
          label: 'Balance',
          // Display only: the stored amounts stay integers.
          data: items.map((item) => minorToMajor(item.balanceMinor, currency)),
          borderColor: colors.accent,
          backgroundColor: colors.accent,
          pointRadius: 4,
          tension: 0.25,
        },
      ],
    }),
    [items, currency, colors.accent],
  )

  const options = useMemo(
    () => ({
      ...baseOptions(reducedMotion),
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipColors(colors),
          callbacks: {
            label: (context: { dataIndex: number }) => {
              const item = items[context.dataIndex]
              return item ? `Balance: ${formatMinorUnits(item.balanceMinor, currency)}` : ''
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
  const summary =
    first && last
      ? `Line chart of the balance from ${formatMonth(first.month)} to ${formatMonth(last.month)}, ` +
        `ending at ${formatMinorUnits(last.balanceMinor, currency)}. ` +
        'The same data is in the table that follows.'
      : ''

  return (
    <figure className="chart">
      <figcaption>{caption}</figcaption>
      <div className="chart__canvas">
        <Line role="img" aria-label={summary} data={data} options={options} />
      </div>
      <ChartDataTable
        caption={caption}
        columns={['Month', 'Balance']}
        rows={items.map((item) => [
          formatMonth(item.month),
          formatMinorUnits(item.balanceMinor, currency),
        ])}
      />
    </figure>
  )
}

export function NetTrendChart({ months = 6, to }: { months?: RangeMonths; to?: string }) {
  const query = useBalanceTrend(months, to)

  if (query.isPending) return <LoadingState label="Loading chart…" />
  if (query.isError) {
    return <ErrorState message="Could not load the balance" onRetry={() => query.refetch()} />
  }

  const { items, currency, openingMinor } = query.data
  if (
    items.length === 0 ||
    (openingMinor === 0 && items.every((item) => item.balanceMinor === 0))
  ) {
    return (
      <EmptyState
        title="No balance to show yet"
        description="Add income and expenses to see your balance."
      />
    )
  }

  return <NetTrendPlot months={months} to={to} currency={currency} items={items} />
}
