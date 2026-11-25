import type { BotId } from '../domain/bots'
import { CHECK_FAILURES, type SshFailure } from '../domain/reach'
import type { BlockedWhy, Link, WaitingWhy } from '../domain/session'
import type { CanonicalRpcMethods, ClientCapabilitiesResult, RpcMethods, ServerRequestMap, ServerRequestMethod } from './contract.generated'

/**
 * What a socket's ticket lets it reach. `host`: every profile the gateway serves, chosen per frame
 * by `profile`. `profile`: only the profile `attach` ran in, and a frame that names another is
 * refused `profile_mismatch` (Hermes's gateway/session_controls.py:197-223).
 */
export type Reach = 'host' | 'profile'

/** The seam under the whole client. Text frames in, text frames out. Fixtures implement it in memory. */
export interface WireSocket {
  readonly reach: Reach
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

const sshWords = (failure: SshFailure) => CHECK_FAILURES[failure].words('the Hermes machine')

const WORDS: Readonly<Record<Why, string>> = {
  'not-running': "Hermes isn't running.",
  draining: 'Hermes is restarting.',
  dropped: 'Reconnecting to Hermes.',
  'hermes-missing': "Highwing can't find the hermes command.",
  incompatible: "This version of Hermes doesn't work with Highwing.",
  auth: 'Hermes refused access to this profile.',
  inaccessible: "Highwing can't reach the Hermes gateway.",
  refused: 'Hermes refused the connection.',
  unreachable: sshWords('unreachable'),
  'ssh-missing': sshWords('ssh-missing'),
  'ssh-denied': sshWords('ssh-denied'),
  'ssh-check': sshWords('ssh-check'),
  'host-changed': sshWords('host-changed'),
  'signed-out': 'Sign in to Hermes again.'
}

const RETRIES: Readonly<Record<Why, boolean>> = {
  'not-running': true, draining: true, dropped: true, unreachable: true,
  'hermes-missing': false, incompatible: false, auth: false, inaccessible: false, refused: false,
  'ssh-missing': false, 'ssh-denied': false, 'ssh-check': false, 'host-changed': false,
  'signed-out': false
}

export class DialError extends Error {
  constructor(readonly kind: Why, message: string = WORDS[kind]) {
    super(message)
  }
}

/** Where to dial, the subprotocols that carry the ticket, and what that ticket reaches. */
export interface Endpoint { readonly url: string; readonly protocols: readonly string[]; readonly reach: Reach }
/**
 * Each call mints its own ticket, so a reconnect can never reuse one. The ticket lives only in the
 * `Endpoint` passed from here to the dial. It is never logged, stored, recorded or sent over IPC.
 */
export type Mint = (request: { readonly start: boolean }) => Promise<Endpoint>

export const GATEWAY_PROTOCOL = 'hermes-gateway-v1'
/** Hermes's hermes_cli/gateway_client.py:16 */
export const TICKET_PREFIX = 'hermes-gateway-ticket.'

/** `ensure_exit_code` in Hermes's `hermes_cli/gateway_runtime_cli.py:11-17`. 2 is an invocation this Hermes does not know. */
export const EXIT_KINDS: Readonly<Record<number, Why>> = { 2: 'incompatible', 3: 'incompatible', 4: 'auth', 5: 'not-running', 6: 'draining', 7: 'inaccessible' }

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Whether a frame is `gateway.ready`, and whether the gateway that sent it owns its sessions.
 * null: another frame. The standalone dashboard's socket says `gateway.ready` with no
 * `session_authority` (Hermes's tui_gateway/ws.py:378-401), and Highwing cannot chat through it.
 */
export function sessionAuthorityOf(frame: unknown): boolean | null {
  if (!isObject(frame) || frame.method !== 'event' || !isObject(frame.params) || frame.params.type !== 'gateway.ready') return null
  const { payload } = frame.params
  return isObject(payload) && payload.session_authority === true
}

export function wireSocket(transport: { send(text: string): void; close(): void }, reach: Reach): {
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
    reach,
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
    const { url, protocols, reach } = await mint({ start })
    return new Promise<WireSocket>((resolve, reject) => {
      // Node's built-in WebSocket sends no Origin header. The gateway refuses an upgrade that carries one.
      const ws = new WebSocket(url, [...protocols])
      const wire = wireSocket({ send: text => ws.send(text), close: () => ws.close() }, reach)
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
    readonly revision: number | null = null,
    readonly generation: number | null = null,
    readonly field: string | null = null,
    readonly detail: string | null = null
  ) {
    super(message)
  }
}
export class Offline extends Error {}

/**
 * The canonical route also serves methods the generated contract does not list as canonical:
 * `commands.catalog` and `command.dispatch` (`AuthorityConnection.handlers`, gateway/session_controls.py:239-247),
 * `model.options` (gateway/session_config.py:11-13), `session.context_breakdown` (gateway/session_tui_ops.py:33)
 * and `connection.respond` and `connectors.connect` (gateway/session_connections.py:10). So do the panel's calls: `process.list`, `process.kill`,
 * `subagent.interrupt` and `session.control.read` (gateway/session_ancillary.py:24-35), `session.control` (gateway/session_control_actions.py),
 * `rollback.*` (gateway/session_tui_ops.py:29-31) and `message.react` (gateway/session_reactions.py).
 * `complete.path` lists the files under a session's folder (gateway/session_controls.py:286-287).
 * `file.attach` is in gateway/session_ancillary.py:139-180 of a Hermes newer than the vendored contract,
 * and an older one may refuse it.
 * `profiles.create` is not canonical: the authority answers -32601 and the socket falls back to the legacy
 * handler for a connection with the interactive grant (tui_gateway/ws.py:403-411, tui_gateway/ws_legacy_fallback.py:53-62).
 * A -32601 from it means this Hermes cannot create bots from Highwing. `profiles.describe`, `profiles.configure`,
 * `profiles.set_asset` and `profiles.get_asset` reach the same legacy handlers the same way.
 * `projects.tree` reaches its legacy handler the same way (tui_gateway/methods_config.py:137), and a -32601 from it
 * means this Hermes cannot say which chats were branched from which.
 */
export type Served = CanonicalRpcMethods & Pick<RpcMethods,
  'commands.catalog' | 'command.dispatch' | 'model.options' | 'session.context_breakdown' | 'connection.respond' | 'connectors.connect' | 'complete.path' | 'file.attach' |
  'profiles.create' | 'profiles.describe' | 'profiles.configure' | 'profiles.set_asset' | 'profiles.get_asset' | 'projects.tree' |
  'prompt.btw' | 'prompt.background' | 'process.list' | 'process.kill' | 'subagent.interrupt' | 'session.control.read' | 'session.control' | 'rollback.list' |
  'rollback.diff' | 'rollback.restore' | 'message.react' | 'image.generate' | 'pet.gallery' | 'pet.thumb'>
export type Method = keyof Served

export type Requested = ServerRequestMap
export type RequestMethod = ServerRequestMethod

export interface Connection {
  readonly link: Link
  /** What the open socket's ticket reaches. null while not online. */
  readonly reach: Reach | null
  call<M extends Method>(method: M, params: Served[M]['params'], timeoutMs?: number): Promise<Served[M]['result']>
  /**
   * The same socket for one bot. Every call made through the result carries `profile: bot`, added
   * here, where the frame is written, so no caller can forget it or spell it. That matters most for
   * `session.detach`, which answers `detached: false` and no error when the key is missing. Hermes
   * Desktop stamps at the same seam (apps/desktop/src/store/gateway.ts:1105-1124).
   */
  as(bot: BotId): Calls
  /**
   * Answer a server-to-client request with JSON-RPC error -32601, the code Hermes's own client uses for
   * a request it has no handler for (apps/shared/src/json-rpc-channel.ts:94), so the agent stops waiting.
   * Hermes reads any error frame as "skipped", for every viewer (gateway/session_server_requests.py:89-96).
   * Works for a request that arrived on an earlier socket and is still listed as open.
   */
  decline(requestId: string, message: string): void
  /**
   * Answer a server-to-client request with a result frame. Hermes sends no reply to one
   * (gateway/session_controls.py:313-319), so the only failure known here is `Offline`, thrown when
   * no socket is online to write it to. `method` picks the result's shape and is not sent.
   */
  respond<M extends RequestMethod>(requestId: string, method: M, result: Requested[M]['result']): void
  /**
   * Whether this gateway sends the clarify tool's questions as one request to a client that asks for
   * that on `prompt.submit` (`canonical_clarify_batch`, tui_gateway/methods_voice.py:544-545). false while not online.
   */
  readonly clarifyBatch: boolean
  readonly creation: { readonly sources: readonly string[]; readonly parameters: readonly string[] } | null
  retryNow(request: { readonly start: boolean }): void
  close(): void
}

/** What a session's actor may use of the connection. */
export type Calls = Pick<Connection, 'link' | 'call' | 'respond' | 'clarifyBatch'>

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
export const METHOD_NOT_FOUND = -32601

type Creation = NonNullable<Connection['creation']>

type Phase =
  | { readonly at: 'dialing'; readonly attempt: number }
  | { readonly at: 'handshake'; readonly attempt: number; readonly socket: WireSocket; readonly giveUp: () => void }
  | { readonly at: 'online'; readonly attempt: number; readonly socket: WireSocket; readonly since: number; readonly creation: Creation; readonly clarifyBatch: boolean; readonly heartbeat: { stop(): void } }
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
  const { reason, revision, execution_generation: generation, field, detail } = isObject(data) ? data : {}
  return new RpcRefusal(
    typeof code === 'number' ? code : 0,
    typeof reason === 'string' ? reason : null,
    typeof message === 'string' ? message : 'The gateway refused the call.',
    typeof revision === 'number' ? revision : null,
    typeof generation === 'number' ? generation : null,
    typeof field === 'string' ? field : null,
    typeof detail === 'string' ? detail : null
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

  const ready = async (socket: WireSocket, authority: boolean) => {
    const tooOld = new DialError('incompatible', 'This Hermes gateway is too old for Highwing.')
    if (!authority) return lost(socket, tooOld)
    try {
      const able = await request(socket, 'client.capabilities', { server_requests: true }) as Partial<ClientCapabilitiesResult> | null
      const described = await request(socket, 'runtime.describe', {}) as CanonicalRpcMethods['runtime.describe']['result']
      if (phase.at !== 'handshake' || phase.socket !== socket) return
      phase.giveUp()
      const { sources, parameters } = described.session_create
      const clarifyBatch = able?.canonical_clarify_batch === true
      enter({ at: 'online', attempt: phase.attempt, socket, since: clock.now(), creation: { sources, parameters }, clarifyBatch, heartbeat: beat(socket) })
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
    const authority = sessionAuthorityOf(frame)
    if (authority !== null) {
      if (phase.at === 'handshake' && phase.socket === socket) void ready(socket, authority)
      return
    }
    events.onEvent(params)
  }

  dialNow(options.startOnLaunch, 1)

  const callAs = (bot: BotId | null): Connection['call'] => <M extends Method>(method: M, params: Served[M]['params'], timeoutMs?: number) => {
    if (phase.at !== 'online') return Promise.reject(new Offline(`${method} was not sent: Highwing is not connected to Hermes.`))
    return request(phase.socket, method, bot === null ? params : { ...params, profile: bot }, timeoutMs) as Promise<Served[M]['result']>
  }

  // A result frame names no profile: Hermes settles it as whichever of the socket's connections attached the session (gateway/session_controls.py:979-988).
  const respond: Connection['respond'] = (requestId, method, result) => {
    if (phase.at !== 'online') throw new Offline(`The answer to ${method} was not sent: Highwing is not connected to Hermes.`)
    phase.socket.send(JSON.stringify({ jsonrpc: '2.0', id: requestId, result }))
  }
  const clarifyBatch = () => phase.at === 'online' && phase.clarifyBatch

  return {
    get link() { return link },
    get reach() { return phase.at === 'online' ? phase.socket.reach : null },
    get creation() { return phase.at === 'online' ? phase.creation : null },
    get clarifyBatch() { return clarifyBatch() },
    call: callAs(null),
    as: bot => ({ get link() { return link }, get clarifyBatch() { return clarifyBatch() }, call: callAs(bot), respond }),
    respond,
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
