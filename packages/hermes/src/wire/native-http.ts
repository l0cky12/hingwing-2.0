import { request } from 'node:http'
import type { HttpAnswer } from './link'

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export interface TicketRequest {
  readonly method: 'GET' | 'POST' | 'PUT'
  /** The path and query on the gateway's origin. */
  readonly path: string
  readonly json?: Readonly<Record<string, unknown>> | undefined
  /** How long the gateway has to answer. */
  readonly ms: number
  readonly signal?: AbortSignal | undefined
}

/**
 * One request to a gateway's loopback listener with a `native-http` ticket. Hermes's gate refuses a ticket that
 * comes with an `Origin` header (dashboard_auth/native_http.py:200), which `fetch` may add, so this goes through
 * `node:http`. One request per connection, so a relay that carries one connection carries all of it. A redirect is
 * never followed, so the ticket goes only to the address the gateway named.
 */
export function sendWithTicket(origin: string, ticket: string, { method, path, json, ms, signal }: TicketRequest): Promise<HttpAnswer> {
  const body = json === undefined ? null : JSON.stringify(json)
  const deadline = AbortSignal.timeout(ms)
  return new Promise((resolve, reject) => {
    const asked = request(new URL(path, origin), {
      method,
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
      headers: {
        accept: 'application/json',
        ...(body === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }),
        'x-hermes-gateway-ticket': ticket,
        connection: 'close'
      }
    }, response => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: jsonOf(Buffer.concat(chunks).toString('utf8')) }))
      response.on('error', reject)
    })
    asked.on('error', reject)
    asked.end(body)
  })
}
