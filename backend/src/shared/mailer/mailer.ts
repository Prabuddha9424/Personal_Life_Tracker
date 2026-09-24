import nodemailer from 'nodemailer'
import { env } from '../config/env.ts'

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
})

export interface MailOptions {
  to: string
  subject: string
  text: string
  html?: string
}

export async function sendMail(options: MailOptions): Promise<void> {
  await transporter.sendMail({ from: env.MAIL_FROM, ...options })
}
