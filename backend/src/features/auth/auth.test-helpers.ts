import { vi } from 'vitest'
import { app } from '../../app.ts'
import { request, type Response } from '../../test/http.ts'
import { sendMail } from '../../shared/mailer/mailer.ts'

/** The test file must call vi.mock('../../shared/mailer/mailer.ts', ...) for this to be a mock. */
export const sendMailMock = vi.mocked(sendMail)

export const VALID_PASSWORD = 'correct-horse-battery'

let counter = 0

export interface NewUserInput {
  name: string
  email: string
  password: string
  currency: string
}

export function newUserInput(overrides: Partial<NewUserInput> = {}): NewUserInput {
  counter += 1
  return {
    name: 'Ada Lovelace',
    email: `user${counter}@example.com`,
    password: VALID_PASSWORD,
    currency: 'USD',
    ...overrides,
  }
}

/** The 64-hex token in the link of the most recent email. */
export function lastMailToken(): string {
  const text = sendMailMock.mock.calls.at(-1)?.[0].text ?? ''
  const match = /token=([a-f0-9]{64})/.exec(text)
  if (!match?.[1]) throw new Error('No token found in the last email')
  return match[1]
}

/** All Set-Cookie headers. superagent types headers as strings, but Node delivers an array. */
export function setCookies(res: Response): string[] {
  return (res.headers['set-cookie'] as unknown as string[] | undefined) ?? []
}

/** `refresh_token=<value>` from a response that set the refresh cookie. */
export function refreshCookie(res: Response): string {
  const cookie = setCookies(res).find((value) => value.startsWith('refresh_token='))
  if (!cookie) throw new Error('No refresh cookie was set')
  return cookie.split(';')[0] ?? ''
}

/** Registers and verifies a user through the real endpoints. */
export async function registerVerified(
  input: NewUserInput = newUserInput(),
): Promise<NewUserInput> {
  await request(app).post('/api/auth/register').send(input).expect(202)
  await request(app).post('/api/auth/verify-email').send({ token: lastMailToken() }).expect(200)
  return input
}
