import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadClientUrl(value: string): Promise<string> {
  vi.resetModules()
  vi.stubEnv('CLIENT_URL', value)
  const { env } = await import('./env.ts')
  return env.CLIENT_URL
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('CLIENT_URL', () => {
  it.each([
    ['http://localhost:5173', 'http://localhost:5173'],
    ['https://app.example.com/', 'https://app.example.com'],
    ['https://example.com/tracker/', 'https://example.com'],
    ['https://app.example.com:8443/a/b?x=1#h', 'https://app.example.com:8443'],
  ])('reduces %s to its origin', async (input, expected) => {
    expect(await loadClientUrl(input)).toBe(expected)
  })
})
