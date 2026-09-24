import { z } from 'zod'
import { CURRENCY_OPTIONS } from './currencies'

const currencyCodes = new Set(CURRENCY_OPTIONS.map((option) => option.code))

const email = z.string().trim().pipe(z.email('Enter a valid email address'))
const newPassword = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')

export const loginFormSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
})

export const registerFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(80, 'Use at most 80 characters'),
  email,
  password: newPassword,
  currency: z.string().refine((code) => currencyCodes.has(code), 'Choose a currency'),
})

export const forgotFormSchema = z.object({ email })

export const resendFormSchema = z.object({ email })

export const resetFormSchema = z
  .object({ password: newPassword, confirm: z.string() })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  })

export type LoginForm = z.infer<typeof loginFormSchema>
export type RegisterForm = z.infer<typeof registerFormSchema>
export type ForgotForm = z.infer<typeof forgotFormSchema>
export type ResendForm = z.infer<typeof resendFormSchema>
export type ResetForm = z.infer<typeof resetFormSchema>
