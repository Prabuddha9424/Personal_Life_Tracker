import { z } from 'zod'
import { isCommonPassword } from './password-policy.ts'

const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf('currency'))

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email())

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .refine((value) => !isCommonPassword(value), 'That password is too common')

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => SUPPORTED_CURRENCIES.has(value), 'Unsupported currency')

const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/, 'Invalid token')

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email: emailSchema,
  password: passwordSchema,
  currency: currencySchema,
})

export const verifyEmailSchema = z.object({ token: tokenSchema })

export const resendVerificationSchema = z.object({ email: emailSchema })

export type RegisterInput = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
})

export type LoginInput = z.infer<typeof loginSchema>
