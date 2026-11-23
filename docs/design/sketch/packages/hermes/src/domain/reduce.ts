/**
 * The only writer of a session's state. Pure: `(state, input) -> state`, no clock, no I/O.
 * One `SessionActor` (actor.ts) owns one `Tracked` value and calls `reduce` for every change:
 * gateway events, the attach lifecycle, and this client's own actions (a message sent, an answer on
 * its way). Tests feed it event logs.
 */
import type {
  Ask, Began, FileDiff, Generation, InputId, Json, Link, Outcome, PromptId, PromptReply, Session, SessionContent,
  SessionId, SettledTurn, Sync, ToolId, ToolResult, TurnId
} from './session'

/** A gateway event in domain terms. `wire/parse.ts` builds these. Field names are ours, not the wire's. */
export type SessionEvent =
  | { readonly type: 'turn.started'; readonly turnId: TurnId | null; readonly admissionId: string | null; readonly requestText: string | null }
  | { readonly type: 'text.delta'; readonly text: string; readonly at: TextCursor | null }
  | { readonly type: 'text.sealed'; readonly text: string | null } // segment boundary; text replaces the segment when given
  | { readonly type: 'thinking' }
  | { readonly type: 'tool.announced'; readonly name: string }
  | { readonly type: 'tool.started'; readonly id: ToolId; readonly name: string; readonly args: { readonly [k: string]: Json } }
  | { readonly type: 'tool.progress'; readonly id: ToolId; readonly note: string }
  | {
      readonly type: 'tool.finished'
      readonly id: ToolId
      readonly name: string
      readonly args: { readonly [k: string]: Json } | null
      readonly durationS: number | null
      readonly diffs: readonly FileDiff[]
      readonly result: ToolResult
    }
  /** `generation` is the prompt payload's own `execution_generation`, never the envelope's nullable stamp. */
  | { readonly type: 'prompt.opened'; readonly id: PromptId; readonly generation: Generation; readonly ask: Ask }
  | { readonly type: 'prompt.settled'; readonly id: PromptId }
  | { readonly type: 'prompts.cancelled'; readonly ids: readonly PromptId[] }
  | { readonly type: 'turn.ended'; readonly outcome: Outcome; readonly finalText: string | null; readonly rows: readonly number[] }
  | { readonly type: 'notice'; readonly tone: 'error' | 'info'; readonly text: string }
  | { readonly type: 'meta'; readonly title?: string; readonly revision?: number; readonly queue?: readonly Admission[] }

/** Position of a delta in the stream. A delta at or before the fence's position is a re-send and is dropped. */
export interface TextCursor { readonly segment: number; readonly offset: number }

/** A position in one session's event stream. `seq` only means something within its `epoch`. */
export interface Cursor { readonly epoch: string; readonly seq: number }

/** Where an event sits in the session's stream. `generation` is the envelope's stamp, absent on some frames. */
export interface Stamp extends Cursor { readonly generation: Generation | null }

/**
 * One frame of a session's stream. `event` is null for a type Highwing does not show yet and for a
 * payload it could not use. Such a frame still moves the cursor, so it is never mistaken for a hole.
 */
export interface StampedEvent {
  readonly stamp: Stamp
  readonly event: SessionEvent | null
  /**
   * This client's clock when the frame came off the live socket. null for a frame whose arrival says
   * nothing about when it happened: a replayed one, or a catch-up frame parked during an attach.
   */
  readonly seenAt: number | null
}

/** A user message as the gateway's queue sees it. */
export interface Admission {
  readonly inputId: InputId
  readonly admissionId: string
  readonly text: string
  readonly status: 'queued' | 'started' | 'unknown' | 'terminal'
}

/** A server-to-client JSON-RPC request. The first build shows none of them and declines every one. */
export interface ServerRequest { readonly requestId: string; readonly method: string; readonly sessionId: SessionId | null }

