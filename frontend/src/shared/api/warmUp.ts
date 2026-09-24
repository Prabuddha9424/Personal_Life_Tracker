import { httpClient } from './httpClient'

/**
 * Pings the health endpoint so a sleeping free-tier backend starts waking before the user acts.
 * Failures are ignored: individual requests report their own errors.
 */
export async function warmUpServer(): Promise<void> {
  try {
    await httpClient.get('/health', { timeout: 30_000 })
  } catch {
    // Nothing to do. The request that follows will surface a real error if the server is down.
  }
}
