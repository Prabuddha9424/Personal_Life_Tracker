import { env } from '../../shared/config/env.ts'

// 4 keeps the test suite fast. Development and production always use 12 (CLAUDE.md: cost >= 12).
export const BCRYPT_COST = env.NODE_ENV === 'test' ? 4 : 12

export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
export const RESET_TOKEN_TTL_MS = 15 * 60 * 1000

/** A rotated refresh token reused within this window is a concurrent tab, not theft. */
export const REFRESH_REUSE_GRACE_MS = 10_000
