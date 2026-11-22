import type { Link } from '../../src/domain/session'
import { manualClock } from '../../src/testing/clock'
import { connect, wireSocket, DialError, type ConnectionEvents, type Dialer, type WireSocket } from '../../src/wire/link'

export interface Frame {
  readonly id?: number | string
  readonly method?: string
  readonly params?: Record<string, unknown>
  readonly error?: { readonly code: number; readonly message: string }
}

export const DESCRIBE = { instance_id: 'i', profile_id: 'p', authority_epoch: 1, capabilities: [], session_create: { sources: ['gui'], parameters: ['source', 'request_id', 'cwd'] } }

export interface Peer {
  readonly socket: WireSocket
  readonly sent: Frame[]
  readonly mute: Set<string>
  closedByClient: boolean
  push(frame: unknown): void
  reply(id: number | string | undefined, result: unknown): void
  refuse(id: number | string | undefined, error: unknown): void
  drop(code?: number): void
}

const AUTOMATIC: Readonly<Record<string, unknown>> = {
  'client.capabilities': { server_requests: [] },
  'runtime.describe': DESCRIBE,
  'gateway.ping': { ok: true }
}

function peer(ready: unknown): Peer {
  const held: Peer = {
    sent: [],
    mute: new Set(),
    closedByClient: false,
    socket: undefined as never,
    push: frame => wire.text(JSON.stringify(frame)),
    reply: (id, result) => held.push({ jsonrpc: '2.0', id, result }),
    refuse: (id, error) => held.push({ jsonrpc: '2.0', id, error }),
    drop: (code = 1006) => wire.closed(code, '')
  }
  const wire = wireSocket({
    send: text => {
      const frame = JSON.parse(text) as Frame
      held.sent.push(frame)
      if (frame.method !== undefined && frame.method in AUTOMATIC && !held.mute.has(frame.method)) {
        queueMicrotask(() => held.reply(frame.id, AUTOMATIC[frame.method as string]))
      }
    },
    close: () => { held.closedByClient = true }
  })
  Object.assign(held, { socket: wire.socket })
  if (ready !== null) held.push({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: ready } })
  return held
}

export function fakeGateway(options: { readonly startOnLaunch?: boolean; readonly random?: () => number } = {}) {
  const clock = manualClock()
  const dials: boolean[] = []
  const peers: Peer[] = []
  const links: Link[] = []
  const events: unknown[] = []
  const requests: unknown[] = []
  const state: { failWith: DialError | null; ready: unknown; online: number } = { failWith: null, ready: { session_authority: true }, online: 0 }
  const dial: Dialer = async ({ start }) => {
    dials.push(start)
    if (state.failWith !== null) throw state.failWith
    const next = peer(state.ready)
    peers.push(next)
    return next.socket
  }
  const handlers: ConnectionEvents = {
    onLink: link => links.push(link),
    onOnline: () => { state.online++ },
    onEvent: params => events.push(params),
    onServerRequest: request => requests.push(request)
  }
  const conn = connect(dial, handlers, { startOnLaunch: options.startOnLaunch ?? true, clock, random: options.random ?? (() => 1) })
  return { clock, conn, dial, dials, peers, links, events, requests, state, last: () => peers.at(-1) as Peer }
}
