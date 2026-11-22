import { execFile } from 'node:child_process'
import type { BlockedWhy, Link, WaitingWhy } from '../domain/session'
import type { CanonicalRpcMethods } from './contract.generated'

/** The seam under the whole client. Text frames in, text frames out. Fixtures implement it in memory. */
export interface WireSocket {
  send(text: string): void
  close(): void
  /** Set by the owner right after the dialer resolves. Frames that arrive earlier are buffered by the socket. */
  onText: ((text: string) => void) | null
  onClose: ((code: number, reason: string) => void) | null
}

/**
 * Resolves with an open socket that negotiated `hermes-gateway-v1`. Rejects with `DialError`.
 * Called once per connection attempt. `start` asks for the gateway to be started when it is not
 * running. `connect` sets it on the first dial after launch (when allowed) and when the user
 * presses Start, and never on an automatic retry.
 */
export type Dialer = (request: { readonly start: boolean }) => Promise<WireSocket>

type Why = WaitingWhy | BlockedWhy

const WORDS: Readonly<Record<Why, string>> = {
  'not-running': "Hermes isn't running.",
  draining: 'Hermes is restarting.',
  dropped: 'Reconnecting to Hermes.',
  'hermes-missing': "Highwing can't find the hermes command.",
  incompatible: "This version of Hermes doesn't work with Highwing.",
  auth: 'Hermes refused access to this profile.',
  inaccessible: "Highwing can't reach the Hermes gateway.",
  refused: 'Hermes refused the connection.'
}

const RETRIES: Readonly<Record<Why, boolean>> = {
  'not-running': true, draining: true, dropped: true,
  'hermes-missing': false, incompatible: false, auth: false, inaccessible: false, refused: false
}

export class DialError extends Error {
  constructor(readonly kind: Why, message: string = WORDS[kind]) {
    super(message)
  }
}

export interface Endpoint { readonly url: string; readonly protocols: readonly string[] }
export type Mint = (request: { readonly start: boolean }) => Promise<Endpoint>

export const GATEWAY_PROTOCOL = 'hermes-gateway-v1'

/** `ensure_exit_code` in Hermes's `hermes_cli/gateway_runtime_cli.py:11-17`. 2 is an invocation this Hermes does not know. */
const EXIT_KINDS: Readonly<Record<number, Why>> = { 2: 'incompatible', 3: 'incompatible', 4: 'auth', 5: 'not-running', 6: 'draining', 7: 'inaccessible' }

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function endpointOf(stdout: string): Endpoint | null {
  try {
    const reply: unknown = JSON.parse(stdout.trim().split('\n').at(-1) ?? '')
    if (!isObject(reply)) return null
    const { url, protocols } = reply
    return typeof url === 'string' && Array.isArray(protocols) && protocols.every(held => typeof held === 'string') ? { url, protocols } : null
  } catch {
    return null
  }
}

function cliMint(options: { readonly hermesBin?: string }): Mint {
  return ({ start }) => new Promise((resolve, reject) => {
    const deadline = start ? ['--start', '--timeout', '75'] : ['--timeout', '20']
    execFile(options.hermesBin ?? 'hermes', ['gateway', 'attach', '--json', ...deadline], { encoding: 'utf8' }, (error, stdout) => {
      if (error === null) {
        const endpoint = endpointOf(stdout)
        return endpoint === null ? reject(new DialError('incompatible')) : resolve(endpoint)
      }
      if (error.code === 'ENOENT') return reject(new DialError('hermes-missing'))
      reject(new DialError((typeof error.code === 'number' ? EXIT_KINDS[error.code] : undefined) ?? 'inaccessible'))
    })
  })
}

/**
 * The real gateway. Each call mints its own ticket, so a reconnect can never reuse one.
 * The ticket lives only in the `Endpoint` this module passes from `Mint` to the dial. It is never
 * logged, stored, recorded or sent over IPC.
 */
export function liveDialer(options: { hermesBin?: string } = {}): Dialer {
  return dialWith(cliMint(options))
}

