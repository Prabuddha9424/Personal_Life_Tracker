import { useState } from 'react'
import { currentMonthIso, formatMonth, shiftMonthIso } from '@/shared/lib/dates'
import { Button } from '@/shared/ui/Button'
import { supportsMonthInput } from './supportsMonthInput'
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
  const [native] = useState(supportsMonthInput)
  // What the field shows. A text field needs every keystroke, so a half-typed month is kept here and
  // only a valid month is reported; it follows the current month whenever that changes.
  const [draft, setDraft] = useState(value)
  const [shownValue, setShownValue] = useState(value)
  if (value !== shownValue) {
    setShownValue(value)
    setDraft(value)
  }
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
        type={native ? 'month' : 'text'}
        aria-label="Choose month"
        value={draft}
        min={native ? FIRST_MONTH : undefined}
        max={native ? LAST_MONTH : undefined}
        placeholder={native ? undefined : 'YYYY-MM'}
        inputMode={native ? undefined : 'numeric'}
        maxLength={native ? undefined : 7}
        autoComplete="off"
        onChange={(event) => {
          setDraft(event.target.value)
          if (isSelectable(event.target.value)) onChange(event.target.value)
        }}
        onBlur={() => {
          if (!isSelectable(draft)) setDraft(value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !isSelectable(draft)) setDraft(value)
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
