/**
 * The scripted gateway behind a real WebSocket on 127.0.0.1, with the upgrade gate of Hermes's
 * `/api/ws` (gateway/run_api.py:466-496). The client reaches it through the real `dialWith`.
 * A request that carries a `native-http` ticket meets the gate of hermes_cli/dashboard_auth/native_http.py:
 * one ticket, no `Origin`, used once and within 30 s, and any profile it names the one the ticket was minted for.
 * It then reaches `/api/config`, served from the scripted gateway's command rules.
 */
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { GATEWAY_PROTOCOL, TICKET_PREFIX, type Clock, type Endpoint, type Reach } from '../wire/link'
import { ABNORMAL_CLOSE, type ScriptedGateway } from './gateway'
import { configCall } from './rules'

/** hermes_cli/dashboard_auth/native_http.py's `HEADER`. */
const HTTP_TICKET_HEADER = 'x-hermes-gateway-ticket'

/** Hermes's gateway/runtime_bootstrap.py:26 */
const TICKET_TTL_MS = 30_000

export interface Upgrade {
  readonly origin: string | null
  readonly ticket: number | null
  readonly refused: string | null
}

/** A Webapp in front of the socket, as the gateway's Webapp listener is (Hermes's gateway/webapp_listener.py). */
export interface Front {
  readonly prefix: string
  /**
   * What an upgrade meets. `legacy`: a good ticket opens the standalone dashboard's chat, whose
   * `gateway.ready` names no session authority (tui_gateway/ws.py:660-662). `refused`: no upgrade
   * gets through, as behind a proxy that passes no WebSocket.
   */
  readonly upgrades: 'gateway' | 'legacy' | 'refused'
  serve(request: IncomingMessage, response: ServerResponse): void
}

const NO_FRONT: Front = { prefix: '', upgrades: 'gateway', serve: (_request, response) => void response.writeHead(404).end() }
const LEGACY_READY = { jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: { skin: {} } } }

export interface Loopback {
  /** Names this gateway process, as `instance_id` does in an attach reply and a `--serve` hello. */
  readonly instanceId: string
  /** A single-use ticket and where to redeem it. The socket it opens reaches what the ticket does. */
  mint(reach: Reach): Endpoint
  /** The scripted gateway's command rules, which `/api/config` serves. null: none. */
  readonly rules: ScriptedGateway['rules']
  /** The gateway's HTTP listener, as a hello names it, and a single-use `native-http` ticket for it. `profile` null: the profile the gateway launched in. */
  readonly http: { readonly origin: string; mint(profile: string | null): string }
  readonly upgrades: readonly Upgrade[]
  readonly port: number
  front(front: Front): void
  close(): Promise<void>
}

interface Offered {
  readonly path: string
  readonly origin: string | undefined
  readonly protocols: readonly string[]
  readonly tickets: readonly string[]
}

