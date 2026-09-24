import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as authApi from '../api/authApi'
import RegisterPage from './RegisterPage'

vi.mock('../api/authApi')

beforeEach(() => {
  vi.resetAllMocks()
})

async function fillForm(password = 'a-long-passphrase') {
  await userEvent.type(screen.getByLabelText('Name'), 'Ada Lovelace')
  await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
  await userEvent.type(screen.getByLabelText('Password'), password)
}

describe('RegisterPage', () => {
  it('validates the form before calling the API', async () => {
    renderWithProviders(<RegisterPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Enter your name')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument()
    expect(screen.getByText('Use at least 10 characters')).toBeInTheDocument()
    expect(authApi.register).not.toHaveBeenCalled()
  })

  it('announces validation errors and hints together with their fields', async () => {
    renderWithProviders(<RegisterPage />)

    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('At least 10 characters')

    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    const password = await screen.findByLabelText('Password')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAccessibleDescription('Use at least 10 characters')
  })

  it('defaults the currency to USD and offers the other currencies', () => {
    renderWithProviders(<RegisterPage />)

    expect(screen.getByLabelText(/currency/i)).toHaveValue('USD')
    expect(screen.getByRole('option', { name: /JPY/ })).toBeInTheDocument()
  })

  it('registers and then asks the user to check their inbox', async () => {
    vi.mocked(authApi.register).mockResolvedValue()
    renderWithProviders(<RegisterPage />)

    await fillForm()
    await userEvent.selectOptions(screen.getByLabelText(/currency/i), 'EUR')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument()
    expect(screen.getByText(/ada@example.com/)).toBeInTheDocument()
    expect(vi.mocked(authApi.register).mock.calls[0]?.[0]).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'a-long-passphrase',
      currency: 'EUR',
    })
  })

  it('shows the server message when registration is rejected', async () => {
    vi.mocked(authApi.register).mockRejectedValue(
      new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, null, {
        status: 400,
        statusText: '',
        data: { message: 'Validation failed' },
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      }),
    )
    renderWithProviders(<RegisterPage />)

    await fillForm()
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Validation failed')).toBeInTheDocument()
  })

  it('can resend the verification email from the confirmation screen', async () => {
    vi.mocked(authApi.register).mockResolvedValue()
    vi.mocked(authApi.resendVerification).mockResolvedValue()
    renderWithProviders(<RegisterPage />)
    await fillForm()
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Resend the email' }))

    expect(vi.mocked(authApi.resendVerification).mock.calls[0]?.[0]).toEqual({
      email: 'ada@example.com',
    })
  })
})
