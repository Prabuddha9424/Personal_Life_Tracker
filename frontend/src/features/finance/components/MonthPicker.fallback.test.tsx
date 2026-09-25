import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MonthPicker } from './MonthPicker'

// Browsers without <input type="month"> (desktop Firefox and Safari) show a plain text field.
vi.mock('./supportsMonthInput', () => ({ supportsMonthInput: () => false }))

describe('MonthPicker without a native month input', () => {
  it('shows a text field with the current month and a format hint', () => {
    render(<MonthPicker value="2026-09" onChange={() => {}} />)

    const input = screen.getByLabelText('Choose month')
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveValue('2026-09')
    expect(input).toHaveAttribute('placeholder', 'YYYY-MM')
  })

  it('accepts every intermediate keystroke but commits only a valid month', async () => {
    const onChange = vi.fn()
    render(<MonthPicker value="2026-09" onChange={onChange} />)
    const input = screen.getByLabelText('Choose month')

    await userEvent.clear(input)
    await userEvent.type(input, '2026-0')

    expect(input).toHaveValue('2026-0')
    expect(onChange).not.toHaveBeenCalled()

    await userEvent.type(input, '3')

    expect(input).toHaveValue('2026-03')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith('2026-03')
  })

  it.each(['abc', '2026-13', '2026-00', '1999-12', '2101-01', '2026-9', '202603'])(
    'never reports the invalid text %s',
    async (text) => {
      const onChange = vi.fn()
      render(<MonthPicker value="2026-09" onChange={onChange} />)
      const input = screen.getByLabelText('Choose month')

      await userEvent.clear(input)
      await userEvent.type(input, text)

      expect(onChange).not.toHaveBeenCalled()
    },
  )

  it('goes back to the current month when left with an invalid draft', async () => {
    const onChange = vi.fn()
    render(<MonthPicker value="2026-09" onChange={onChange} />)
    const input = screen.getByLabelText('Choose month')

    await userEvent.clear(input)
    await userEvent.type(input, '2026-1')
    await userEvent.tab()

    expect(input).toHaveValue('2026-09')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('goes back to the current month on Enter with an invalid draft', async () => {
    render(<MonthPicker value="2026-09" onChange={() => {}} />)
    const input = screen.getByLabelText('Choose month')

    await userEvent.clear(input)
    await userEvent.type(input, 'nope{Enter}')

    expect(input).toHaveValue('2026-09')
  })

  it('keeps a valid draft on blur', async () => {
    const onChange = vi.fn()
    render(<MonthPicker value="2026-09" onChange={onChange} />)
    const input = screen.getByLabelText('Choose month')

    await userEvent.clear(input)
    await userEvent.type(input, '2027-01')
    await userEvent.tab()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith('2027-01')
  })

  it('follows the month when the parent or the step buttons change it', async () => {
    function Harness() {
      const [month, setMonth] = useState('2026-09')
      return <MonthPicker value={month} onChange={setMonth} />
    }
    render(<Harness />)
    const input = screen.getByLabelText('Choose month')

    await userEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(input).toHaveValue('2026-10')

    await userEvent.clear(input)
    await userEvent.type(input, '2026-0')
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))

    expect(input).toHaveValue('2026-09')
  })
})
