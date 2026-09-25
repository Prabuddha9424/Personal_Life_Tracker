import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChartDataTable } from './ChartDataTable'

describe('ChartDataTable', () => {
  it('hides the table visually from a wrapper, so the table itself never sizes the page', () => {
    render(<ChartDataTable caption="Spending" columns={['Category']} rows={[['Food']]} />)

    const table = screen.getByRole('table', { name: 'Spending' })
    expect(table).not.toHaveClass('visually-hidden')
    expect(table.parentElement).toHaveClass('visually-hidden')
  })

  it('stays in the accessibility tree with a caption and column scopes', () => {
    render(
      <ChartDataTable
        caption="Spending"
        columns={['Category', 'Amount']}
        rows={[['Food', '$1.00']]}
      />,
    )

    const table = screen.getByRole('table', { name: 'Spending' })
    expect(table.closest('[hidden], [aria-hidden="true"]')).toBeNull()
    expect(screen.getAllByRole('columnheader')).toHaveLength(2)
    expect(screen.getAllByRole('columnheader')[0]).toHaveAttribute('scope', 'col')
    expect(screen.getByRole('cell', { name: '$1.00' })).toBeInTheDocument()
  })
})
