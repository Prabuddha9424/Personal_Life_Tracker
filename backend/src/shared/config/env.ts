import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  CLIENT_URL: z.url(),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().min(1),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  // Logger depends on env, so fail fast with stderr here.
  process.stderr.write(`Invalid environment variables:\n${z.prettifyError(parsed.error)}\n`)
  process.exit(1)
}

export const env = parsed.data
export const isProduction = env.NODE_ENV === 'production'
