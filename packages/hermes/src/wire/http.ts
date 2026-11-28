import { request } from 'node:http'
import { request as https } from 'node:https'
import type { HermesRequest, HttpAnswer } from './link'

export function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Sends one request over `node:http` or `node:https`, with `credential` as the one header that carries who is asking. Hermes answers a
 * write only once its work is done, which can take hours, and `fetch` gives up on an answer that has not begun within 300 s
 * (undici's `headersTimeout`). `ms` is this request's own deadline, and `signal` ends it early. One request per connection, so a relay that
 * carries one connection carries all of it. A redirect is never followed, so the credential goes only to the address it was made for.
 */
export function requestOver(address: URL, credential: { readonly [header: string]: string }, { method, json, ms }: Pick<HermesRequest, 'method' | 'json' | 'ms'>, signal?: AbortSignal): Promise<HttpAnswer> {
  const body = json === undefined ? '' : JSON.stringify(json)
  const deadline = AbortSignal.timeout(ms)
  const send = address.protocol === 'https:' ? https : request
  return new Promise((resolve, reject) => {
    const asked = send(address, {
      method,
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
      headers: {
        accept: 'application/json',
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        'content-length': Buffer.byteLength(body),
        ...credential,
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

/**
 * Sends a request to a gateway's loopback listener with a `native-http` ticket. Hermes's gate refuses a ticket that comes with an
 * `Origin` header (dashboard_auth/native_http.py:200), which `fetch` may add, so this never goes through it.
 */
export const requestWithTicket = (origin: string, ticket: string, asked: HermesRequest, signal?: AbortSignal): Promise<HttpAnswer> =>
  requestOver(new URL(asked.path, origin), { 'x-hermes-gateway-ticket': ticket }, asked, signal)
