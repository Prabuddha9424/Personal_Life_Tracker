import { currentMonthIso, formatMonth, shiftMonthIso } from '@/shared/lib/dates'
import { Button } from '@/shared/ui/Button'
import '../finance.css'

/** The months the server reports on. */
const FIRST_MONTH = '2000-01'
const LAST_MONTH = '2100-12'

interface MonthPickerProps {
  /** YYYY-MM */
  value: string
  onChange: (month: string) => void
}

function isSelectable(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= FIRST_MONTH && month <= LAST_MONTH
}

export function MonthPicker({ value, onChange }: MonthPickerProps) {
  const previous = shiftMonthIso(value, -1)
  const next = shiftMonthIso(value, 1)
  const canGoBack = isSelectable(previous)
  const canGoForward = isSelectable(next)

  return (
    <div className="month-picker" role="group" aria-label="Month">
      <Button
        variant="ghost"
        aria-label="Previous month"
        title={canGoBack ? formatMonth(previous) : undefined}
        disabled={!canGoBack}
        onClick={() => onChange(previous)}
      >
        ‹
      </Button>
      <input
        type="month"
        aria-label="Choose month"
        value={value}
        min={FIRST_MONTH}
        max={LAST_MONTH}
        onChange={(event) => {
          if (isSelectable(event.target.value)) onChange(event.target.value)
        }}
      />
      <Button
        variant="ghost"
        aria-label="Next month"
        title={canGoForward ? formatMonth(next) : undefined}
        disabled={!canGoForward}
        onClick={() => onChange(next)}
      >
        ›
      </Button>
      <Button variant="ghost" onClick={() => onChange(currentMonthIso())}>
        This month
      </Button>
    </div>
  )
}
