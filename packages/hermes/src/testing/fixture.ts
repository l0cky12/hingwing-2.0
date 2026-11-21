/**
 * `@highwing/hermes/testing`: a recorded or generated gateway, played back through the real client.
 * Units 1 and 2 hold the fixture format and its loader. The scripted gateway, `play` and `playToEnd` come with unit 4.
 */
import type { SessionId } from '../domain/session'

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
