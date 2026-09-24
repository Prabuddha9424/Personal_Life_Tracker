import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FormField } from './FormField'

describe('FormField', () => {
  it('associates the label with its control', () => {
    render(
      <FormField label="Email">
        <input />
      </FormField>,
    )

    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('shows the error as an alert and hides the hint while there is an error', () => {
    const { rerender } = render(
      <FormField label="Email" hint="We never share it">
        <input />
      </FormField>,
    )
    expect(screen.getByText('We never share it')).toBeInTheDocument()

    rerender(
      <FormField label="Email" hint="We never share it" error="Enter a valid email">
        <input />
      </FormField>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email')
    expect(screen.queryByText('We never share it')).not.toBeInTheDocument()
  })
})