/** A parsed attach reply (`session.create` / `session.resume`). */
export interface Snapshot {
  readonly id: SessionId
  readonly title: string
  readonly cwd: string | null
  readonly running: boolean
  readonly generation: Generation
  readonly revision: number
  readonly subscriptionId: string
  /** Everything up to here is the snapshot's to tell. Everything after it arrives as events. */
  readonly watermark: Cursor
  readonly queue: readonly Admission[]
  readonly prompts: readonly { readonly id: PromptId; readonly generation: Generation; readonly ask: Ask }[]
  /**
   * Stored history as of `watermark`. The gateway reads the rows and the watermark under one lock, so
   * the two never overlap and never leave a hole. null when the resume asked for no rows (a reconnect).
   */
  readonly history: HistoryPage | null
  /** Server requests that still wait for an answer from some client. */
  readonly openRequests: readonly ServerRequest[]
}

/** The answer to `session.events.since`. */
export interface Replay {
  /** The gateway cannot replay from our cursor. Only a snapshot with history helps. */
  readonly snapshotRequired: boolean
  readonly epoch: string
  readonly events: readonly StampedEvent[]
}

/** Stored rows, oldest first, already folded into turns. */
export interface HistoryPage {
  readonly turns: readonly SettledTurn[]
  /** Set when the last stored turn has no end yet. On a running session it becomes the open turn's start. */
  readonly unfinished: { readonly request: string | null; readonly began: Began | null; readonly items: SettledTurn['items'] } | null
  /** null: the gateway holds nothing older. Otherwise where `session.transcript` continues (`cursor` null: from its latest page). */
  readonly older: { readonly cursor: string | null } | null
}

/**
 * The attach lifecycle of one session on the current socket, as one value. Only `reduce` changes it.
 * "Attached with no cursor", "attaching and not parking" and "replaying from nowhere" cannot be built.
 */
export type Gate =
  /** Not subscribed. Frames are dropped. `cursor` survives so the next attach can replay from it. */
  | { readonly at: 'detached'; readonly why: 'new' | 'link-lost' | { readonly refused: string }; readonly cursor: Cursor | null }
  /**
   * An attach is in flight. Live frames park here until it settles. A new `attempt` number abandons
   * the calls of the older one: their replies no longer match and are ignored.
   */
  | {
      readonly at: 'attaching'
      readonly attempt: number
      readonly plan: { readonly mode: 'open' } | { readonly mode: 'replay'; readonly from: Cursor } | { readonly mode: 'rebuild' }
      readonly parked: readonly StampedEvent[]
    }
  | { readonly at: 'live'; readonly cursor: Cursor; readonly subscriptionId: string }

export type SessionInput =
  /** "Be attached on the current socket." From the hub when a socket comes online, a first watcher arrives, or the user retries. */
  | { readonly in: 'attach' }
  /** The replies of attempt `attempt`. `replay` is null when the plan was not `replay`. */
  | { readonly in: 'attached'; readonly attempt: number; readonly snapshot: Snapshot; readonly replay: Replay | null }
  /** `refused` null: the socket died first. Otherwise the gateway said no, in words for the user. */
  | { readonly in: 'attach.failed'; readonly attempt: number; readonly refused: string | null }
  | { readonly in: 'link.lost' }
  | { readonly in: 'event'; readonly frame: StampedEvent }
  /** `session.replay_gap`: this socket missed frames the gateway cannot replay. It has no seq of its own. */
  | { readonly in: 'gap' }
  | { readonly in: 'earlier'; readonly page: HistoryPage }
  /** A server request was refused because this build cannot show it. */
  | { readonly in: 'declined'; readonly request: ServerRequest }
  | { readonly in: 'local'; readonly action: LocalAction }

/** What this client did. Folded through the same reducer so a second window sees it too. */
export type LocalAction =
  | { readonly did: 'send'; readonly inputId: InputId; readonly text: string }
  | { readonly did: 'send.admitted'; readonly inputId: InputId; readonly admissionId: string; readonly status: Admission['status'] }
  | { readonly did: 'send.failed'; readonly inputId: InputId; readonly message: string }
  | { readonly did: 'send.discarded'; readonly inputId: InputId }
  | { readonly did: 'stop' }
  | { readonly did: 'answer'; readonly promptId: PromptId; readonly reply: PromptReply }
  | { readonly did: 'answer.resolved'; readonly promptId: PromptId; readonly byUs: boolean }
  | { readonly did: 'answer.failed'; readonly promptId: PromptId; readonly message: string }
  | { readonly did: 'earlier.requested' }

