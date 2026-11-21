/**
 * Everything about having one working, handshaken socket to the gateway: ticket, dial, handshake,
 * heartbeat, JSON-RPC correlation, backoff. Runs in Node (Electron main or a test). Private to
 * `@highwing/hermes`; only `Dialer`, `WireSocket`, `DialError` and `liveDialer` are re-exported.
 */
import type { BlockedWhy, Link, WaitingWhy } from '../domain/session'
// Vendored, types only: one generated file copied from Hermes's apps/shared by `pnpm sync:contract`.
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

export class DialError extends Error {
  constructor(readonly kind: WaitingWhy | BlockedWhy, message: string) {
    super(message)
  }
}

/** A URL and the subprotocol list for one dial. `protocols` holds the single-use ticket. */
export interface Endpoint { readonly url: string; readonly protocols: readonly string[] }
/** Mints a fresh endpoint. Rejects with `DialError`. Private to the package: tests pass a fake gateway's. */
export type Mint = (request: { readonly start: boolean }) => Promise<Endpoint>

/**
 * The real gateway. Each call mints its own ticket, so a reconnect can never reuse one.
 * The ticket lives only in the `Endpoint` this module passes from `Mint` to the dial. It is never
 * logged, stored, recorded or sent over IPC.
 */
export function liveDialer(options: { hermesBin?: string } = {}): Dialer {
  // TODO return dialWith(cliMint(options)), where cliMint per call runs
  //   execFile(hermesBin ?? 'hermes', ['gateway', 'attach', '--json', ...(start ? ['--start', '--timeout', '75'] : ['--timeout', '20'])]).
  //   Exit 0: one JSON line {url, protocols}. Otherwise a DialError:
  //     ENOENT -> hermes-missing        exit 2 or 3 -> incompatible        exit 4 -> auth
  //     exit 5 -> not-running           exit 6 -> draining                 exit 7 -> inaccessible
  throw new Error('not implemented')
}

/** The dial itself, shared by the real gateway and the loopback fake. Private to the package. */
export function dialWith(mint: Mint): Dialer {
  // TODO per call:
  //   1. {url, protocols} = await mint({start}).
  //   2. new WebSocket(url, protocols) with Node's built-in WebSocket. It sends no Origin header, which
  //      the gateway requires. `protocols` carries hermes-gateway-v1 and the ticket subprotocol.
  //   3. On open require ws.protocol === 'hermes-gateway-v1', else close and reject incompatible.
  //      Close 4403 before open -> refused. Close 1013 -> draining. Any other failure -> dropped.
  throw new Error('not implemented')
}

/** The gateway refused a call. `reason` is its machine-readable cause (stale_generation, permission_denied, ...). */
export class RpcRefusal extends Error {
  constructor(readonly code: number, readonly reason: string | null, message: string) {
    super(message)
  }
}
/** The socket was not usable, or died before the reply. The request may or may not have been applied. */
export class Offline extends Error {}

type Method = keyof CanonicalRpcMethods

export interface Connection {
  readonly link: Link
  /**
   * One canonical call. Param types come from the generated contract, so a stray key fails `tsc`
   * instead of earning `invalid_params` at run time. Rejects with `RpcRefusal` or `Offline`.
   * Calls are written to the socket in call order. The attach sequence depends on that.
   * `client.capabilities` and `gateway.ping` are not in this map (checked against Hermes 0.23.3).
   * Only the handshake and heartbeat inside this file send them, through a private untyped request.
   */
  call<M extends Method>(method: M, params: CanonicalRpcMethods[M]['params'], timeoutMs?: number): Promise<CanonicalRpcMethods[M]['result']>
  /**
   * Answer a server-to-client request with JSON-RPC error -32601, the code Hermes's own client uses for
   * a request it has no handler for (apps/shared/src/json-rpc-channel.ts:94), so the agent stops waiting.
   * Works for a request that arrived on an earlier socket and is still listed as open.
   */
  decline(requestId: string, message: string): void
  /** What `runtime.describe` allowed for `session.create` on this socket. */
  readonly creation: { readonly sources: readonly string[]; readonly parameters: readonly string[] } | null
  /** Dial now instead of waiting for the backoff. `start` is true only for the user's Start button. */
  retryNow(request: { readonly start: boolean }): void
  close(): void
}

export interface ConnectionEvents {
  onLink(link: Link): void
  /** The handshake finished on a new socket. Every attachment made on an older socket is gone. */
  onOnline(): void
  /** The `params` of one `event` notification, unparsed. */
  onEvent(params: unknown): void
  /** A server-to-client JSON-RPC request, unparsed. The receiver must answer it or `decline` it. */
  onServerRequest(request: { readonly id: string; readonly method: string; readonly params: unknown }): void
}

/**
 * Starts connecting at once and keeps one socket alive until `close()`.
 */
export function connect(dial: Dialer, events: ConnectionEvents, options: { readonly startOnLaunch: boolean; readonly clock?: Clock }): Connection {
  // TODO lifecycle, one attempt:
  //   link connecting -> dial({start}) -> wait for the gateway.ready event (10 s). Require
  //   session_authority === true, else blocked "this Hermes gateway is too old for Highwing".
  //   `start` is options.startOnLaunch for the first dial of this process, the argument of retryNow
  //   for a dial the user asked for, and false for every dial the backoff timer makes.
  //   call client.capabilities {server_requests: true}, then runtime.describe {} and keep session_create.
  //   Start the heartbeat: gateway.ping every 15 s; 45 s with no inbound frame closes the socket.
  //   link online, onOnline().
  // TODO on close or DialError: reject every pending call with Offline. A WaitingWhy kind -> link waiting,
  //   redial after backoff 1 s doubling to 30 s with jitter, reset after 30 s online. A BlockedWhy kind ->
  //   link blocked until retryNow().
  throw new Error('not implemented')
}

/** Injected so fixtures replay instantly and backoff is testable. */
export interface Clock {
  now(): number
  setTimeout(run: () => void, ms: number): () => void
}
export declare const systemClock: Clock
