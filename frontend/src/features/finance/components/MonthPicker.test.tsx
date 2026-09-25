import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MonthPicker } from './MonthPicker'

afterEach(() => {
  vi.useRealTimers()
})

describe('MonthPicker', () => {
  it('shows the current month', () => {
    render(<MonthPicker value="2026-09" onChange={() => {}} />)

    expect(screen.getByLabelText('Choose month')).toHaveValue('2026-09')
  })

  it('steps to the previous and next month, across a year boundary', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<MonthPicker value="2026-01" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(onChange).toHaveBeenLastCalledWith('2025-12')

    rerender(<MonthPicker value="2026-12" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(onChange).toHaveBeenLastCalledWith('2027-01')
  })

  it('names the month each step button leads to', () => {
    render(<MonthPicker value="2026-01" onChange={() => {}} />)

    expect(screen.getByRole('button', { name: 'Previous month' })).toHaveAccessibleDescription(
      'December 2025',
    )
    expect(screen.getByRole('button', { name: 'Next month' })).toHaveAccessibleDescription(
      'February 2026',
    )
  })

  it('can be used from the keyboard alone', async () => {
    const onChange = vi.fn()
    render(<MonthPicker value="2026-09" onChange={onChange} />)

    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Previous month' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('2026-08')

    await userEvent.tab()
    expect(screen.getByLabelText('Choose month')).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Next month' })).toHaveFocus()
    await userEvent.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith('2026-10')
  })

  it('reports a month typed or picked, and ignores clearing the field', () => {
    const onChange = vi.fn()
    render(<MonthPicker value="2026-09" onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Choose month'), { target: { value: '2026-05' } })
    expect(onChange).toHaveBeenLastCalledWith('2026-05')

    onChange.mockClear()
    fireEvent.change(screen.getByLabelText('Choose month'), { target: { value: '' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('limits the picker to the months the server reports on (2000-01 to 2100-12)', () => {
    render(<MonthPicker value="2026-09" onChange={() => {}} />)

    const input = screen.getByLabelText('Choose month')
    expect(input).toHaveAttribute('min', '2000-01')
    expect(input).toHaveAttribute('max', '2100-12')
  })

  it('does not step before January 2000 or after December 2100', () => {
    const { rerender } = render(<MonthPicker value="2000-01" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled()

    rerender(<MonthPicker value="2100-12" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeEnabled()
  })

  it.each(['1999-12', '2101-01', '0001-01', '2026-13', '2026-00', '2026-9', 'abc'])(
    'ignores the out-of-range or malformed month %s',
    (typed) => {
      const onChange = vi.fn()
      render(<MonthPicker value="2026-09" onChange={onChange} />)

      fireEvent.change(screen.getByLabelText('Choose month'), { target: { value: typed } })

      expect(onChange).not.toHaveBeenCalled()
    },
  )

  it('accepts the first and last selectable months', () => {
    const onChange = vi.fn()
    render(<MonthPicker value="2026-09" onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Choose month'), { target: { value: '2000-01' } })
    expect(onChange).toHaveBeenLastCalledWith('2000-01')
    fireEvent.change(screen.getByLabelText('Choose month'), { target: { value: '2100-12' } })
    expect(onChange).toHaveBeenLastCalledWith('2100-12')
  })

  it('jumps to this month using the local calendar, sent as YYYY-MM', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 23:30 local on the last day of the month: the UTC date may already be the next month.
    vi.setSystemTime(new Date(2026, 8, 30, 23, 30))
    const onChange = vi.fn()
    render(<MonthPicker value="2025-01" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'This month' }))

    expect(onChange).toHaveBeenCalledWith('2026-09')
  })
})