export async function loopback(gateway: ScriptedGateway, clock: Clock): Promise<Loopback> {
  const { WebSocketServer } = await import('ws')
  const minted: { readonly ticket: string; readonly reach: Reach }[] = []
  const live = new Map<string, number>()
  const upgrades: Upgrade[] = []
  let front = NO_FRONT

  const httpLive = new Map<string, { readonly expires: number; readonly profile: string | null }>()
  const redeemHttp = (ticket: string | undefined) => {
    const held = ticket === undefined ? undefined : httpLive.get(ticket)
    if (ticket === undefined || held === undefined) return undefined
    httpLive.delete(ticket)
    return held.expires > clock.now() ? held : undefined
  }

  const redeem = (ticket: string | undefined): boolean => {
    const expires = ticket === undefined ? undefined : live.get(ticket)
    if (ticket === undefined || expires === undefined) return false
    live.delete(ticket)
    return expires > clock.now()
  }

  /** In the gate's order. The first rule an upgrade breaks refuses it. */
  const rules: readonly (readonly [refusal: string, broken: (offered: Offered) => boolean])[] = [
    ['socket', () => front.upgrades === 'refused'],
    ['path', offered => offered.path !== `${front.prefix}/api/ws`],
    ['origin', offered => offered.origin !== undefined],
    /** Exactly one ticket beside the protocol itself (hermes_cli/web_server_boundary.py:160-171). */
    ['protocol', offered => !offered.protocols.includes(GATEWAY_PROTOCOL)],
    ['ticket-count', offered => offered.tickets.length !== 1],
    ['ticket', offered => !redeem(offered.tickets[0])]
  ]

  const judge = (request: IncomingMessage): Upgrade => {
    const protocols = String(request.headers['sec-websocket-protocol'] ?? '').split(',').map(value => value.trim()).filter(Boolean)
    const tickets = protocols.filter(value => value.startsWith(TICKET_PREFIX)).map(value => value.slice(TICKET_PREFIX.length))
    const offered: Offered = { path: new URL(request.url ?? '/', 'http://loopback').pathname, origin: request.headers.origin, protocols, tickets }
    const known = minted.findIndex(held => held.ticket === tickets[0])
    return { origin: offered.origin ?? null, ticket: known === -1 ? null : known, refused: rules.find(([, broken]) => broken(offered))?.[0] ?? null }
  }

  const wss = new WebSocketServer({ noServer: true, handleProtocols: () => GATEWAY_PROTOCOL })
  const answer = (response: ServerResponse, status: number, body: unknown) => void response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))

  /** A value of `profile` that names the ticket's own profile, or none at all (native_http.py `_own_profile`). */
  const ownProfile = (value: unknown, bound: string | null) =>
    value === undefined || value === null || (typeof value === 'string' && (value.trim() === '' || value.trim().toLowerCase() === 'current' || value === (bound ?? gateway.home)))

  const ticketed = async (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const sent = [request.headers[HTTP_TICKET_HEADER]].flat()
    const grant = sent.length === 1 && request.headers.origin === undefined ? redeemHttp(sent[0]) : undefined
    if (grant === undefined) return answer(response, 401, { detail: 'Unauthorized' })
    const { pathname, searchParams } = new URL(request.url ?? '/', 'http://loopback')
    let json: unknown
    try {
      json = chunks.length === 0 ? undefined : JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      json = undefined
    }
    const named = [...searchParams.getAll('profile'), ...(json !== null && typeof json === 'object' && 'profile' in json ? [(json as { profile: unknown }).profile] : [])]
    if (!named.every(value => ownProfile(value, grant.profile))) return answer(response, 403, { detail: 'profile_scope_mismatch' })
    const reply = configCall(gateway.rules, { method: request.method ?? 'GET', path: pathname, profile: grant.profile, json })
    if (reply === null) return answer(response, 404, { detail: 'Not Found' })
    answer(response, reply.status, reply.body)
  }

  const http = createServer((request, response) => (request.headers[HTTP_TICKET_HEADER] === undefined ? front.serve(request, response) : void ticketed(request, response)))
  http.on('upgrade', (request, socket, head) => {
    const upgrade = judge(request)
    upgrades.push(upgrade)
    if (upgrade.refused !== null) return void socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    const reach = minted[upgrade.ticket ?? -1]?.reach
    wss.handleUpgrade(request, socket, head, ws => {
      if (front.upgrades === 'legacy') return void ws.send(JSON.stringify(LEGACY_READY))
      const accepted = gateway.accept({
        write: frame => ws.send(JSON.stringify(frame)),
        close: code => (code === ABNORMAL_CLOSE ? ws.terminate() : ws.close(code))
      }, reach)
      ws.on('message', data => accepted.text(String(data)))
      ws.on('close', () => accepted.closed())
    })
  })
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  const { port } = http.address() as AddressInfo

  return {
    instanceId: randomBytes(16).toString('hex'),
    upgrades,
    rules: gateway.rules,
    port,
    front: webapp => { front = webapp },
    http: {
      origin: `http://127.0.0.1:${port}`,
      mint: profile => {
        const ticket = randomBytes(24).toString('base64url')
        httpLive.set(ticket, { expires: clock.now() + TICKET_TTL_MS, profile })
        return ticket
      }
    },
    mint: reach => {
      const ticket = randomBytes(24).toString('base64url')
      minted.push({ ticket, reach })
      live.set(ticket, clock.now() + TICKET_TTL_MS)
      return { url: `ws://127.0.0.1:${port}/api/ws`, protocols: [GATEWAY_PROTOCOL, TICKET_PREFIX + ticket], reach }
    },
    close: () => new Promise(resolve => {
      for (const client of wss.clients) client.terminate()
      http.close(() => resolve())
    })
  }
}
