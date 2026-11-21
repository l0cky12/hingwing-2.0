/**
 * `@highwing/hermes/testing`: a recorded or generated gateway, played back through the real client.
 * Handshake, attach, replay, parsing and the reducer all run for real, in tests and in the dev app.
 * No AI provider is involved.
 */
import type { Hermes } from '../hub'
import type { Session, SessionId } from '../domain/session'
import type { Dialer } from '../wire/link'

/**
 * A fixture is a JSONL file: one header line, then steps in order.
 * Frames are stored as they appear on the wire, so a recording needs no conversion and a parser bug shows up in replay.
 * No ticket can appear in one: the ticket travels in the upgrade request, which is never a frame.
 */
export interface Fixture {
  readonly header: {
    readonly fixture: 1
    readonly hermes: string
    readonly source: 'generated' | 'recorded'
    readonly sessionId: SessionId
    /** Canned answers for calls that are not part of the story. */
    readonly describe: unknown
    readonly list: unknown
    /** The session's stored display rows before the story starts. */
    readonly stored: readonly unknown[]
  }
  readonly steps: readonly FixtureStep[]
}

export type FixtureStep =
  /** The gateway sends a frame: an `event` notification or a server request. `at` is ms since the start. */
  | { readonly at: number; readonly push: unknown }
  /**
   * The story waits here until the client calls `method`, then answers with `reply` or `error`.
   * `params` are the recorded ones. Replay does not compare ids or keys the client mints fresh
   * (`input_id`, `request_id`); it does check that the key set matches what the method accepts.
   */
  | { readonly at: number; readonly await: string; readonly params: unknown; readonly reply?: unknown; readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown } }
  /** From here on the gateway's stored rows for the session are these. A resume that asks for history gets them. */
  | { readonly at: number; readonly stored: readonly unknown[] }
  /** The gateway closes the socket. The story continues on the client's next dial. */
  | { readonly at: number; readonly drop: number }

export function loadFixture(path: string): Fixture {
  throw new Error('not implemented')
}

export interface ScriptOptions {
  /** `'instant'` for tests, `'recorded'` for the dev app (`HIGHWING_FIXTURE=fixtures/errand.jsonl pnpm dev`). */
  readonly timing?: 'instant' | 'recorded'
  /**
   * `'memory'` (default): the fake sits at the `WireSocket` seam. `'loopback'`: the same fake listens
   * on 127.0.0.1 and the client reaches it through the real dial code (`dialWith`), with the fake's
   * own single-use tickets in place of the Hermes CLI.
   */
  readonly transport?: 'memory' | 'loopback'
  /**
   * Close the socket after the client received this many pushes. The story then publishes `missed`
   * more frames while no socket is attached, so they can reach the client only through replay.
   */
  readonly drop?: { readonly afterPush: number; readonly missed: number }
  /** Frames the replay ring keeps per session. Default 512, the gateway's own bound. A small value forces `snapshot_required`. */
  readonly ringFrames?: number
}

/**
 * A `Dialer` that plays a fixture as a gateway would. It enforces the real gateway's rules, so a
 * client protocol bug fails a fixture test instead of waiting for a live provider:
 * - Closed key sets. A call with an unknown or missing key gets 4001. The key sets are read from the
 *   vendored `wire/contract.openrpc.json`, not listed by hand.
 * - Attach before act. A session verb on a socket that has not created or resumed that session gets
 *   permission_denied.
 * - No server request before `client.capabilities {server_requests: true}`.
 * - Loopback only: the upgrade is refused when it carries an `Origin` header, a ticket that was
 *   used before, or anything but exactly one ticket subprotocol.
 * It answers by itself: gateway.ready, client.capabilities, runtime.describe, gateway.ping,
 * session.list, session.detach, and the attach calls. `session.resume` and `session.events.since`
 * are answered from the frames pushed so far (watermark, running, generation, open prompts, the
 * ring) and the current stored rows. Frames published between a `since` answer and the resume that
 * follows are written to the socket before the resume reply, as the gateway's catch-up does.
 * It reads the frames it pushes with `parseEvent`, so the envelope's field names stay in `wire/parse.ts`.
 * `done` rejects when the client makes a call the story did not expect.
 */
export function scriptedDialer(fixture: Fixture, options?: ScriptOptions): Dialer & { readonly done: Promise<void>; readonly dials: number; readonly received: readonly unknown[] } {
  throw new Error('not implemented')
}

/**
 * Wraps any dialer and appends every frame, in and out, to `path` in fixture format
 * (`HIGHWING_RECORD=out.jsonl pnpm dev`). A `session.resume` reply that carried rows is written as a
 * `stored` step. Recordings hold real paths and commands: they go to a git-ignored folder, and a
 * fixture is committed only after review.
 */
export function recordingDialer(inner: Dialer, path: string): Dialer {
  throw new Error('not implemented')
}

/**
 * Plays a fixture through `openHermes` with a stand-in user: when the story awaits `prompt.submit`,
 * `approval.respond`, `clarify.respond` or `session.interrupt`, it issues the matching `Command` with the
 * recorded text or choice. Yields the session after every step that changed it, so a test can assert on
 * any moment of a turn, not only its end.
 */
export function play(fixture: Fixture, options?: Omit<ScriptOptions, 'timing'>): AsyncIterable<{ readonly step: number; readonly session: Session; readonly hermes: Hermes }> {
  throw new Error('not implemented')
}

/** The last value `play` yields. */
export function playToEnd(fixture: Fixture, options?: Omit<ScriptOptions, 'timing'>): Promise<Session> {
  throw new Error('not implemented')
}
