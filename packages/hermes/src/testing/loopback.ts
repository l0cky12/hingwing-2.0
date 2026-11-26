/**
 * The scripted gateway behind a real WebSocket on 127.0.0.1, with the upgrade gate of Hermes's
 * `/api/ws` (gateway/run_api.py:466-496). The client reaches it through the real `dialWith`.
 */
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { GATEWAY_PROTOCOL, TICKET_PREFIX, type Clock, type Endpoint, type Reach } from '../wire/link'
import { ABNORMAL_CLOSE, type ScriptedGateway } from './gateway'

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
  const http = createServer((request, response) => front.serve(request, response))
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
    port,
    front: webapp => { front = webapp },
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