export function wireSocket(transport: { send(text: string): void; close(): void }): {
  readonly socket: WireSocket
  text(text: string): void
  closed(code: number, reason: string): void
} {
  const waiting: string[] = []
  let ended: { readonly code: number; readonly reason: string } | null = null
  let onText: WireSocket['onText'] = null
  let onClose: WireSocket['onClose'] = null
  const flush = () => {
    while (onText !== null && waiting.length > 0) onText(waiting.shift() as string)
    if (onClose !== null && ended !== null && waiting.length === 0) {
      const { code, reason } = ended
      ended = null
      onClose(code, reason)
    }
  }
  const socket: WireSocket = {
    send: text => transport.send(text),
    close: () => transport.close(),
    get onText() { return onText },
    set onText(handler) { onText = handler; flush() },
    get onClose() { return onClose },
    set onClose(handler) { onClose = handler; flush() }
  }
  return {
    socket,
    text: text => { waiting.push(text); flush() },
    closed: (code, reason) => { ended = { code, reason }; flush() }
  }
}

/** A close before the socket opened: 4403 is the gateway's refusal and 1013 its drain (Hermes's `gateway/run_api.py:486-534`). */
const CLOSE_KINDS: Readonly<Record<number, Why>> = { 4403: 'refused', 1013: 'draining' }

export function dialWith(mint: Mint): Dialer {
  return async ({ start }) => {
    const { url, protocols } = await mint({ start })
    return new Promise<WireSocket>((resolve, reject) => {
      // Node's built-in WebSocket sends no Origin header. The gateway refuses an upgrade that carries one.
      const ws = new WebSocket(url, [...protocols])
      const wire = wireSocket({ send: text => ws.send(text), close: () => ws.close() })
      let open = false
      ws.addEventListener('open', () => {
        if (ws.protocol !== GATEWAY_PROTOCOL) {
          ws.close()
          return reject(new DialError('incompatible'))
        }
        open = true
        resolve(wire.socket)
      })
      ws.addEventListener('message', event => {
        if (typeof event.data === 'string') wire.text(event.data)
      })
      ws.addEventListener('close', event => {
        if (open) wire.closed(event.code, event.reason)
        else reject(new DialError(CLOSE_KINDS[event.code] ?? 'dropped'))
      })
      // Node 22's WebSocket fires `error` and never `close` when a dial fails, so `close` alone would leave the dial pending.
      ws.addEventListener('error', () => {
        if (!open) reject(new DialError('dropped'))
      })
    })
  }
}

export class RpcRefusal extends Error {
  constructor(
    readonly code: number,
    readonly reason: string | null,
    message: string,
    readonly revision: number | null = null
  ) {
    super(message)
  }
}
export class Offline extends Error {}

type Method = keyof CanonicalRpcMethods

export interface Connection {
  readonly link: Link
  call<M extends Method>(method: M, params: CanonicalRpcMethods[M]['params'], timeoutMs?: number): Promise<CanonicalRpcMethods[M]['result']>
  /**
   * Answer a server-to-client request with JSON-RPC error -32601, the code Hermes's own client uses for
   * a request it has no handler for (apps/shared/src/json-rpc-channel.ts:94), so the agent stops waiting.
   * Works for a request that arrived on an earlier socket and is still listed as open.
   */
  decline(requestId: string, message: string): void
  readonly creation: { readonly sources: readonly string[]; readonly parameters: readonly string[] } | null
  retryNow(request: { readonly start: boolean }): void
  close(): void
}

export interface ConnectionEvents {
  onLink(link: Link): void
  onOnline(): void
  onEvent(params: unknown): void
  onServerRequest(request: { readonly id: string; readonly method: string; readonly params: unknown }): void
}

export interface Clock {
  now(): number
  setTimeout(run: () => void, ms: number): () => void
}
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => {
    const timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  }
}

export const HANDSHAKE_MS = 10_000
export const PING_MS = 15_000
export const SILENCE_MS = 45_000
export const BACKOFF_MS = { first: 1_000, cap: 30_000 } as const
export const BACKOFF_RESET_AFTER_MS = 30_000
const METHOD_NOT_FOUND = -32601

type Creation = NonNullable<Connection['creation']>

type Phase =
  | { readonly at: 'dialing'; readonly attempt: number }
  | { readonly at: 'handshake'; readonly attempt: number; readonly socket: WireSocket; readonly giveUp: () => void }
  | { readonly at: 'online'; readonly attempt: number; readonly socket: WireSocket; readonly since: number; readonly creation: Creation; readonly heartbeat: { stop(): void } }
  | { readonly at: 'waiting'; readonly attempt: number; readonly retryAt: number; readonly why: WaitingWhy; readonly message: string; readonly cancel: () => void }
  | { readonly at: 'blocked'; readonly why: BlockedWhy; readonly message: string }
  | { readonly at: 'closed' }

