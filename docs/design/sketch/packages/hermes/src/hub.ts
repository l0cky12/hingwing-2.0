/**
 * The public face of `@highwing/hermes`: a live, typed mirror of the gateway plus the commands a UI needs.
 * A caller never sees a ticket, a socket, a seq, an epoch, a generation, a revision or an idempotency key.
 * Runs in Node. No Electron import: the desktop app, a test and a future CLI all use it the same way.
 */
import type { InputId, Link, PromptId, PromptReply, Session, SessionId, Sidebar } from './domain/session'
import type { Outcome } from './actor'
import type { Clock, Dialer } from './wire/link'

export type { Outcome, Refusal } from './actor'
export type { Clock, Dialer, WireSocket } from './wire/link'
export { DialError, liveDialer } from './wire/link'

/** A value that changes. `subscribe` calls back on every change, not for the current value. */
export interface Feed<T> {
  get(): T
  subscribe(listener: (value: T) => void): () => void
}

/**
 * Everything a UI can ask for, as data. The same union crosses IPC unchanged, so adding a command
 * means adding one member here and one case in `Hermes.run`.
 */
export type Command =
  /** `draftId` is minted when the empty "new chat" view opens. Retrying with it cannot create a second session. */
  | { readonly do: 'create'; readonly draftId: string; readonly cwd: string | null }
  | { readonly do: 'send'; readonly sessionId: SessionId; readonly text: string }
  | { readonly do: 'stop'; readonly sessionId: SessionId }
  | { readonly do: 'answer'; readonly sessionId: SessionId; readonly promptId: PromptId; readonly reply: PromptReply }
  | { readonly do: 'discard'; readonly sessionId: SessionId; readonly inputId: InputId } // drop a failed outbox entry
  | { readonly do: 'rename'; readonly sessionId: SessionId; readonly title: string }
  | { readonly do: 'archive'; readonly sessionId: SessionId; readonly archived: boolean }
  | { readonly do: 'loadEarlier'; readonly sessionId: SessionId }
  /** Retry: dial now. Start: dial now and let Hermes start its gateway. The only way a dial after launch starts it. */
  | { readonly do: 'reconnect'; readonly start: boolean }

export type ResultOf<C extends Command> = C extends { do: 'create' } ? SessionId : void

export interface Hermes {
  readonly link: Feed<Link>
  readonly sidebar: Feed<Sidebar>
  /**
   * Watch one session. The listener gets the current value at once and every later one. A session is
   * kept attached while a window watches it, while the gateway lists it as running, while its own
   * run is open, and while it has unsent messages. It is detached 60 s after none of those hold.
   * Call the returned function to stop watching.
   */
  watch(id: SessionId, listener: (session: Session) => void): () => void
  /** Never rejects for an expected failure: that is a `Refusal`. Most outcomes also show up in the feeds. */
  run<C extends Command>(command: C): Promise<Outcome<ResultOf<C>>>
  close(): Promise<void>
}

export interface HermesOptions {
  /** `liveDialer()` for the real gateway, `scriptedDialer(fixture)` for a recorded one. */
  readonly dial: Dialer
  /** Whether the first dial after launch may start the gateway. Automatic retries never do. Default true. */
  readonly startGatewayOnLaunch?: boolean
  readonly clock?: Clock
  /** Counts for a debug panel: frames not shown, unusable, or with no session to go to, and requests declined. No payloads, no tickets. */
  readonly onDiagnostic?: (what: { readonly kind: 'unshown' | 'invalid' | 'unrouted' | 'declined'; readonly type: string }) => void
  /** Name sent as `client` on `session.create` when the gateway accepts it. */
  readonly client: { readonly name: string; readonly version: string }
}

export function openHermes(options: HermesOptions): Hermes {
  // TODO state: conn = connect(dial, events, {startOnLaunch, clock}); actors = Map<SessionId, SessionActor>;
  //   list = sessionList(conn, changed); watcher counts.
  // TODO onEvent(params): switch parseEvent(params).scope
  //   'session'  -> actors.get(sessionId)?.feed({in: 'event', frame: {stamp, event}}), else count 'unrouted'.
  //                 A skipped frame is fed too (it moves the cursor) and counted as 'unshown' or 'invalid'.
  //                 A 'meta' title also updates the matching list row, attached or not.
  //   'gap'      -> actors.get(sessionId)?.feed({in: 'gap'}).
  //   'app'      -> list.refresh() after a 300 ms debounce.
  //   'unrouted' -> onDiagnostic. An event with no session id is dropped here and nowhere else.
  // TODO refuse(request), the one path for a server request this build cannot show (sudo, secret, setup cards):
  //   conn.decline(request.requestId, words), then actors.get(request.sessionId)?.feed({in: 'declined', request}), then
  //   count 'declined'. onServerRequest(raw) calls refuse(parseServerRequest(raw)). An actor calls it for
  //   each open request its attach snapshot lists. Declining twice is harmless: the notice is keyed by requestId.
  // TODO onLink: actor.linkChanged() for every actor; list.stale() when not online. onOnline: list.refresh().
  // TODO retention, recomputed after each list refresh, each watch change and each publish:
  //   wanted = watched ids + list.running + ids whose run is open or whose outbox is not empty.
  //   A wanted id with no actor -> make one and attach(). An actor unwanted for 60 s -> detach(), delete.
  //   list.running is why an approval in a chat that no window shows still turns its sidebar row to `asking`.
  // TODO sidebar feed = deriveSidebar(list, actors): the stored rows, with title and badge taken from an
  //   actor's session when one exists. Recomputed when either changes. Nothing copies a badge into the rows.
  // TODO run:
  //   'create' -> session.create {source: 'gui', request_id: draftId, cwd, cwd_explicit, client}, keys
  //               filtered by conn.creation.parameters; refuse 'unsupported' when 'gui' is not an offered
  //               source. On the reply, make the actor and attach() it like any other session. That costs
  //               one cheap resume and keeps a single attach path.
  //   session commands -> the actor's method. If no actor exists (archive from the sidebar), make one and
  //               attach it first, because every session verb needs this socket to be subscribed.
  //   'reconnect' -> conn.retryNow({start}); attach() for every actor.
  throw new Error('not implemented')
}
