import http, { type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import supertest from 'supertest'

/*
 * One HTTP server per test file, explicitly bound to 127.0.0.1, instead of supertest's default of a
 * fresh wildcard (`::`) server on a random port for every request.
 *
 * On macOS a wildcard bind succeeds on an ephemeral port that another process already holds on
 * 127.0.0.1 (VS Code helpers and other dev tools do), and the client, connecting to 127.0.0.1:<port>,
 * then reaches that other process: a stray 404, or a 200 where a 429 was expected. A bind to
 * 127.0.0.1 itself cannot share a port with another 127.0.0.1 listener. Node can only bind a named
 * address asynchronously, so the server is started once here (top-level await) and every app is
 * served under its own path prefix, which keeps `request(app)` synchronous.
 */

const apps: RequestListener[] = []
const prefixOf = new Map<RequestListener, string>()

const server = http.createServer((req, res) => {
  const match = /^\/__app(\d+)(\/.*)?$/.exec(req.url ?? '')
  const app = match?.[1] === undefined ? undefined : apps[Number(match[1])]
  if (!app) {
    res.statusCode = 404
    res.end()
    return
  }
  req.url = match?.[2] ?? '/'
  app(req, res)
})
server.unref()
await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

export function request(app: RequestListener): ReturnType<typeof supertest> {
  let prefix = prefixOf.get(app)
  if (prefix === undefined) {
    prefix = `/__app${apps.push(app) - 1}`
    prefixOf.set(app, prefix)
  }
  return supertest(`${origin}${prefix}`)
}