function linkOf(phase: Exclude<Phase, { at: 'closed' }>): Link {
  switch (phase.at) {
    case 'dialing':
    case 'handshake':
      return { state: 'connecting', attempt: phase.attempt }
    case 'online':
      return { state: 'online' }
    case 'waiting':
      return { state: 'waiting', attempt: phase.attempt, retryAt: phase.retryAt, why: phase.why, message: phase.message }
    case 'blocked':
      return { state: 'blocked', why: phase.why, message: phase.message }
  }
}

function sameLink(a: Link, b: Link): boolean {
  if (a.state === 'online') return b.state === 'online'
  return a.state === 'connecting' && b.state === 'connecting' && a.attempt === b.attempt
}

export function backoffMs(attempt: number, random: number): number {
  const full = Math.min(BACKOFF_MS.cap, BACKOFF_MS.first * 2 ** Math.min(attempt - 1, 16))
  return Math.round(full / 2 + (full / 2) * random)
}

interface Pending {
  readonly resolve: (result: unknown) => void
  readonly reject: (error: Error) => void
  readonly cancel: () => void
}

function refusalOf(error: unknown): RpcRefusal {
  const { code, message, data } = isObject(error) ? error : {}
  const { reason, revision } = isObject(data) ? data : {}
  return new RpcRefusal(
    typeof code === 'number' ? code : 0,
    typeof reason === 'string' ? reason : null,
    typeof message === 'string' ? message : 'The gateway refused the call.',
    typeof revision === 'number' ? revision : null
  )
}

