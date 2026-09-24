import { z } from 'zod'

const envSchema = z.object({
  VITE_API_URL: z.string().min(1).default('/api'),
})

export const env = envSchema.parse(import.meta.env)
