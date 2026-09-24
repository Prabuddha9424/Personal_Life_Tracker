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

  it('marks the control invalid and describes it by the error', () => {
    render(
      <FormField label="Email" error="Enter a valid email">
        <input />
      </FormField>,
    )

    const input = screen.getByLabelText('Email')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Enter a valid email')
  })

  it('describes the control by the hint when there is no error', () => {
    render(
      <FormField label="Password" hint="At least 10 characters">
        <input />
      </FormField>,
    )

    const input = screen.getByLabelText('Password')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).toHaveAccessibleDescription('At least 10 characters')
  })

  it('adds no aria-describedby when there is neither hint nor error', () => {
    render(
      <FormField label="Name">
        <input />
      </FormField>,
    )

    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-describedby')
  })

  it('keeps an aria-describedby the control already has', () => {
    render(
      <FormField label="Name" hint="Shown on your profile">
        <input aria-describedby="extra" />
      </FormField>,
    )

    const ids = screen.getByLabelText('Name').getAttribute('aria-describedby')?.split(' ')
    expect(ids).toContain('extra')
    expect(ids).toHaveLength(2)
  })

  it('links every field to its own message', () => {
    render(
      <>
        <FormField label="First" error="First is wrong">
          <input />
        </FormField>
        <FormField label="Second" error="Second is wrong">
          <input />
        </FormField>
      </>,
    )

    expect(screen.getByLabelText('First')).toHaveAccessibleDescription('First is wrong')
    expect(screen.getByLabelText('Second')).toHaveAccessibleDescription('Second is wrong')
  })
})
