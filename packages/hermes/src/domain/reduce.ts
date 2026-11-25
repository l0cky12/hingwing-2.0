/**
 * The only writer of a session's state. Pure: `(state, input) -> state`, no clock, no I/O.
 * One `SessionActor` (actor.ts) owns one `Tracked` value and calls `reduce` for every change:
 * gateway events, the attach lifecycle, and this client's own actions (a message sent, an answer on
 * its way). Tests feed it event logs.
 */
import { queueOf, type Admission } from './queue'
import { accepted, answering, closed, failed, opened, reconciled, type Change, type CloseWhy, type Held } from './requests'
import type {
  AdmissionId, Ask, Attachment, Began, FileDiff, Generation, HelperEnd, HelperId, HelperItem, InputId, Item, Json, Link, MoaItem, ModelRef, OpenTurn,
  OutboxEntry, Outcome, PlanEntry, PromptId, PromptItem, PromptReply, QueuedMessage, ReasoningItem, RecordedReply, Request, RequestAsk, RequestId, Run,
  Session, SessionContent, SessionId, SessionModel, SessionUsage, SettledTurn, SideId, SideTask, StatusAbout, StatusItem, Sync, TextItem, Tokens, Told, ToolId,
  ToolItem, ToolResult, Tuning, TurnId
} from './session'

/** A gateway event in domain terms. `wire/parse.ts` builds these. Field names are ours, not the wire's. */
export type SessionEvent =
  | { readonly type: 'turn.started'; readonly turnId: TurnId | null; readonly admissionId: string | null; readonly requestText: string | null }
  | { readonly type: 'text.delta'; readonly text: string; readonly at: TextCursor | null }
  | { readonly type: 'text.sealed'; readonly text: string | null } // segment boundary; text replaces the segment when given
  | { readonly type: 'thinking' }
  /** `whole`: Hermes sent the block in one piece (`reasoning.available`), which may repeat the deltas of the same block. */
  | { readonly type: 'reasoning'; readonly text: string; readonly whole: boolean }
  /** The whole to-do list as of `revision`. */
  | { readonly type: 'plan'; readonly revision: number; readonly entries: readonly PlanEntry[] }
  /** One `subagent.*` frame. Addressed by the helper's id, never by the run, so a helper's frames still land after its turn ends. */
  | {
      readonly type: 'helper'
      readonly id: HelperId
      readonly parentId: HelperId | null
      readonly depth: number
      readonly goal: string
      readonly toolCount: number | null
      readonly update: HelperUpdate
    }
  | { readonly type: 'moa'; readonly step: MoaStep }
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
      readonly image: string | null
    }
  /** `generation` is the prompt payload's own `execution_generation`, never the envelope's nullable stamp. */
  | { readonly type: 'prompt.opened'; readonly id: PromptId; readonly generation: Generation; readonly ask: Ask; readonly timeoutS: number | null }
  | { readonly type: 'prompt.settled'; readonly id: PromptId }
  | { readonly type: 'prompts.cancelled'; readonly ids: readonly PromptId[] }
  /** `usage`: Hermes's session totals and context fill at the turn's end. null when the frame carries none. */
  | {
      readonly type: 'turn.ended'; readonly outcome: Outcome; readonly finalText: string | null; readonly rows: readonly number[]
      readonly userRow: number | null; readonly usage: SessionUsage | null
    }
  /** A tick while a turn runs. Its totals are mid-turn, so only the context fill is read. */
  | { readonly type: 'usage'; readonly context: SessionUsage['context'] }
  | { readonly type: 'notice'; readonly tone: 'error' | 'info'; readonly text: string }
  | { readonly type: 'status'; readonly about: StatusAbout; readonly text: string }
  | { readonly type: 'notice.shown'; readonly notice: ShownNotice }
  | { readonly type: 'notice.cleared'; readonly key: string }
  | { readonly type: 'request.cancelled'; readonly id: RequestId; readonly why: CloseWhy }
  /** A side question's or a background prompt's answer, by any client's task. */
  | { readonly type: 'side.answered'; readonly id: SideId; readonly kind: SideTask['kind']; readonly asked: string | null; readonly text: string }
  | { readonly type: 'connect'; readonly card: CardRequest; readonly settled: CloseWhy | null }
  | {
      readonly type: 'meta'
      readonly title?: string
      readonly revision?: number
      readonly queue?: readonly Admission[]
      readonly model?: ModelRef
      readonly cwd?: string
      /** Switches Hermes pushes for every viewer of the chat. */
      readonly tuning?: Partial<Said>
      readonly pick?: PickOutcome
      /** The session's generation now, which a policy change such as a model switch moves without a turn. */
      readonly generation?: Generation
      /** Hermes cut the chat before this stored row, here or in another client. */
      readonly cutBefore?: number
      /** Hermes rewrote the chat's stored rows (a compression or a reset, from any client), so it is read again. */
      readonly rewritten?: true
      /**
       * A committed model switch. Hermes drops the chat's agent (gateway/session_mutations.py:362) and the next
       * one counts its tokens from zero (run_agent.py:402-418).
       */
      readonly countsRestart?: true
    }

export type HelperUpdate =
  | { readonly is: 'queued' }
  | { readonly is: 'working'; readonly doing: 'thinking' | null }
  | { readonly is: 'progress' }
  | { readonly is: 'tool'; readonly name: string; readonly preview: string | null }
  | { readonly is: 'ended'; readonly status: HelperEnd; readonly durationS: number | null; readonly summary: string | null }

export type MoaStep =
  | { readonly is: 'progress'; readonly done: number; readonly total: number }
  | { readonly is: 'reference'; readonly label: string; readonly text: string }
  | { readonly is: 'aggregating'; readonly by: string | null }

export type ShownNotice = Pick<Extract<StatusItem, { what: 'notice' }>, 'key' | 'level' | 'text' | 'detail' | 'ttlMs'>

/** What became of a model pick, from Hermes's receipt. `settled`: a switch committed or a held pick was dropped. */
export type PickOutcome =
  | { readonly is: 'settled' }
  | { readonly is: 'asking'; readonly ask: NonNullable<SessionModel['ask']> }

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

/** A server-to-client JSON-RPC request, or a connector card, which Hermes opens with an event. */
export type ServerRequest =
  /** `waitS`: how long Hermes waits for an answer. null when its config decides. */
  | { readonly kind: 'card'; readonly requestId: RequestId; readonly sessionId: SessionId; readonly method: string; readonly ask: RequestAsk; readonly waitS: number | null }
  | { readonly kind: 'bridge'; readonly requestId: RequestId; readonly sessionId: SessionId | null; readonly method: string }
  | { readonly kind: 'unusable'; readonly requestId: RequestId; readonly method: string }
export type CardRequest = Extract<ServerRequest, { kind: 'card' }>
export type BridgeRequest = Extract<ServerRequest, { kind: 'bridge' }>

/** The switches Hermes says on every attach and pushes in `session.info`. The rest are read (`facts`). */
export type Said = Pick<Tuning, 'effort' | 'fast' | 'yolo'>