/** Bookkeeping the views never need. Kept beside the content so one reducer guards both. */
export interface Fence {
  /** Compare-and-swap value for `session.mutate`. Never moves backwards. */
  readonly revision: number
  readonly text: TextCursor | null
  /** Where `loadEarlier` continues. null when the gateway holds nothing older. */
  readonly older: HistoryPage['older']
  /** admissionId -> inputId, learned from receipts and queue rows. Lets `turn.started` claim its outbox entry. */
  readonly admissions: { readonly [admissionId: string]: InputId }
  /** Highest stored row id among the turns held as settled. See the `lost` rule in the seed below. */
  readonly settledThrough: number | null
  /** Attach attempts begun so far. The next attempt is this plus one. */
  readonly attaches: number
}

export interface Tracked {
  readonly content: SessionContent
  readonly gate: Gate
  readonly fence: Fence
}

export function emptyTracked(id: SessionId): Tracked {
  throw new Error('not implemented')
}

/** More frames than this parked during one attach is treated as a gap. */
export const PARK_LIMIT = 2048

/**
 * Invariants:
 * - Returns the same `content` reference when nothing visible changed, and keeps the identity of
 *   every turn and item it did not touch. IPC patches and React memoisation rely on this.
 * - Idempotent per id: a tool is upserted by `ToolId`, a prompt by `PromptId`, an outbox entry by
 *   `InputId`, a declined notice by `requestId`. Applying the same input twice changes nothing the
 *   second time. `attach` on a session that is attaching or live changes nothing.
 * - A reply of an older attach attempt changes nothing.
 */
