import { useMemo } from 'react'
import { Doughnut } from 'react-chartjs-2'
import { formatMonth } from '@/shared/lib/dates'
import { formatMinorUnits, minorToMajor } from '@/shared/lib/money'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/StateViews'
import { useSpendingByCategory } from '../api/hooks'
import '../chartSetup'
import { baseOptions, tooltipColors } from '../chartOptions'
import type { CategorySpend } from '../types'
import { useChartColors } from '../useChartColors'
import { useReducedMotion } from '../useReducedMotion'
import '../finance.css'
import { ChartDataTable } from './ChartDataTable'

interface PlotProps {
  month: string
  currency: string
  items: CategorySpend[]
}

function SpendingPlot({ month, currency, items }: PlotProps) {
  const colors = useChartColors()
  const reducedMotion = useReducedMotion()
  const monthName = formatMonth(month)
  const caption = `Spending by category, ${monthName}`

  const segmentColors = items.map((_, index) => colors.series[index % colors.series.length] ?? '')

  const data = useMemo(
    () => ({
      labels: items.map((item) => item.name),
      datasets: [
        {
          // Display only: the stored amounts stay integers.
          data: items.map((item) => minorToMajor(item.totalMinor, currency)),
          backgroundColor: segmentColors,
          borderColor: colors.surface,
          borderWidth: 2,
        },
      ],
    }),
    // segmentColors is derived from colors.series and items, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, currency, colors.series, colors.surface],
  )

  const options = useMemo(
    () => ({
      ...baseOptions(reducedMotion),
      cutout: '55%',
      plugins: {
        // The legend is HTML below the chart: it wraps long names and needs no canvas clicks.
        legend: { display: false },
        tooltip: {
          ...tooltipColors(colors),
          callbacks: {
            label: (context: { dataIndex: number }) => {
              const item = items[context.dataIndex]
              return item ? `${item.name}: ${formatMinorUnits(item.totalMinor, currency)}` : ''
            },
          },
        },
      },
    }),
    [items, currency, colors, reducedMotion],
  )

  const largest = items.reduce((top, item) => (item.totalMinor > top.totalMinor ? item : top))
  const summary =
    `Doughnut chart of spending by category for ${monthName}: ` +
    `${items.length} ${items.length === 1 ? 'category' : 'categories'}, ` +
    `largest ${largest.name} at ${formatMinorUnits(largest.totalMinor, currency)}. ` +
    'The same data is in the table that follows.'

  return (
    <figure className="chart">
      <figcaption>{caption}</figcaption>
      <div className="chart__canvas">
        <Doughnut role="img" aria-label={summary} data={data} options={options} />
      </div>
      <ul className="chart-legend" aria-hidden="true">
        {items.map((item, index) => (
          <li key={index} className="chart-legend__item">
            <span
              className="chart-legend__swatch"
              style={{ backgroundColor: segmentColors[index] }}
            />
            <span className="chart-legend__name">{item.name}</span>
            <span className="chart-legend__amount">
              {formatMinorUnits(item.totalMinor, currency)}
            </span>
          </li>
        ))}
      </ul>
      <ChartDataTable
        caption={caption}
        columns={['Rank', 'Category', 'Amount']}
        rows={items.map((item, index) => [
          String(index + 1),
          item.name,
          formatMinorUnits(item.totalMinor, currency),
        ])}
      />
    </figure>
  )
}

export function SpendingByCategoryChart({ month }: { month: string }) {
  const query = useSpendingByCategory(month)

  if (query.isPending) return <LoadingState label="Loading chart…" />
  if (query.isError) {
    return <ErrorState message="Could not load spending" onRetry={() => query.refetch()} />
  }

  const { items, currency } = query.data
  if (items.every((item) => item.totalMinor === 0)) {
    return (
      <EmptyState
        title="No spending this month"
        description="Add an expense to see where your money goes."
      />
    )
  }

  return <SpendingPlot month={month} currency={currency} items={items} />
}
