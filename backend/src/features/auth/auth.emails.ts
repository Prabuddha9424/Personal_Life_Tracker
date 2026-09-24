import { env } from '../../shared/config/env.ts'
import { logger } from '../../shared/logger/logger.ts'
import { sendMail, type MailOptions } from '../../shared/mailer/mailer.ts'

function link(path: string, token?: string): string {
  const url = new URL(path, env.CLIENT_URL)
  if (token) url.searchParams.set('token', token)
  return url.toString()
}

/** Never throws: a mail outage must not change what the API answers (it would leak account state). */
async function sendSafely(options: MailOptions): Promise<void> {
  try {
    await sendMail(options)
  } catch (err) {
    logger.error({ err, subject: options.subject }, 'Failed to send email')
  }
}

export function sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
  return sendSafely({
    to,
    subject: 'Verify your email',
    text: `Hi ${name},\n\nConfirm your email address to finish creating your account:\n${link('/verify-email', token)}\n\nThis link expires in 24 hours. If you did not sign up, you can ignore this email.`,
  })
}

export function sendAlreadyRegisteredEmail(to: string, name: string): Promise<void> {
  return sendSafely({
    to,
    subject: 'You already have an account',
    text: `Hi ${name},\n\nSomeone tried to sign up with this email address, but you already have an account.\n\nLog in: ${link('/login')}\nForgot your password? ${link('/forgot-password')}\n\nIf this was not you, you can ignore this email.`,
  })
}

export function sendPasswordResetEmail(to: string, name: string, token: string): Promise<void> {
  return sendSafely({
    to,
    subject: 'Reset your password',
    text: `Hi ${name},\n\nUse this link to choose a new password:\n${link('/reset-password', token)}\n\nThe link expires in 15 minutes and works once. If you did not ask for this, you can ignore this email.`,
  })
}