export function reduce(state: Tracked, input: SessionInput): Tracked {
  // ---------- the gate ----------
  // TODO attach: detached -> attaching{attempt: attaches + 1, parked: [], plan}. plan is replay{from: cursor}
  //   when a cursor survives, else open when nothing was ever seeded, else rebuild. Otherwise no change.
  // TODO link.lost: -> detached{'link-lost', cursor: the live cursor, or the replay plan's `from`, or the
  //   cursor already kept}. Parked frames are discarded: the next socket replays or rebuilds.
  // TODO attach.failed (attempt must match): -> detached{refused ? {refused} : 'link-lost', cursor kept}.
  // TODO event, one rule for live frames, replayed frames and parked frames (the seq gate):
  //   detached                      -> drop. We are not subscribed; this is a straggler.
  //   attaching                     -> park. Past PARK_LIMIT, handle as `gap`.
  //   live, epoch !== cursor.epoch  -> handle as `gap`. The stream restarted.
  //   live, seq <= cursor.seq       -> drop. Already applied.
  //   live, otherwise               -> cursor = stamp. Then fold `event`, unless it is null or its
  //                                    stamp.generation is older than an open run's generation.
  // TODO gap (never meets the seq gate, because `session.replay_gap` carries no envelope seq):
  //   live or attaching -> attaching{attempt: attaches + 1, plan: rebuild, parked: []}.
  //   detached          -> cursor = null, so the next attach rebuilds.
  //   Content stays on screen until the seed replaces it.
  // TODO attached (attempt must match). Three cases:
  //   A. plan replay, replay not snapshotRequired, and replay.epoch === snapshot.watermark.epoch === from.epoch.
  //      Content is kept. The order is the point:
  //      1. Fold replay.events through the seq gate, starting at `from`.
  //      2. Fold the parked frames with seq <= watermark.seq. These are the gateway's catch-up frames,
  //         published between its replay answer and the join (gateway/session_events.py:114-124).
  //         A `turn.ended` among them settles the run before the snapshot is compared with it.
  //      3. cursor.seq !== watermark.seq -> frames are missing: go to C. The reconcile below never moves
  //         the cursor, so it cannot skip a catch-up frame.
  //      4. Reconcile with the snapshot, the truth as of the watermark: revision, title, queue.
  //         A waiting prompt absent from snapshot.prompts -> answered{reply: null}. A snapshot prompt we do
  //         not hold -> added as waiting. An open run whose generation the snapshot no longer runs -> settled
  //         `lost`. snapshot.running with no open run -> open one, request from the queue's started entry.
  //      5. Fold the remaining parked frames through the seq gate. gate = live{cursor, subscriptionId}.
  //   B. snapshot.history !== null (first open, create, rebuild): content = seed(snapshot), cursor = watermark.
  //      Then fold the parked frames of that epoch with seq > watermark.seq. gate = live.
  //   C. Anything else (snapshot_required, an epoch changed, a hole): attaching{attempt: attaches + 1,
  //      plan: rebuild, parked kept}. The actor sees the new attempt and resumes again, with history.
  // TODO seed: history = snapshot.history.turns, fence.older = snapshot.history.older. If snapshot.running,
  //   run = a turn built from history.unfinished plus snapshot.prompts as waiting prompt items. If not
  //   running, history.unfinished becomes a settled turn with outcome `lost`, and snapshot.prompts are dropped.
  //   If a run was open before the seed and the snapshot no longer runs its generation, its end was missed
  //   for good: every history turn with a row newer than fence.settledThrough gets outcome `lost` (only
  //   the last turn when settledThrough is null). Outbox entries are matched to snapshot.queue by inputId.
  // ---------- the fold ----------
  // TODO turn.started: open a run for stamp.generation. Request = the outbox entry claimed through
  //   fence.admissions[admissionId]; else the single entry still 'sending'; else requestText; else null.
  //   Remove the claimed entry from the outbox. A repeated turnId is a duplicate and changes nothing.
  //   A newer generation while a run is open means its end was missed: settle that turn as `lost` first.
  //   Any item event with no open run opens one first with request null (we attached mid-turn).
  // TODO prompt.opened: upsert by id as waiting, with the event's own generation.
  // TODO text.delta: drop when `at` is not after fence.text. Append to the last item when it is unsealed
  //   text, else push a new text item. text.sealed seals it. A structural item (tool, prompt, notice)
  //   seals the text before it, so prose always lands above the row that followed it.
  // TODO turn.ended: finalText replaces the text after the last structural item, or is appended when there
  //   is none. Convert items to settled: running tool -> cut, waiting or sending prompt -> withdrawn,
  //   text -> sealed. Push SettledTurn{outcome, rows} to history, raise fence.settledThrough, run = idle.
  // TODO declined: upsert a declined notice by requestId in the open turn (opening one if none is open).
  // TODO earlier: prepend page.turns, minus every row already in some turn's `rows`. fence.older = page.older.
  throw new Error('not implemented')
}

/**
 * How current a session's content is, from its gate and the link. Pure. This is the only source of
 * `Session.sync`: attaching{open} -> opening, {replay} -> catching-up, {rebuild} -> rebuilding,
 * live -> live, detached{refused} -> unavailable, detached{'link-lost'} -> offline,
 * detached{'new'} -> opening while the link is online, else offline.
 */
export function syncOf(gate: Gate, link: Link): Sync {
  throw new Error('not implemented')
}

/** The value the actor publishes: the content plus `syncOf`. Returns `previous` when neither changed. */
export function sessionOf(state: Tracked, link: Link, previous: Session | null): Session {
  throw new Error('not implemented')
}

/**
 * What the agent is doing right now, derived from `run` and never stored.
 * The thread's live end, the sidebar badge, the composer's Send/Stop and later the tray all call this.
 * Precedence: stopping, asking, working, writing, preparing, thinking.
 */
export type Activity =
  | { readonly kind: 'idle' }
  | { readonly kind: 'thinking' }
  | { readonly kind: 'preparing'; readonly tool: string }
  | { readonly kind: 'writing' }
  /** `item` indexes `run.turn.items`: the most recently started tool that is still running. */
  | { readonly kind: 'working'; readonly item: number }
  /** `item` indexes `run.turn.items`: the oldest prompt still waiting or sending. */
  | { readonly kind: 'asking'; readonly item: number }
  | { readonly kind: 'stopping' }

export function activityOf(session: SessionContent): Activity {
  throw new Error('not implemented')
}
