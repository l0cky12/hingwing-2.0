/**
 * The scripted gateway behind a real WebSocket on 127.0.0.1, with the upgrade gate of Hermes's
 * `/api/ws` (gateway/run_api.py:466-496). The client reaches it through the real `dialWith`.
 */
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { GATEWAY_PROTOCOL, type Clock, type Endpoint } from '../wire/link'
import { ABNORMAL_CLOSE, type ScriptedGateway } from './gateway'

/** Hermes's hermes_cli/gateway_client.py:16 */
const TICKET_PREFIX = 'hermes-gateway-ticket.'
/** Hermes's gateway/runtime_bootstrap.py:26 */
const TICKET_TTL_MS = 30_000

export interface Upgrade {
  readonly origin: string | null
  /** Which ticket the upgrade offered, counted from the first one minted. null when it offered none this gateway minted. */
  readonly ticket: number | null
  /** The rule that refused it, or null when it was accepted. */
  readonly refused: string | null
}

export interface Loopback {
  /** A fresh single-use ticket for one dial. */
  mint(): Endpoint
  readonly upgrades: readonly Upgrade[]
  close(): Promise<void>
}

interface Offered {
  readonly origin: string | undefined
  readonly protocols: readonly string[]
  readonly tickets: readonly string[]
}

export async function loopback(gateway: ScriptedGateway, clock: Clock): Promise<Loopback> {
  const { WebSocketServer } = await import('ws')
  const minted: string[] = []
  const live = new Map<string, number>()
  const upgrades: Upgrade[] = []

  const redeem = (ticket: string | undefined): boolean => {
    const expires = ticket === undefined ? undefined : live.get(ticket)
    if (ticket === undefined || expires === undefined) return false
    live.delete(ticket)
    return expires > clock.now()
  }

  /** In the gate's order. The first rule an upgrade breaks refuses it. */
  const rules: readonly (readonly [refusal: string, broken: (offered: Offered) => boolean])[] = [
    ['origin', offered => offered.origin !== undefined],
    /** Exactly one ticket beside the protocol itself (hermes_cli/web_server_boundary.py:160-171). */
    ['protocol', offered => !offered.protocols.includes(GATEWAY_PROTOCOL)],
    ['ticket-count', offered => offered.tickets.length !== 1],
    ['ticket', offered => !redeem(offered.tickets[0])]
  ]

  const judge = (request: IncomingMessage): Upgrade => {
    const protocols = String(request.headers['sec-websocket-protocol'] ?? '').split(',').map(value => value.trim()).filter(Boolean)
    const tickets = protocols.filter(value => value.startsWith(TICKET_PREFIX)).map(value => value.slice(TICKET_PREFIX.length))
    const offered: Offered = { origin: request.headers.origin, protocols, tickets }
    const known = minted.indexOf(tickets[0] ?? '')
    return { origin: offered.origin ?? null, ticket: known === -1 ? null : known, refused: rules.find(([, broken]) => broken(offered))?.[0] ?? null }
  }

  const wss = new WebSocketServer({ noServer: true, handleProtocols: () => GATEWAY_PROTOCOL })
  const http = createServer((_request, response) => void response.writeHead(404).end())
  http.on('upgrade', (request, socket, head) => {
    const upgrade = judge(request)
    upgrades.push(upgrade)
    if (upgrade.refused !== null) return void socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    wss.handleUpgrade(request, socket, head, ws => {
      const accepted = gateway.accept({
        write: frame => ws.send(JSON.stringify(frame)),
        close: code => (code === ABNORMAL_CLOSE ? ws.terminate() : ws.close(code))
      })
      ws.on('message', data => accepted.text(String(data)))
      ws.on('close', () => accepted.closed())
    })
  })
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  const { port } = http.address() as AddressInfo

  return {
    upgrades,
    mint: () => {
      const ticket = randomBytes(24).toString('base64url')
      minted.push(ticket)
      live.set(ticket, clock.now() + TICKET_TTL_MS)
      return { url: `ws://127.0.0.1:${port}/api/ws`, protocols: [GATEWAY_PROTOCOL, TICKET_PREFIX + ticket] }
    },
    close: () => new Promise(resolve => {
      for (const client of wss.clients) client.terminate()
      http.close(() => resolve())
    })
  }
}