export function connect(
  dial: Dialer,
  events: ConnectionEvents,
  options: { readonly startOnLaunch: boolean; readonly clock?: Clock; readonly random?: () => number }
): Connection {
  const clock = options.clock ?? systemClock
  const random = options.random ?? Math.random
  const pending = new Map<number, Pending>()
  let nextId = 0
  let dials = 0
  let heardAt = clock.now()
  let phase: Phase = { at: 'dialing', attempt: 1 }
  let link = linkOf(phase)

  const enter = (next: Phase) => {
    phase = next
    if (next.at === 'closed') return
    const before = link
    link = linkOf(next)
    if (!sameLink(before, link)) events.onLink(link)
  }

  const request = (socket: WireSocket, method: string, params?: unknown, timeoutMs?: number): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      const cancel = timeoutMs === undefined ? () => {} : clock.setTimeout(() => {
        pending.delete(id)
        reject(new Offline(`${method} got no reply in ${timeoutMs} ms`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, cancel })
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }))
    })

  const release = (socket: WireSocket) => {
    socket.onText = null
    socket.onClose = null
    socket.close()
    for (const call of pending.values()) {
      call.cancel()
      call.reject(new Offline('The socket closed before the gateway replied.'))
    }
    pending.clear()
  }

  const dialNow = (start: boolean, attempt: number) => {
    const mine = ++dials
    enter({ at: 'dialing', attempt })
    Promise.resolve().then(() => dial({ start })).then(
      socket => (mine === dials && phase.at === 'dialing' ? handshake(socket, attempt) : socket.close()),
      (error: unknown) => {
        if (mine === dials && phase.at === 'dialing') failed(error instanceof DialError ? error : new DialError('dropped'), attempt)
      }
    )
  }

  const failed = (error: DialError, attempt: number) => {
    const { kind, message } = error
    if (!RETRIES[kind]) return enter({ at: 'blocked', why: kind as BlockedWhy, message })
    const wait = backoffMs(attempt, random())
    const cancel = clock.setTimeout(() => dialNow(false, attempt + 1), wait)
    enter({ at: 'waiting', attempt, retryAt: clock.now() + wait, why: kind as WaitingWhy, message, cancel })
  }

  const lost = (socket: WireSocket, error: DialError) => {
    const held = phase
    if ((held.at !== 'handshake' && held.at !== 'online') || held.socket !== socket) return
    if (held.at === 'handshake') held.giveUp()
    else held.heartbeat.stop()
    release(socket)
    failed(error, held.at === 'online' && clock.now() - held.since >= BACKOFF_RESET_AFTER_MS ? 1 : held.attempt)
  }

  const handshake = (socket: WireSocket, attempt: number) => {
    const giveUp = clock.setTimeout(() => lost(socket, new DialError('dropped')), HANDSHAKE_MS)
    heardAt = clock.now()
    enter({ at: 'handshake', attempt, socket, giveUp })
    socket.onClose = code => lost(socket, new DialError(CLOSE_KINDS[code] === 'draining' ? 'draining' : 'dropped'))
    socket.onText = text => receive(socket, text)
  }

  const ready = async (socket: WireSocket, payload: unknown) => {
    const tooOld = new DialError('incompatible', 'This Hermes gateway is too old for Highwing.')
    if (!isObject(payload) || payload.session_authority !== true) return lost(socket, tooOld)
    try {
      await request(socket, 'client.capabilities', { server_requests: true })
      const described = await request(socket, 'runtime.describe', {}) as CanonicalRpcMethods['runtime.describe']['result']
      if (phase.at !== 'handshake' || phase.socket !== socket) return
      phase.giveUp()
      const { sources, parameters } = described.session_create
      enter({ at: 'online', attempt: phase.attempt, socket, since: clock.now(), creation: { sources, parameters }, heartbeat: beat(socket) })
      events.onOnline()
    } catch (error) {
      if (error instanceof RpcRefusal) lost(socket, tooOld)
      else if (!(error instanceof Offline)) throw error
    }
  }

  const beat = (socket: WireSocket) => {
    let cancel = () => {}
    const arm = () => {
      cancel = clock.setTimeout(() => {
        if (clock.now() - heardAt >= SILENCE_MS) return lost(socket, new DialError('dropped'))
        request(socket, 'gateway.ping').catch(() => {})
        arm()
      }, PING_MS)
    }
    arm()
    return { stop: () => cancel() }
  }

  const receive = (socket: WireSocket, text: string) => {
    heardAt = clock.now()
    let frame: unknown
    try {
      frame = JSON.parse(text)
    } catch {
      return
    }
    if (!isObject(frame)) return
    const { id, method, params } = frame
    if (typeof method !== 'string') {
      const call = typeof id === 'number' ? pending.get(id) : undefined
      if (call === undefined) return
      pending.delete(id as number)
      call.cancel()
      return 'error' in frame ? call.reject(refusalOf(frame.error)) : call.resolve(frame.result)
    }
    if (id !== undefined && id !== null) return events.onServerRequest({ id: String(id), method, params })
    if (method !== 'event') return
    if (isObject(params) && params.type === 'gateway.ready') {
      if (phase.at === 'handshake' && phase.socket === socket) void ready(socket, params.payload)
      return
    }
    events.onEvent(params)
  }

  dialNow(options.startOnLaunch, 1)

  return {
    get link() { return link },
    get creation() { return phase.at === 'online' ? phase.creation : null },
    call: <M extends Method>(method: M, params: CanonicalRpcMethods[M]['params'], timeoutMs?: number) => {
      if (phase.at !== 'online') return Promise.reject(new Offline(`${method} was not sent: Highwing is not connected to Hermes.`))
      return request(phase.socket, method, params, timeoutMs) as Promise<CanonicalRpcMethods[M]['result']>
    },
    decline: (requestId, message) => {
      if (phase.at === 'online') phase.socket.send(JSON.stringify({ jsonrpc: '2.0', id: requestId, error: { code: METHOD_NOT_FOUND, message } }))
    },
    retryNow: ({ start }) => {
      if (phase.at === 'waiting') {
        phase.cancel()
        dialNow(start, phase.attempt + 1)
      } else if (phase.at === 'blocked') {
        dialNow(start, 1)
      } else if (phase.at === 'dialing') {
        dialNow(start, phase.attempt)
      }
    },
    close: () => {
      const held = phase
      dials++
      enter({ at: 'closed' })
      if (held.at === 'waiting') held.cancel()
      if (held.at === 'handshake') held.giveUp()
      if (held.at === 'online') held.heartbeat.stop()
      if (held.at === 'handshake' || held.at === 'online') release(held.socket)
    }
  }
}
