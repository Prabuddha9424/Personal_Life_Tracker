import { spawnSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'

const baseEnv = {
  PATH: process.env.PATH,
  MONGODB_URI: 'mongodb://127.0.0.1:1/none',
  JWT_SECRET: 'x'.repeat(40),
  CRON_SECRET: 'y'.repeat(40),
  CLIENT_URL: 'http://localhost:5173',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  MAIL_FROM: 'Test <t@example.com>',
}

function startServer(overrides: Record<string, string>) {
  return spawnSync(process.execPath, ['src/server.ts'], {
    cwd: process.cwd(),
    env: { ...baseEnv, ...overrides },
    encoding: 'utf8',
    timeout: 60_000,
  })
}

// Each case spawns a real node process. The generous limits only matter on a loaded machine;
// a healthy start-up takes well under a second.
vi.setConfig({ testTimeout: 70_000 })

describe('server startup', () => {
  it('refuses to start with NODE_ENV=test', () => {
    const result = startServer({ NODE_ENV: 'test' })

    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/NODE_ENV/)
    expect(result.stderr).toMatch(/test/)
  })

  it('fails fast when CRON_SECRET is too short', () => {
    const result = startServer({ NODE_ENV: 'development', CRON_SECRET: 'short' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('CRON_SECRET')
  })

  it('fails fast when JWT_SECRET is too short', () => {
    const result = startServer({ NODE_ENV: 'development', JWT_SECRET: 'short' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('JWT_SECRET')
  })
})