/** A parsed attach reply (`session.create` / `session.resume`). */
export interface Snapshot {
  readonly id: SessionId
  readonly title: string
  readonly cwd: string | null
  readonly model: ModelRef | null
  readonly tuning: Said
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
      readonly asked: readonly CardRequest[]
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
  /** The answer to a read of the session's usage. `asked` is `Fence.totalsEpoch` when the read was sent. */
  | { readonly in: 'usage'; readonly usage: SessionUsage; readonly asked: number }
  | { readonly in: 'request'; readonly request: CardRequest; readonly seenAt: number }
  | { readonly in: 'declined'; readonly request: BridgeRequest }
  /**
   * Answers to reads the actor made because a window watches the chat. `attempt` is the attach they
   * were read under. An answer read under an older attach changes nothing.
   */
  | { readonly in: 'facts'; readonly attempt: number; readonly tuning: Partial<Tuning> }
  | { readonly in: 'local'; readonly action: LocalAction }

/** What this client did. Folded through the same reducer so a second window sees it too. */
export type LocalAction =
  | {
    readonly did: 'send'; readonly inputId: InputId; readonly text: string; readonly apiText?: string; readonly attachments: readonly Attachment[]
    readonly replaces?: AdmissionId
  }
  | { readonly did: 'send.admitted'; readonly inputId: InputId; readonly admissionId: string }
  | { readonly did: 'send.failed'; readonly inputId: InputId; readonly message: string }
  | { readonly did: 'send.discarded'; readonly inputId: InputId }
  | { readonly did: 'stop' }
  | { readonly did: 'steered'; readonly text: string; readonly during: Generation }
  /** A denial's words went to Hermes, which has them (`turn`) or may have them (`unsure`). */
  | { readonly did: 'told'; readonly promptId: PromptId; readonly text: string; readonly went: Exclude<Told, 'next'> }
  | { readonly did: 'answer'; readonly promptId: PromptId; readonly reply: PromptReply }
  | { readonly did: 'answer'; readonly requestId: RequestId; readonly reply: RecordedReply }
  | { readonly did: 'answer.resolved'; readonly promptId: PromptId; readonly byUs: boolean }
  | { readonly did: 'answer.accepted'; readonly requestId: RequestId; readonly then: 'waits' | 'settles' }
  | { readonly did: 'answer.failed'; readonly promptId: PromptId; readonly message: string }
  | { readonly did: 'answer.failed'; readonly requestId: RequestId; readonly message: string }
  | { readonly did: 'earlier.requested' }
  /** Hermes cut the chat before this stored row. The turn that row opens and every later turn are gone. */
  | { readonly did: 'rewound'; readonly rowId: number }
  | { readonly did: 'model.deferred'; readonly model: ModelRef; readonly during: Generation }
  | { readonly did: 'side.started'; readonly id: SideId; readonly kind: SideTask['kind']; readonly asked: string }
  /** Hermes confirmed a switch this client set. */
  | { readonly did: 'tuned'; readonly tuning: Partial<Tuning> }

/** Bookkeeping the views never need. Kept beside the content so one reducer guards both. */
export interface Fence {
  /** Compare-and-swap value for `session.mutate`. Never moves backwards. */
  readonly revision: number
  readonly text: TextCursor | null
  /** Where `loadEarlier` continues. null when the gateway holds nothing older. */
  readonly older: HistoryPage['older']
  readonly admissions: { readonly [admissionId: string]: Pick<Admission, 'text' | 'inputId'> }
  readonly sent: { readonly [admissionId: string]: InputId }
  /** Highest stored row id among the turns held as settled. See the `lost` rule in the seed below. */
  readonly settledThrough: number | null
  readonly generation: Generation | null
  /** Attach attempts begun so far. The next attempt is this plus one. */
  readonly attaches: number
  /**
   * Times the totals held in `content.usage` stopped being the gateway's: a turn settled, the content
   * was replaced from a snapshot, or a model switch committed. A usage read answers for the moment it
   * was sent, so one sent at an older epoch must not set the totals or the fill.
   */
  readonly totalsEpoch: number
  readonly closed: Held['closed']
  /**
   * The words of a denial that Hermes has or may have, by the prompt they answer. A denial that is
   * tried again, because its own confirmation was lost, must not hand them over twice, and a steer
   * carries no id Hermes could know a repeat by. Emptied when the turn ends.
   */
  readonly told: { readonly [promptId: string]: { readonly [text: string]: Exclude<Told, 'next'> } }
}

export interface Tracked {
  readonly content: SessionContent
  readonly gate: Gate
  readonly fence: Fence
}

export function emptyTracked(id: SessionId): Tracked {
  return {
    content: { id, title: '', cwd: null, history: [], earlier: 'none', run: IDLE, interlude: [], requests: [], queue: [], outbox: [], model: NO_MODEL, usage: NO_USAGE, tuning: UNTUNED, sides: [] },
    gate: { at: 'detached', why: 'new', cursor: null },
    fence: { revision: 0, text: null, older: null, admissions: {}, sent: {}, settledThrough: null, generation: null, attaches: 0, totalsEpoch: 0, closed: [], told: {} }
  }
}

/** More frames than this parked during one attach is treated as a gap. */
export const PARK_LIMIT = 2048

/**
 * Invariants:
 * - Returns the same `content` reference when nothing visible changed, and keeps the identity of
 *   every turn and item it did not touch. IPC patches and React memoisation rely on this.
 * - Idempotent per id: a tool is upserted by `ToolId`, a prompt by `PromptId`, a helper by `HelperId`,
 *   an outbox entry by `InputId`, a request and a declined notice by `requestId`, the plan by its
 *   revision. Applying the same input twice changes nothing the second time. `attach` on a session
 *   that is attaching or live changes nothing.
 * - A reply of an older attach attempt changes nothing.
 * - Nothing opens a turn to hold a line Hermes said. A line goes into the running turn, or into the
 *   interlude while none runs.
 */
export function reduce(state: Tracked, input: SessionInput): Tracked {
  const { gate } = state
  switch (input.in) {
    case 'attach': {
      if (gate.at !== 'detached') return state
      if (gate.cursor !== null) return beginAttach(state, { mode: 'replay', from: gate.cursor }, [], [])
      return beginAttach(state, state.fence.generation === null ? { mode: 'open' } : REBUILD, [], [])
    }
    case 'attached':
      return gate.at === 'attaching' && gate.attempt === input.attempt ? attached(state, gate, input.snapshot, input.replay) : state
    case 'attach.failed': {
      if (gate.at !== 'attaching' || gate.attempt !== input.attempt) return state
      const why = input.refused === null ? 'link-lost' : { refused: input.refused }
      return { ...state, gate: { at: 'detached', why, cursor: resumePoint(gate) } }
    }
    case 'link.lost':
      if (gate.at === 'detached' && gate.why === 'link-lost') return state
      return { ...state, gate: { at: 'detached', why: 'link-lost', cursor: resumePoint(gate) } }
    case 'event':
      return admit(state, input.frame)
    case 'gap':
      return gap(state)
    case 'earlier':
      return earlier(state, input.page)
    case 'usage': {
      const { run, usage } = state.content
      if (input.asked !== state.fence.totalsEpoch) return state
      return setUsage(state, {
        totals: run.state === 'idle' ? input.usage.totals ?? usage.totals : usage.totals,
        context: input.usage.context ?? usage.context
      })
    }
    case 'request': {
      if (gate.at === 'detached') return state
      if (gate.at === 'live') return withRequests(state, opened(heldOf(state), input.request, input.seenAt))
      return gate.asked.some(parked => parked.requestId === input.request.requestId) ? state : { ...state, gate: { ...gate, asked: [...gate.asked, input.request] } }
    }
    case 'declined': {
      const { requestId, method } = input.request
      return holdsDeclined(state.content, requestId) ? state : say(state, { kind: 'notice', what: 'declined', requestId, method })
    }
    case 'facts':
      return input.attempt === state.fence.attaches ? tune(state, input.tuning) : state
    case 'local':
      return act(state, input.action)
    default:
      return unreachable(input)
  }
}

type Attaching = Extract<Gate, { at: 'attaching' }>
const REBUILD: Attaching['plan'] = { mode: 'rebuild' }

function beginAttach(state: Tracked, plan: Attaching['plan'], parked: readonly StampedEvent[], asked: readonly CardRequest[]): Tracked {
  const attempt = state.fence.attaches + 1
  return { ...state, gate: { at: 'attaching', attempt, plan, parked, asked }, fence: { ...state.fence, attaches: attempt } }
}

const heldOf = (state: Tracked): Held => ({ requests: state.content.requests, closed: state.fence.closed })

function withRequests(state: Tracked, next: Held | Change): Tracked {
  const kept: Tracked = {
    ...state,
    content: patch(state.content, { requests: next.requests }),
    fence: patch(state.fence, { closed: next.closed })
  }
  const settled = kept.content === state.content && kept.fence === state.fence ? state : kept
  return 'notices' in next ? next.notices.reduce((said, notice) => say(said, notice), settled) : settled
}

function resumePoint(gate: Gate): Cursor | null {
  switch (gate.at) {
    case 'detached':
    case 'live':
      return gate.cursor
    case 'attaching':
      return gate.plan.mode === 'replay' ? gate.plan.from : null
    default:
      return unreachable(gate)
  }
}

function gap(state: Tracked): Tracked {
  const { gate } = state
  if (gate.at !== 'detached') return beginAttach(state, REBUILD, [], gate.at === 'attaching' ? gate.asked : [])
  return gate.cursor === null ? state : { ...state, gate: { ...gate, cursor: null } }
}

function admit(state: Tracked, frame: StampedEvent): Tracked {
  const { gate, fence } = state
  switch (gate.at) {
    case 'detached':
      return state
    case 'attaching':
      return gate.parked.length >= PARK_LIMIT ? gap(state) : { ...state, gate: { ...gate, parked: [...gate.parked, frame] } }
    case 'live': {
      const { epoch, seq, generation } = frame.stamp
      if (epoch !== gate.cursor.epoch) return gap(state)
      if (seq <= gate.cursor.seq) return state
      const moved: Tracked = {
        ...state,
        gate: { ...gate, cursor: { epoch, seq } },
        fence: patch(fence, { generation: newest(fence.generation, generation) })
      }
      const { run } = state.content
      // A helper is addressed by its id, never by the run: its frames go on after its turn ends.
      const stale = run.state === 'running' && generation !== null && generation < run.generation && frame.event?.type !== 'helper'
      return frame.event === null || stale ? moved : fold(moved, frame, frame.event)
    }
    default:
      return unreachable(gate)
  }
}

function attached(state: Tracked, gate: Attaching, snapshot: Snapshot, replay: Replay | null): Tracked {
  const { plan, parked, asked } = gate
  const { watermark } = snapshot
  const liveAt = (cursor: Cursor): Tracked => ({ ...state, gate: { at: 'live', cursor, subscriptionId: snapshot.subscriptionId } })
  const upToWatermark = (frame: StampedEvent) => frame.stamp.seq <= watermark.seq
  const listed = snapshot.openRequests.filter(request => request.kind === 'card')
  const cancelled = new Map(parked.flatMap(({ event }): [RequestId, CloseWhy][] => {
    if (event?.type === 'request.cancelled') return [[event.id, event.why]]
    if (event?.type === 'connect' && event.settled !== null) return [[event.card.requestId, event.settled]]
    return []
  }))
  const asking = (attachedState: Tracked) => withRequests(attachedState, reconciled(heldOf(attachedState), listed, asked, cancelled))

  if (plan.mode === 'replay' && replay !== null && !replay.snapshotRequired && replay.epoch === watermark.epoch && replay.epoch === plan.from.epoch) {
    // The gateway's catch-up frames sit among the parked ones (gateway/session_events.py:114-124). They
    // go in before the snapshot is compared, so a turn that ended in that window keeps its real outcome.
    const catchUp = parked.filter(upToWatermark).map((frame): StampedEvent => ({ ...frame, seenAt: null }))
    const caughtUp = [...replay.events, ...catchUp].reduce(admit, liveAt(plan.from))
    if (caughtUp.gate.at !== 'live' || caughtUp.gate.cursor.seq !== watermark.seq) return beginAttach(state, REBUILD, parked, asked)
    return parked.filter(frame => !upToWatermark(frame)).reduce(admit, asking(reconcile(caughtUp, snapshot)))
  }
  if (snapshot.history !== null) {
    return parked.filter(frame => frame.stamp.epoch === watermark.epoch).reduce(admit, asking(seed(liveAt(watermark), snapshot, snapshot.history)))
  }
  return beginAttach(state, REBUILD, parked, asked)
}

function seed(state: Tracked, snapshot: Snapshot, page: HistoryPage): Tracked {
  const { content, fence } = state
  const before = content.run
  const sameRun = before.state === 'running' && snapshot.running && snapshot.generation === before.generation
  const leftOpen = snapshot.running ? null : page.unfinished
  const missed = before.state === 'running' && !sameRun && !(fence.settledThrough === null && leftOpen !== null)
  const stored = missed ? markLost(page.turns, fence.settledThrough) : page.turns
  const history = leftOpen === null ? stored : [...stored, {
    id: `unfinished:${snapshot.watermark.epoch}:${snapshot.watermark.seq}` as TurnId,
    request: requestOf(leftOpen.request),
    began: leftOpen.began,
    items: leftOpen.items,
    outcome: LOST,
    rows: [],
    tokens: null
  }]
  const run: Run = !snapshot.running ? IDLE : {
    state: 'running',
    generation: snapshot.generation,
    stop: sameRun ? before.stop : 'none',
    turn: {
      id: runTurnId(snapshot.generation),
      request: requestOf(page.unfinished?.request ?? null) ?? startedRequest(state, snapshot.queue),
      began: page.unfinished?.began ?? (before.state === 'running' && sameRun ? before.turn.began : null),
      items: [...(page.unfinished?.items ?? []), ...snapshot.prompts.map(prompt => waitingPrompt(prompt, null))],
      announced: null
    }
  }
  const seeded: Tracked = {
    ...state,
    content: {
      id: content.id,
      title: snapshot.title,
      cwd: snapshot.cwd,
      history,
      earlier: page.older === null ? 'none' : 'more',
      run,
      interlude: [],
      requests: content.requests,
      queue: content.queue,
      outbox: content.outbox,
      // Hermes asks a newly attached viewer again about a held pick (gateway/session_deferred_pick.py:46-54).
      model: { ...modelFrom(content.model, snapshot.model), next: null, ask: null },
      usage: patch(content.usage, { totals: null }),
      tuning: patch(content.tuning, snapshot.tuning),
      sides: content.sides.some(side => side.state.s === 'running') ? content.sides.map(side => (side.state.s === 'running' ? { ...side, state: LOST_SIDE } : side)) : content.sides
    },
    fence: {
      revision: Math.max(fence.revision, snapshot.revision),
      text: null,
      older: page.older,
      admissions: {},
      sent: fence.sent,
      settledThrough: history.reduce<number | null>((through, turn) => highestRow(through, turn.rows), null),
      generation: newest(fence.generation, snapshot.generation),
      attaches: fence.attaches,
      totalsEpoch: fence.totalsEpoch + 1,
      closed: fence.closed,
      told: fence.told
    }
  }
  return listed(seeded, snapshot.queue)
}

function markLost(turns: readonly SettledTurn[], settledThrough: number | null): readonly SettledTurn[] {
  const lost = (turn: SettledTurn): SettledTurn => turn.outcome.kind === 'lost' ? turn : { ...turn, outcome: LOST }
  if (settledThrough === null) return turns.map((turn, index) => index === turns.length - 1 ? lost(turn) : turn)
  return turns.map(turn => turn.rows.some(row => row > settledThrough) ? lost(turn) : turn)
}

function reconcile(state: Tracked, snapshot: Snapshot): Tracked {
  let next: Tracked = {
    ...state,
    content: patch(state.content, { title: snapshot.title, cwd: snapshot.cwd, model: modelFrom(state.content.model, snapshot.model), tuning: patch(state.content.tuning, snapshot.tuning) }),
    fence: patch(state.fence, {
      revision: Math.max(state.fence.revision, snapshot.revision),
      generation: newest(state.fence.generation, snapshot.generation)
    })
  }
  const { run } = next.content
  if (run.state === 'running' && !(snapshot.running && snapshot.generation === run.generation)) next = settle(next, LOST, null, [], null, null)
  if (snapshot.running && next.content.run.state === 'idle') {
    next = openRun(next, snapshot.generation, runTurnId(snapshot.generation), startedRequest(next, snapshot.queue), null)
  }
  next = editTurn(next, turn => {
    const answered = mapItems(turn, item =>
      isPending(item) && !snapshot.prompts.some(prompt => prompt.id === item.id) ? { ...item, state: answeredFrom(item) } : item)
    return snapshot.prompts
      .filter(prompt => !answered.items.some(item => item.kind === 'prompt' && item.id === prompt.id))
      .reduce((open, prompt) => pushItem(open, waitingPrompt(prompt, null)), answered)
  })
  return listed(next, snapshot.queue)
}

function startedRequest(state: Tracked, rows: readonly Admission[]): Request | null {
  const started = rows.find(row => row.state.s === 'started')
  return started === undefined ? null : { text: started.text, inputId: started.inputId, rowId: null, attachments: carried(state, started) }
}

/** A row of one of Hermes's lists, by the ids that can tie it to this client's outbox. */
type Listed = { readonly admissionId: string; readonly inputId: InputId }

/** This client's message as its outbox holds it, while Hermes has not listed it yet. */
function sentEntry(state: Tracked, row: Listed): OutboxEntry | undefined {
  const { content, fence } = state
  return content.outbox.find(entry => entry.inputId === row.inputId || entry.inputId === fence.sent[row.admissionId])
}

/**
 * The attachments a row's turn starts with. Only their holder has them: the queue row Hermes listed,
 * else this client's outbox entry for it. Hermes's own rows name none.
 */
function carried(state: Tracked, row: Listed): readonly Attachment[] {
  return (state.content.queue.find(held => held.admissionId === row.admissionId) ?? sentEntry(state, row))?.attachments ?? []
}

function listed(state: Tracked, rows: readonly Admission[]): Tracked {
  const { content, fence } = state
  const named = new Set(rows.map(row => sentEntry(state, row)))
  const outbox = content.outbox.some(entry => named.has(entry)) ? content.outbox.filter(entry => !named.has(entry)) : content.outbox
  const admissions = Object.fromEntries(rows.map(({ admissionId, text, inputId }) => [admissionId, { text, inputId }]))
  const sent = Object.fromEntries(Object.entries(fence.sent).filter(([, inputId]) => outbox.some(entry => entry.inputId === inputId)))
  const started = startedRequest(state, rows)
  const next: Tracked = {
    ...state,
    content: patch(content, { queue: queueOf(content.queue, row => sentEntry(state, row), rows), outbox }),
    fence: { ...fence, admissions, sent }
  }
  if (started === null) return next
  return editTurn(next, turn => (turn.request === null || turn.request.inputId === null
    ? { ...turn, request: { ...started, text: turn.request?.text ?? started.text, rowId: turn.request?.rowId ?? null } }
    : turn))
}

function handedOver(state: Tracked, before: readonly QueuedMessage[]): Tracked {
  const wasSteering = new Set(before.flatMap(row => (row.state.s === 'steering' ? [row.admissionId] : [])))
  return state.content.queue
    .filter(row => row.state.s === 'steering' && !wasSteering.has(row.admissionId))
    .reduce((handed, row) => editTurn(handed, turn => pushItem(turn, { kind: 'steer', text: row.text })), state)
}

function dropEntry(state: Tracked, inputId: InputId | null): Tracked {
  const { content, fence } = state
  if (!content.outbox.some(entry => entry.inputId === inputId)) return state
  const sent = Object.fromEntries(Object.entries(fence.sent).filter(([, held]) => held !== inputId))
  return { ...state, content: { ...content, outbox: content.outbox.filter(entry => entry.inputId !== inputId) }, fence: { ...fence, sent } }
}

function setEntry(state: Tracked, entry: OutboxEntry): Tracked {
  const outbox = state.content.outbox.map(held => held.inputId === entry.inputId ? entry : held)
  return { ...state, content: { ...state.content, outbox } }
}

function earlier(state: Tracked, page: HistoryPage): Tracked {
  const { content, fence } = state
  const held = (turn: SettledTurn) =>
    content.history.some(known => known.id === turn.id || known.rows.some(row => turn.rows.includes(row)))
  const fresh = page.turns.filter(turn => !held(turn))
  return {
    ...state,
    content: patch(content, {
      history: fresh.length === 0 ? content.history : [...fresh, ...content.history],
      earlier: page.older === null ? 'none' : 'more'
    }),
    fence: patch(fence, { older: page.older })
  }
}

function act(state: Tracked, action: LocalAction): Tracked {
  const { content } = state
  switch (action.did) {
    case 'send': {
      const entry = content.outbox.find(held => held.inputId === action.inputId)
      const sending: OutboxEntry = {
        inputId: action.inputId, text: action.text, ...(action.apiText === undefined ? {} : { apiText: action.apiText }), attachments: action.attachments,
        ...(action.replaces === undefined ? {} : { replaces: action.replaces }), state: { s: 'sending' }
      }
      if (entry === undefined) return { ...state, content: { ...content, outbox: [...content.outbox, sending] } }
      return entry.state.s === 'failed' ? setEntry(state, sending) : state
    }
    case 'send.admitted': {
      if (!content.outbox.some(held => held.inputId === action.inputId)) return state
      return { ...state, fence: { ...state.fence, sent: { ...state.fence.sent, [action.admissionId]: action.inputId } } }
    }
    case 'send.failed': {
      const entry = content.outbox.find(held => held.inputId === action.inputId)
      if (entry === undefined || (entry.state.s === 'failed' && entry.state.message === action.message)) return state
      return setEntry(state, { ...entry, state: { s: 'failed', message: action.message } })
    }
    case 'send.discarded':
      return dropEntry(state, action.inputId)
    case 'stop':
      return content.run.state === 'running' && content.run.stop === 'none'
        ? { ...state, content: { ...content, run: { ...content.run, stop: 'requested' } } }
        : state
    case 'steered': {
      const { run } = content
      return run.state === 'running' && run.generation === action.during ? editTurn(state, turn => pushItem(turn, { kind: 'steer', text: action.text })) : state
    }
    case 'told': {
      const { promptId, text, went } = action
      const held = state.fence.told[promptId] ?? {}
      if (Object.hasOwn(held, text) && held[text] === went) return state
      return { ...state, fence: { ...state.fence, told: { ...state.fence.told, [promptId]: { ...held, [text]: went } } } }
    }
    case 'answer': {
      if ('requestId' in action) return withRequests(state, answering(heldOf(state), action.requestId, action.reply))
      const { promptId, reply } = action
      return editPrompt(state, promptId, prompt => (prompt.state.s === 'waiting' ? { ...prompt, state: { s: 'sending', reply } } : prompt))
    }
    case 'answer.accepted':
      return withRequests(state, accepted(heldOf(state), action.requestId, action.then))
    case 'answer.resolved':
      return editPrompt(state, action.promptId, prompt => {
        if (!isClosed(prompt)) return { ...prompt, state: action.byUs ? answeredFrom(prompt) : ANSWERED_ELSEWHERE }
        // The gateway's settle event can arrive before this receipt and assume the reply was ours.
        return prompt.state.s === 'answered' && prompt.state.reply !== null && !action.byUs ? { ...prompt, state: ANSWERED_ELSEWHERE } : prompt
      })
    case 'answer.failed': {
      if ('requestId' in action) return withRequests(state, failed(heldOf(state), action.requestId, action.message))
      const { promptId, message } = action
      return editPrompt(state, promptId, prompt => (prompt.state.s === 'sending' ? { ...prompt, state: { s: 'waiting', error: message } } : prompt))
    }
    case 'rewound':
      return cutBefore(state, action.rowId)
    case 'earlier.requested':
      return content.earlier === 'more' ? { ...state, content: { ...content, earlier: 'loading' } } : state
    case 'model.deferred': {
      const { next } = content.model
      const { run } = content
      if (run.state !== 'running' || run.generation !== action.during) return state
      if (next !== null && next.during === action.during && sameRef(next.model, action.model) && content.model.ask === null) return state
      // A newer held pick replaces the one Hermes was asking about (persistence/sqlite/authority/_runtime_picks.py:239-248).
      return { ...state, content: { ...content, model: { ...content.model, next: { model: action.model, during: action.during }, ask: null } } }
    }
    case 'tuned':
      return tune(state, action.tuning)
    case 'side.started':
      // The answer can come before the reply that names its task.
      return content.sides.some(side => side.id === action.id)
        ? state
        : { ...state, content: { ...content, sides: [...content.sides, { id: action.id, kind: action.kind, asked: action.asked, state: RUNNING_SIDE }] } }
    default:
      return unreachable(action)
  }
}

const IDLE: Run = { state: 'idle' }
const NO_MODEL: SessionModel = { current: null, next: null, ask: null }
const NO_USAGE: SessionUsage = { totals: null, context: null }
const ZERO_TOKENS: Tokens = { input: 0, output: 0, reasoning: 0 }
const UNTUNED: Tuning = { reasoning: null, busy: null, effort: null, fast: null, yolo: null }
const LOST: Outcome = { kind: 'lost' }
const RUNNING_SIDE: SideTask['state'] = { s: 'running' }
const LOST_SIDE: SideTask['state'] = { s: 'lost' }
const INTERLUDE: Outcome = { kind: 'interlude' }
const ANSWERED_ELSEWHERE: PromptItem['state'] = { s: 'answered', reply: null }

/**
 * Events that close the reasoning block the agent was streaming, because the agent has moved on. A
 * helper's frames and the spinner are not among them: they arrive while the agent still reasons.
 */
const ENDS_REASONING: ReadonlySet<SessionEvent['type']> = new Set([
  'text.delta', 'text.sealed', 'tool.announced', 'tool.started', 'tool.finished', 'prompt.opened', 'notice', 'plan'
] satisfies SessionEvent['type'][])

function fold(before: Tracked, { stamp, seenAt }: Pick<StampedEvent, 'stamp' | 'seenAt'>, event: SessionEvent): Tracked {
  const state = ENDS_REASONING.has(event.type) ? editTurn(before, turn => sealReasoning(turn, seenAt)) : before
  switch (event.type) {
    case 'turn.started': {
      const { run } = state.content
      if (stamp.generation === null || (event.turnId !== null && holdsTurn(state.content, event.turnId))) return state
      if (run.state === 'running' && stamp.generation <= run.generation) return state
      const settled = settle(state, LOST, null, [], null, null)
      const request = requestFor(settled, event.admissionId, event.requestText)
      const opened = openRun(dropEntry(settled, request?.inputId ?? null), stamp.generation, event.turnId ?? runTurnId(stamp.generation), request, seenBy(seenAt))
      // Hermes says the turn started before it lists the row as started (gateway/session_authority.py:1237-1240), and the row is no longer waiting.
      const { queue } = opened.content
      const waiting = queue.filter(row => row.admissionId !== event.admissionId)
      return waiting.length === queue.length ? opened : { ...opened, content: { ...opened.content, queue: waiting } }
    }
    case 'text.delta': {
      const open = ensureRun(state, stamp.generation, seenAt)
      const seen = open.fence.text
      if (event.at !== null && seen !== null && !isAfter(event.at, seen)) return open
      const fenced: Tracked = event.at === null ? open : { ...open, fence: { ...open.fence, text: event.at } }
      return event.text === '' ? fenced : editTurn(fenced, turn => appendText(turn, event.text))
    }
    case 'text.sealed':
      return editTurn(state, turn => {
        const last = turn.items.at(-1)
        if (last?.kind === 'text' && !last.sealed) {
          return { ...turn, items: turn.items.with(-1, { kind: 'text', markdown: event.text ?? last.markdown, sealed: true }) }
        }
        const latest = turn.items.findLast(item => item.kind === 'text')
        if (event.text === null || event.text === '' || latest?.markdown === event.text) return turn
        return pushItem(turn, { kind: 'text', markdown: event.text, sealed: true })
      })
    case 'thinking':
      return ensureRun(state, stamp.generation, seenAt)
    case 'reasoning': {
      const open = ensureRun(state, stamp.generation, seenAt)
      return event.text === '' ? open : editTurn(open, turn => event.whole ? wholeReasoning(turn, event.text, seenAt) : appendReasoning(turn, event.text, seenAt))
    }
    case 'plan':
      return editTurn(ensureRun(state, stamp.generation, seenAt), turn => {
        const at = turn.items.findIndex(item => item.kind === 'plan')
        const plan: Item = { kind: 'plan', revision: event.revision, entries: event.entries }
        if (at === -1) return pushItem(turn, plan)
        const held = turn.items[at]
        return held?.kind === 'plan' && event.revision > held.revision ? { ...turn, items: turn.items.with(at, plan) } : turn
      })
    case 'helper':
      return helperFrame(state, stamp.generation, event)
    case 'moa':
      return editTurn(ensureRun(state, stamp.generation, seenAt), turn => moaStep(turn, event.step))
    case 'tool.announced':
      return editTurn(ensureRun(state, stamp.generation, seenAt), turn => patch(turn, { announced: event.name }))
    case 'tool.started':
      return editTurn(ensureRun(state, stamp.generation, seenAt), turn =>
        turn.items.some(item => item.kind === 'tool' && item.id === event.id)
          ? turn
          : pushItem(turn, { kind: 'tool', id: event.id, name: event.name, args: event.args, status: { s: 'running', note: null } }))
    case 'tool.progress':
      return editTurn(state, turn => mapItems(turn, item =>
        item.kind === 'tool' && item.id === event.id && item.status.s === 'running' && item.status.note !== event.note
          ? { ...item, status: { s: 'running', note: event.note } }
          : item))
    case 'tool.finished': {
      const status: ToolItem['status'] = { s: 'done', durationS: event.durationS, diffs: event.diffs, result: event.result, image: event.image }
      return editTurn(ensureRun(state, stamp.generation, seenAt), turn => {
        if (!turn.items.some(item => item.kind === 'tool' && item.id === event.id)) {
          return pushItem(turn, { kind: 'tool', id: event.id, name: event.name, args: event.args ?? {}, status })
        }
        return mapItems(turn, item =>
          item.kind === 'tool' && item.id === event.id && item.status.s !== 'done'
            ? { ...item, name: event.name, args: event.args ?? item.args, status }
            : item)
      })
    }
    case 'prompt.opened': {
      const deadline = seenAt === null || event.timeoutS === null ? null : seenAt + event.timeoutS * 1000
      return editTurn(ensureRun(state, event.generation, seenAt), turn =>
        turn.items.some(item => item.kind === 'prompt' && item.id === event.id) ? turn : pushItem(turn, waitingPrompt(event, deadline)))
    }
    case 'prompt.settled':
      return editPrompt(state, event.id, prompt => isClosed(prompt) ? prompt : { ...prompt, state: answeredFrom(prompt) })
    case 'prompts.cancelled':
      return editTurn(state, turn => mapItems(turn, item =>
        isPending(item) && event.ids.includes(item.id) ? { ...item, state: { s: 'withdrawn' } } : item))
    case 'turn.ended':
      // A queued message that is cancelled completes with no generation on its stamp
      // (gateway/session_authority.py:886). That is not the end of the turn running ahead of it.
      return stamp.generation === null ? state : settle(state, event.outcome, event.finalText, event.rows, event.userRow, event.usage)
    case 'usage':
      return event.context === null ? state : setUsage(state, { ...state.content.usage, context: event.context })
    case 'notice':
      return say(state, { kind: 'notice', what: 'said', tone: event.tone, text: event.text })
    case 'status': {
      const line: StatusItem = { kind: 'status', what: 'line', about: event.about, text: event.text }
      const compaction = event.about === 'compacting' || event.about === 'compacted'
      return say(state, line, item => compaction && item.kind === 'status' && item.what === 'line' && item.about === 'compacting')
    }
    case 'notice.shown': {
      const cleared = clearNotice(state, event.notice.key)
      if (event.notice.ttlMs !== null && seenAt === null) return cleared
      return say(cleared, { kind: 'status', what: 'notice', ...event.notice, seenAt, state: 'shown' })
    }
    case 'notice.cleared':
      return clearNotice(state, event.key)
    case 'request.cancelled':
      return withRequests(state, closed(heldOf(state), event.id, event.why))
    case 'side.answered': {
      const { sides } = state.content
      const done: SideTask['state'] = { s: 'done', text: event.text }
      const at = sides.findIndex(side => side.id === event.id)
      if (at === -1) return { ...state, content: { ...state.content, sides: [...sides, { id: event.id, kind: event.kind, asked: event.asked, state: done }] } }
      return sides[at]?.state.s === 'done' ? state : { ...state, content: { ...state.content, sides: sides.with(at, { ...sides[at]!, state: done }) } }
    }
    case 'connect':
      return withRequests(state, event.settled === null
        ? opened(heldOf(state), event.card, seenAt)
        : closed(heldOf(state), event.card.requestId, event.settled))
    case 'meta': {
      const named: Tracked = event.model === undefined ? state : { ...state, content: patch(state.content, { model: modelFrom(state.content.model, event.model) }) }
      const moved: Tracked = event.cwd === undefined ? named : { ...named, content: patch(named.content, { cwd: event.cwd }) }
      const lit: Tracked = event.tuning === undefined ? moved : tune(moved, event.tuning)
      const picked: Tracked = event.pick === undefined ? lit : afterPick(lit, event.pick)
      const fenced: Tracked = event.generation === undefined ? picked : { ...picked, fence: patch(picked.fence, { generation: newest(picked.fence.generation, event.generation) }) }
      const titled: Tracked = event.title === undefined ? fenced : { ...fenced, content: patch(fenced.content, { title: event.title }) }
      const revised: Tracked = event.revision === undefined
        ? titled
        : { ...titled, fence: patch(titled.fence, { revision: Math.max(titled.fence.revision, event.revision) }) }
      const cut: Tracked = event.cutBefore === undefined ? revised : cutBefore(revised, event.cutBefore)
      const counted: Tracked = event.countsRestart === undefined ? cut : restartCounts(cut)
      const queued: Tracked = event.queue === undefined ? counted : handedOver(listed(counted, event.queue), counted.content.queue)
      return event.rewritten === undefined ? queued : gap(queued)
    }
    default:
      return unreachable(event)
  }
}

function cutBefore(state: Tracked, rowId: number): Tracked {
  const { content } = state
  const at = content.history.findIndex(turn => turn.request?.rowId === rowId)
  return at < 0 ? state : { ...state, content: { ...content, history: content.history.slice(0, at) } }
}

function openRun(state: Tracked, generation: Generation, id: TurnId, request: Request | null, began: Began | null): Tracked {
  const run: Run = { state: 'running', generation, stop: 'none', turn: { id, request, began, items: [], announced: null } }
  const { history, interlude } = state.content
  const sealed: SettledTurn = { id: `interlude:${generation}` as TurnId, request: null, began: null, items: interlude, outcome: INTERLUDE, rows: [], tokens: null }
  return {
    ...state,
    content: { ...state.content, run, history: interlude.length === 0 ? history : [...history, sealed], interlude: interlude.length === 0 ? interlude : [] },
    fence: patch(state.fence, { text: null })
  }
}

function say(state: Tracked, line: Item<'settled'>, replaces: (item: Item) => boolean = () => false): Tracked {
  const { content } = state
  if (content.run.state === 'running') {
    return editTurn(state, turn => {
      const at = turn.items.findLastIndex(replaces)
      if (at !== -1) return { ...turn, items: turn.items.with(at, line) }
      // A line said beside the reply goes above the text still streaming, as Hermes's own TUI
      // draws it. Sealing that text instead would leave a later interim to replace only its tail.
      const last = turn.items.at(-1)
      return last?.kind === 'text' && !last.sealed ? { ...turn, items: turn.items.toSpliced(-1, 0, line) } : pushItem(turn, line)
    })
  }
  const at = content.interlude.findLastIndex(replaces)
  return { ...state, content: { ...content, interlude: at === -1 ? [...content.interlude, line] : content.interlude.with(at, line) } }
}

function clearNotice(state: Tracked, key: string): Tracked {
  const clear = <I extends Item>(item: I): I =>
    item.kind === 'status' && item.what === 'notice' && item.key === key && item.state === 'shown' ? { ...item, state: 'cleared' } : item
  const cleared = <I extends Item>(items: readonly I[]): readonly I[] => {
    const next = items.map(clear)
    return next.every((item, index) => item === items[index]) ? items : next
  }
  const { content } = state
  const history = content.history.map(turn => patch(turn, { items: cleared(turn.items) }))
  const edited: Tracked = {
    ...state,
    content: patch(content, {
      history: history.every((turn, index) => turn === content.history[index]) ? content.history : history,
      interlude: cleared(content.interlude)
    })
  }
  return editTurn(edited, turn => patch(turn, { items: cleared(turn.items) }))
}

function moaStep(turn: OpenTurn, step: MoaStep): OpenTurn {
  const at = turn.items.findLastIndex(item => item.kind === 'moa')
  const held = turn.items[at]
  const round = held?.kind === 'moa' && (held.phase.is === 'advising' || step.is === 'aggregating') ? held : null
  const base: MoaItem = round ?? { kind: 'moa', progress: null, references: [], phase: { is: 'advising' } }
  const next = ((): MoaItem => {
    switch (step.is) {
      case 'progress':
        return base.progress?.done === step.done && base.progress.total === step.total ? base : { ...base, progress: { done: step.done, total: step.total } }
      case 'reference':
        return { ...base, references: [...base.references, { label: step.label, text: step.text }] }
      case 'aggregating':
        return base.phase.is === 'aggregating' && (step.by === null || base.phase.by === step.by) ? base : { ...base, phase: { is: 'aggregating', by: step.by } }
      default:
        return unreachable(step)
    }
  })()
  if (round === null) return pushItem(turn, next)
  return next === round ? turn : { ...turn, items: turn.items.with(at, next) }
}

function tune(state: Tracked, tuning: Partial<Tuning>): Tracked {
  const next = patch(state.content.tuning, tuning)
  return next === state.content.tuning ? state : { ...state, content: { ...state.content, tuning: next } }
}

function ensureRun(state: Tracked, generation: Generation | null, seenAt: number | null): Tracked {
  return state.content.run.state === 'running' || generation === null ? state : openRun(state, generation, runTurnId(generation), null, seenBy(seenAt))
}

function seenBy(seenAt: number | null): Began | null {
  return seenAt === null ? null : { at: seenAt, clock: 'client' }
}

function runTurnId(generation: Generation): TurnId {
  return `run:${generation}` as TurnId
}

function requestOf(text: string | null): Request | null {
  return text === null ? null : { text, inputId: null, rowId: null, attachments: [] }
}

function holdsTurn(content: SessionContent, id: TurnId): boolean {
  return (content.run.state === 'running' && content.run.turn.id === id) || content.history.some(turn => turn.id === id)
}

function holdsDeclined(content: SessionContent, requestId: string): boolean {
  const isIt = (item: Item) => item.kind === 'notice' && item.what === 'declined' && item.requestId === requestId
  return (content.run.state === 'running' && content.run.turn.items.some(isIt))
    || content.interlude.some(isIt)
    || content.history.some(turn => turn.items.some(isIt))
}

function requestFor(state: Tracked, admissionId: string | null, requestText: string | null): Request | null {
  const { admissions, sent } = state.fence
  const { outbox } = state.content
  const row = admissionId === null ? undefined : admissions[admissionId]
  // Hermes's own words for the request, when the start carries them, are what a person reads. The row's text is what the model reads.
  if (admissionId !== null && row !== undefined) {
    return { ...row, text: requestText ?? row.text, rowId: null, attachments: carried(state, { admissionId, inputId: row.inputId }) }
  }
  const admitted = outbox.find(entry => admissionId !== null && entry.inputId === sent[admissionId])
  if (admitted !== undefined) return { text: admitted.text, inputId: admitted.inputId, rowId: null, attachments: admitted.attachments }
  const sending = outbox.filter(entry => entry.state.s === 'sending' && !Object.values(sent).includes(entry.inputId))
  const [only] = sending
  return only !== undefined && sending.length === 1 && (requestText === null || requestText === only.text) ? { text: only.text, inputId: only.inputId, rowId: null, attachments: only.attachments } : requestOf(requestText)
}

function settle(
  state: Tracked, outcome: Outcome, finalText: string | null, rows: readonly number[], userRow: number | null, usage: SessionUsage | null
): Tracked {
  const { content, fence } = state
  if (content.run.state !== 'running') return state
  const { id, request, began, items } = content.run.turn
  const before = content.usage
  const totals = usage?.totals ?? null
  const tokens = totals !== null && before.totals !== null ? shareOf(totals, before.totals) : null
  const turn: SettledTurn = {
    id, request: request === null ? null : { ...request, rowId: userRow ?? request.rowId }, began, items: withFinalText(items, finalText).map(settledItem),
    outcome, rows, tokens
  }
  const settled: Tracked = {
    ...state,
    content: { ...content, history: [...content.history, turn], run: IDLE },
    fence: { ...patch(fence, { text: null, settledThrough: highestRow(fence.settledThrough, rows) }), totalsEpoch: fence.totalsEpoch + 1, told: {} }
  }
  return setUsage(settled, { totals, context: usage?.context ?? before.context })
}

/**
 * What one turn added to the session totals. Hermes counts for the life of its agent
 * (tui_gateway/server.py:1270-1279), so a total below the one before means it built a new agent and
 * counts from zero again: the totals are then the turn's own.
 */
export function shareOf(totals: Tokens, before: Tokens): Tokens {
  if (totals.input < before.input || totals.output < before.output || totals.reasoning < before.reasoning) return totals
  return { input: totals.input - before.input, output: totals.output - before.output, reasoning: totals.reasoning - before.reasoning }
}

function setUsage(state: Tracked, said: SessionUsage): Tracked {
  const held = state.content.usage
  const usage = patch(held, { totals: keep(held.totals, said.totals), context: keep(held.context, said.context) })
  return usage === held ? state : { ...state, content: { ...state.content, usage } }
}

function keep<T extends object>(held: T | null, said: T | null): T | null {
  return held === null || said === null ? said : patch(held, said)
}

function withFinalText(items: readonly Item[], finalText: string | null): readonly Item[] {
  if (finalText === null || finalText === '') return items
  const tail = items.findLastIndex(item => item.kind !== 'text' && item.kind !== 'helper') + 1
  const after = items.slice(tail)
  const [only, ...rest] = after.filter(item => item.kind === 'text')
  if (only?.kind === 'text' && rest.length === 0 && only.markdown === finalText) return items
  return [...items.slice(0, tail), ...after.filter(item => item.kind === 'helper'), { kind: 'text', markdown: finalText, sealed: true }]
}

function settledItem(item: Item): Item<'settled'> {
  switch (item.kind) {
    case 'text':
    case 'reasoning':
      return isSealed(item) ? item : { ...item, sealed: true }
    case 'tool':
      return isFinished(item) ? item : { ...item, status: { s: 'cut' } }
    case 'prompt':
      return { ...item, state: isClosed(item) ? item.state : { s: 'withdrawn' }, deadline: null }
    // A helper may still work after its turn ends: Hermes runs helpers in the background.
    case 'helper':
    case 'plan':
    case 'steer':
    case 'moa':
    case 'notice':
    case 'status':
      return item
    default:
      return unreachable(item)
  }
}

const isSealed = <I extends TextItem | ReasoningItem>(item: I): item is I & { readonly sealed: true } => item.sealed
const isFinished = (item: ToolItem): item is ToolItem & { readonly status: ToolItem<'settled'>['status'] } => item.status.s !== 'running'
const isClosed = (item: PromptItem): item is PromptItem & { readonly state: PromptItem<'settled'>['state'] } =>
  item.state.s === 'answered' || item.state.s === 'withdrawn'
const isPending = (item: Item): item is PromptItem => item.kind === 'prompt' && !isClosed(item)

function answeredFrom(prompt: PromptItem): PromptItem['state'] {
  return prompt.state.s === 'sending' ? { s: 'answered', reply: prompt.state.reply } : ANSWERED_ELSEWHERE
}

function waitingPrompt(prompt: { readonly id: PromptId; readonly generation: Generation; readonly ask: Ask }, deadline: number | null): PromptItem {
  return { kind: 'prompt', id: prompt.id, generation: prompt.generation, ask: prompt.ask, state: { s: 'waiting', error: null }, deadline }
}

function editTurn(state: Tracked, edit: (turn: OpenTurn) => OpenTurn): Tracked {
  const { run } = state.content
  if (run.state !== 'running') return state
  const turn = edit(run.turn)
  return turn === run.turn ? state : { ...state, content: { ...state.content, run: { ...run, turn } } }
}

function editPrompt(state: Tracked, id: PromptId, edit: (prompt: PromptItem) => PromptItem): Tracked {
  return editTurn(state, turn => mapItems(turn, item => item.kind === 'prompt' && item.id === id ? edit(item) : item))
}

function mapItems(turn: OpenTurn, change: (item: Item) => Item): OpenTurn {
  const items = turn.items.map(change)
  return items.every((item, index) => item === turn.items[index]) ? turn : { ...turn, items }
}

function pushItem(turn: OpenTurn, item: Item): OpenTurn {
  const last = turn.items.at(-1)
  const above = last?.kind === 'text' && !last.sealed ? turn.items.with(-1, { ...last, sealed: true }) : turn.items
  return { ...turn, announced: null, items: [...above, item] }
}

/** A helper's frames arrive while the agent writes, so a new helper goes above the text that streams and leaves it open. */
function pushHelper(turn: OpenTurn, helper: HelperItem): OpenTurn {
  const last = turn.items.at(-1)
  const at = last?.kind === 'text' && !last.sealed ? turn.items.length - 1 : turn.items.length
  return { ...turn, items: turn.items.toSpliced(at, 0, helper) }
}

function appendText(turn: OpenTurn, text: string): OpenTurn {
  const last = turn.items.at(-1)
  if (last?.kind !== 'text' || last.sealed) return pushItem(turn, { kind: 'text', markdown: text, sealed: false })
  return { ...turn, announced: null, items: turn.items.with(-1, { ...last, markdown: last.markdown + text }) }
}

function sealReasoning(turn: OpenTurn, seenAt: number | null): OpenTurn {
  const at = turn.items.findIndex(item => item.kind === 'reasoning' && !item.sealed)
  const open = turn.items[at]
  return open?.kind === 'reasoning' ? { ...turn, items: turn.items.with(at, { ...open, sealed: true, endedAt: seenAt }) } : turn
}

function appendReasoning(turn: OpenTurn, text: string, seenAt: number | null): OpenTurn {
  const at = turn.items.findIndex(item => item.kind === 'reasoning' && !item.sealed)
  const open = turn.items[at]
  if (open?.kind !== 'reasoning') return pushItem(turn, { kind: 'reasoning', text, sealed: false, startedAt: seenAt, endedAt: null })
  return { ...turn, items: turn.items.with(at, { ...open, text: open.text + text }) }
}

/**
 * Hermes may send a block whole after streaming its deltas, and sends only its first 500 characters
 * (agent/turn_response_intake.py:165). A whole block that starts a block already held is that block.
 */
function wholeReasoning(turn: OpenTurn, text: string, seenAt: number | null): OpenTurn {
  const at = turn.items.findIndex(item => item.kind === 'reasoning' && !item.sealed)
  const open = turn.items[at]
  if (open?.kind === 'reasoning') {
    return { ...turn, items: turn.items.with(at, { ...open, text: open.text.startsWith(text) ? open.text : text, sealed: true, endedAt: seenAt }) }
  }
  if (turn.items.findLast(item => item.kind === 'reasoning')?.text.startsWith(text)) return turn
  return pushItem(turn, { kind: 'reasoning', text, sealed: true, startedAt: null, endedAt: null })
}

type HelperEvent = Extract<SessionEvent, { type: 'helper' }>

const QUEUED: HelperItem['state'] = { s: 'queued' }
const WORKING: HelperItem['state'] = { s: 'working', doing: null }
const USING_TOOL: HelperItem['state'] = { s: 'working', doing: 'tool' }

function helperFrame(state: Tracked, generation: Generation | null, event: HelperEvent): Tracked {
  const isIt = (id: HelperId) => (item: Item) => item.kind === 'helper' && item.id === id
  const found = editHelperTurn(state, isIt(event.id), items => items.map(item => item.kind === 'helper' && item.id === event.id ? advanced(item, event) : item))
  if (found !== null) return found
  const born = advanced({
    kind: 'helper', id: event.id, parentId: event.parentId, depth: event.depth, goal: event.goal, state: QUEUED, toolCount: null, steps: []
  }, event)
  const adopted = (items: readonly Item[]) => items.map(item =>
    item.kind === 'helper' && item.id === event.parentId && !item.steps.some(step => step.kind === 'helper' && step.id === event.id)
      ? { ...item, steps: [...item.steps, { kind: 'helper' as const, id: event.id }] }
      : item)
  const withParent = event.parentId === null ? null : editHelperTurn(state, isIt(event.parentId), adopted, born)
  if (withParent !== null) return withParent
  const { run } = state.content
  if (run.state !== 'running' || (generation !== null && generation !== run.generation)) return state
  return editTurn(state, turn => pushHelper(turn, born))
}

function editHelperTurn(
  state: Tracked, holds: (item: Item) => boolean, edit: (items: readonly Item[]) => readonly Item[], born: HelperItem | null = null
): Tracked | null {
  const { content } = state
  const { run, history } = content
  const same = (items: readonly Item[], held: readonly Item[]) => items.length === held.length && items.every((item, index) => item === held[index])
  if (run.state === 'running' && run.turn.items.some(holds)) {
    return editTurn(state, turn => {
      const items = edit(turn.items)
      const edited = same(items, turn.items) ? turn : { ...turn, items }
      return born === null ? edited : pushHelper(edited, born)
    })
  }
  const at = history.findLastIndex(turn => turn.items.some(holds))
  const turn = history[at]
  if (turn === undefined) return null
  const items = [...edit(turn.items), ...(born === null ? [] : [born])] as SettledTurn['items']
  return same(items, turn.items) ? state : { ...state, content: { ...content, history: history.with(at, { ...turn, items }) } }
}

function advanced(helper: HelperItem, { toolCount, update }: HelperEvent): HelperItem {
  const counted = toolCount === null || (helper.toolCount !== null && helper.toolCount >= toolCount) ? helper.toolCount : toolCount
  const moved = movedBy(helper, update)
  return counted === helper.toolCount && moved === helper ? helper : { ...moved, toolCount: counted }
}

function movedBy(helper: HelperItem, update: HelperUpdate): HelperItem {
  const { state } = helper
  if (state.s === 'ended') return helper
  switch (update.is) {
    case 'queued':
      return helper
    case 'working':
      return state.s === 'working' && state.doing === update.doing ? helper : { ...helper, state: update.doing === null ? WORKING : { s: 'working', doing: update.doing } }
    case 'progress':
      return state.s === 'queued' ? { ...helper, state: WORKING } : helper
    case 'tool':
      return { ...helper, state: USING_TOOL, steps: [...helper.steps, { kind: 'tool', name: update.name, preview: update.preview }] }
    case 'ended':
      return { ...helper, state: { s: 'ended', status: update.status, durationS: update.durationS, summary: update.summary } }
    default:
      return unreachable(update)
  }
}

function isAfter(at: TextCursor, seen: TextCursor): boolean {
  return at.segment > seen.segment || (at.segment === seen.segment && at.offset > seen.offset)
}

function newest(held: Generation | null, named: Generation | null): Generation | null {
  if (held === null || named === null) return held ?? named
  return named > held ? named : held
}

function highestRow(through: number | null, rows: readonly number[]): number | null {
  return rows.reduce<number | null>((highest, row) => highest === null || row > highest ? row : highest, through)
}

function sameRef(a: ModelRef | null, b: ModelRef | null): boolean {
  return a === b || (a !== null && b !== null && a.id === b.id && a.provider === b.provider)
}

function restartCounts(state: Tracked): Tracked {
  const { fence } = state
  return { ...setUsage(state, { ...state.content.usage, totals: ZERO_TOKENS }), fence: { ...fence, totalsEpoch: fence.totalsEpoch + 1 } }
}

function afterPick(state: Tracked, outcome: PickOutcome): Tracked {
  const { model } = state.content
  if (outcome.is === 'asking') {
    const { ask } = model
    if (ask !== null && ask.token === outcome.ask.token) return state
    return { ...state, content: { ...state.content, model: { ...model, ask: outcome.ask } } }
  }
  return model.next === null && model.ask === null ? state : { ...state, content: { ...state.content, model: { ...model, next: null, ask: null } } }
}

function modelFrom(model: SessionModel, named: ModelRef | null): SessionModel {
  if (named === null || sameRef(model.current, named)) return model
  // session.info names no provider (gateway/session_local.py:520): the one already known stays.
  if (named.provider === null && model.current?.id === named.id) return model
  return { ...model, current: named }
}

function patch<T extends object>(value: T, changes: Partial<T>): T {
  const keys = Object.keys(changes) as (keyof T)[]
  return keys.every(key => Object.is(value[key], changes[key])) ? value : { ...value, ...changes }
}

function unreachable(value: never): never {
  throw new Error(`unhandled case: ${JSON.stringify(value)}`)
}

/**
 * How current a session's content is, from its gate and the link. Pure. This is the only source of
 * `Session.sync`: attaching{open} -> opening, {replay} -> catching-up, {rebuild} -> rebuilding,
 * live -> live, detached{refused} -> unavailable, detached{'link-lost'} -> offline,
 * detached{'new'} -> opening while the link is online, else offline.
 */
export function syncOf(gate: Gate, link: Link): Sync {
  switch (gate.at) {
    case 'live':
      return { state: 'live' }
    case 'attaching':
      return { state: ATTACHING_SYNC[gate.plan.mode] }
    case 'detached':
      if (typeof gate.why === 'object') return { state: 'unavailable', message: gate.why.refused }
      return { state: gate.why === 'new' && link.state === 'online' ? 'opening' : 'offline' }
    default:
      return unreachable(gate)
  }
}

const ATTACHING_SYNC = { open: 'opening', replay: 'catching-up', rebuild: 'rebuilding' } as const satisfies Record<Attaching['plan']['mode'], Sync['state']>

/** The value the actor publishes: the content plus `syncOf`. Returns `previous` when neither changed. */
export function sessionOf(state: Tracked, link: Link, previous: Session | null): Session {
  const next: Session = { ...state.content, sync: syncOf(state.gate, link) }
  if (previous === null) return next
  const sameSync = previous.sync.state === next.sync.state
    && (previous.sync.state !== 'unavailable' || next.sync.state !== 'unavailable' || previous.sync.message === next.sync.message)
  return sameSync ? patch(previous, state.content) : next
}

/**
 * What the open turn is doing, derived from `run` and never stored.
 * Precedence: stopping, asking, working, writing, reasoning, helping, preparing, thinking.
 * Helpers of settled turns never set it: the run they belong to is over.
 */
export type TurnActivity =
  | { readonly kind: 'idle' }
  | { readonly kind: 'thinking' }
  | { readonly kind: 'preparing'; readonly tool: string }
  | { readonly kind: 'writing' }
  /** `item` indexes `run.turn.items`: the most recently started tool that is still running. */
  | { readonly kind: 'working'; readonly item: number }
  /** `item` indexes `run.turn.items`: the oldest prompt still waiting or sending. */
  | { readonly kind: 'asking'; readonly item: number }
  /** `item` indexes `run.turn.items`: the reasoning block that is streaming. */
  | { readonly kind: 'reasoning'; readonly item: number }
  /** `item` indexes `run.turn.items`: the newest helper the agent started that is still working, while the agent itself only waits on the model. */
  | { readonly kind: 'helping'; readonly item: number }
  | { readonly kind: 'stopping' }

/**
 * What the chat is doing right now, for the sidebar badge and later the tray: the turn's activity,
 * or `answering` when Hermes waits on a request and the turn is neither stopping nor asking. A
 * request can wait while no turn runs, so `answering` does not mean a turn is running.
 */
export type Activity =
  | TurnActivity
  /** The oldest request Hermes waits on. */
  | { readonly kind: 'answering'; readonly request: RequestId }

export function activityOf(session: SessionContent): Activity {
  const turn = turnActivityOf(session.run)
  const [request] = session.requests
  return request === undefined || turn.kind === 'stopping' || turn.kind === 'asking' ? turn : { kind: 'answering', request: request.id }
}

export function turnActivityOf(run: Run): TurnActivity {
  if (run.state === 'idle') return { kind: 'idle' }
  if (run.stop === 'requested') return { kind: 'stopping' }
  const { items, announced } = run.turn
  const asking = items.findIndex(isPending)
  if (asking !== -1) return { kind: 'asking', item: asking }
  const working = items.findLastIndex(item => item.kind === 'tool' && item.status.s === 'running')
  if (working !== -1) return { kind: 'working', item: working }
  const last = items.at(-1)
  if (last?.kind === 'text' && !last.sealed) return { kind: 'writing' }
  const reasoning = items.findIndex(item => item.kind === 'reasoning' && !item.sealed)
  if (reasoning !== -1) return { kind: 'reasoning', item: reasoning }
  const helping = items.findLastIndex(item => item.kind === 'helper' && item.parentId === null && item.state.s !== 'ended')
  if (helping !== -1) return { kind: 'helping', item: helping }
  return announced === null ? { kind: 'thinking' } : { kind: 'preparing', tool: announced }
}
