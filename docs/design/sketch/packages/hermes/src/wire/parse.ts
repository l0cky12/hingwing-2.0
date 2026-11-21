/**
 * The only place gateway shapes become domain shapes. Everything past these functions trusts its types.
 * Pure. Never throws on bad input: a frame it cannot use is still classified, and the hub counts it.
 */
import type { HistoryPage, Replay, ServerRequest, SessionEvent, Snapshot, Stamp } from '../domain/reduce'
import type { FileDiff, SessionId, SidebarRow, ToolResult } from '../domain/session'
import type { CanonicalEventsResult, CanonicalSessionListRow, CanonicalSnapshot, StoredTranscriptResult } from './contract.generated'

export type ParsedEvent =
  /** One shown frame of a session's stream: a session id, a seq and a replay epoch on the envelope, and a payload we use. */
  | { readonly scope: 'session'; readonly sessionId: SessionId; readonly type: string; readonly stamp: Stamp; readonly event: SessionEvent }
  /**
   * A frame of a session's stream with nothing to show: a type we leave out for now (subagent.*,
   * todo.updated, reasoning text, status.update), or a payload we could not use. It still reaches the
   * session, so the cursor moves and the frame is not mistaken for a hole.
   */
  | { readonly scope: 'session'; readonly sessionId: SessionId; readonly type: string; readonly stamp: Stamp; readonly event: null; readonly skipped: 'unshown' | 'invalid' }
  /**
   * `session.replay_gap`. Its own kind because its `latest_seq` and `replay_epoch` sit in the
   * payload, not on the envelope (gateway/session_events.py:93-100), so it cannot pass a seq gate.
   */
  | { readonly scope: 'gap'; readonly sessionId: SessionId }
  /** `sessions.changed`: the sidebar should refetch. */
  | { readonly scope: 'app'; readonly event: 'sessions.changed' }
  /**
   * A session event with no session id, or a type with no stream position that we do not know.
   * Never guessed into a session, because one socket serves many of them. Counted as `unrouted`.
   */
  | { readonly scope: 'unrouted'; readonly type: string; readonly why: string }

/**
 * TODO one table keyed by wire event type: `{ 'message.delta': payload => SessionEvent | null, ... }`.
 * `SHOWN` and `UNSHOWN` together must cover the generated GATEWAY_EVENT_TYPES. A unit test fails when
 * a Hermes update adds a type that is in neither list.
 * Six canonical types are missing from that generated list (checked against Hermes 0.23.3):
 * approval.request, approval.settled, clarify.request, clarify.settled, session.replay_gap
 * (shapes in apps/shared/src/gateway-events.ts:37-49) and session.updated
 * (gateway/session_mutations.py:352). Their payloads are typed by hand here and checked field by field.
 *
 * message.start -> turn.started, message.delta {text: null} and message.interim -> text.sealed,
 * message.complete -> turn.ended (status and error_surface -> Outcome, persisted_turn.row_ids -> rows),
 * approval.request / clarify.request -> prompt.opened with the payload's execution_generation,
 * *.settled -> prompt.settled, approval.cancelled -> prompts.cancelled,
 * session.title / session.info / session.updated -> meta, error -> notice.
 */
export function parseEvent(params: unknown): ParsedEvent {
  throw new Error('not implemented')
}

/**
 * `messages_omitted` -> history null. Otherwise history comes from `display_messages`, the gateway's
 * own display rows, through `parseRows`. `older` is set when the first row carries `archived_truncated`.
 */
export function parseSnapshot(reply: CanonicalSnapshot): Snapshot {
  throw new Error('not implemented')
}

export function parseReplay(reply: CanonicalEventsResult): Replay {
  throw new Error('not implemented')
}

/** Consecutive `session.transcript` pages of older rows, newest page first. Same row parser as the snapshot. */
export function parseTranscript(pages: readonly StoredTranscriptResult[]): HistoryPage {
  throw new Error('not implemented')
}

/**
 * Stored rows -> settled turns, shared by `parseSnapshot` and `parseTranscript` (a transcript
 * `message` row is a `display_messages` row). A user row opens a turn. Assistant text, tool rows and
 * compaction rows become its items. Stored rows carry no diff, so a history tool is `done` with
 * `diffs: []`. A turn that ends in an assistant answer is `complete`. A turn with no answer is
 * `unfinished` when it is the last one, else `lost`. Every turn lists its `row_id`s.
 */
export function parseRows(rows: readonly unknown[]): Pick<HistoryPage, 'turns' | 'unfinished'> {
  throw new Error('not implemented')
}

export function parseListRows(rows: readonly CanonicalSessionListRow[]): Omit<SidebarRow, 'badge'>[] {
  throw new Error('not implemented')
}

/** A server-to-client request frame, or an `open_requests` entry of a snapshot. */
export function parseServerRequest(request: { readonly id: string; readonly method: string; readonly params: unknown }): ServerRequest {
  throw new Error('not implemented')
}

/** Hermes's `inline_diff`: ANSI-coloured, with a "review diff" banner and an "a/x → b/x" line per file. */
export function parseInlineDiff(raw: string): FileDiff[] {
  throw new Error('not implemented')
}

/** `{output, exit_code, error}` -> command; a string -> text; other JSON -> pretty-printed text. Caps at 256 kB. */
export function parseToolResult(toolName: string, result: unknown, resultText: string | null): ToolResult {
  throw new Error('not implemented')
}
