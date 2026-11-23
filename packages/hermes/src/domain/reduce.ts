/**
 * The only writer of a session's state. Pure: `(state, input) -> state`, no clock, no I/O.
 * One `SessionActor` (actor.ts) owns one `Tracked` value and calls `reduce` for every change:
 * gateway events, the attach lifecycle, and this client's own actions (a message sent, an answer on
 * its way). Tests feed it event logs.
 */
import type {
  Ask, FileDiff, Generation, InputId, Item, Json, Link, NoticeItem, OpenTurn, Outcome, OutboxEntry, PromptId,
  PromptItem, PromptReply, Request, Run, Session, SessionContent, SessionId, SettledTurn, Sync, TextItem, ToolId,
  ToolItem, ToolResult, TurnId
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
export interface StampedEvent { readonly stamp: Stamp; readonly event: SessionEvent | null }

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
  readonly unfinished: { readonly request: string | null; readonly items: SettledTurn['items'] } | null
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
  | { readonly did: 'send'; readonly inputId: InputId; readonly text: string; readonly apiText?: string }
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
  readonly generation: Generation | null
  /** Attach attempts begun so far. The next attempt is this plus one. */
  readonly attaches: number
}

export interface Tracked {
  readonly content: SessionContent
  readonly gate: Gate
  readonly fence: Fence
}

export function emptyTracked(id: SessionId): Tracked {
  return {
    content: { id, title: '', cwd: null, history: [], earlier: 'none', run: IDLE, outbox: [] },
    gate: { at: 'detached', why: 'new', cursor: null },
    fence: { revision: 0, text: null, older: null, admissions: {}, settledThrough: null, generation: null, attaches: 0 }
  }
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
  const { gate } = state
  switch (input.in) {
    case 'attach': {
      if (gate.at !== 'detached') return state
      if (gate.cursor !== null) return beginAttach(state, { mode: 'replay', from: gate.cursor }, [])
      return beginAttach(state, state.fence.generation === null ? { mode: 'open' } : REBUILD, [])
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
    case 'declined': {
      const { requestId, method } = input.request
      if (holdsDeclined(state.content, requestId)) return state
      return editTurn(ensureRun(state, state.fence.generation), turn => pushItem(turn, { kind: 'notice', what: 'declined', requestId, method }))
    }
    case 'local':
      return act(state, input.action)
    default:
      return unreachable(input)
  }
}

type Attaching = Extract<Gate, { at: 'attaching' }>
const REBUILD: Attaching['plan'] = { mode: 'rebuild' }

function beginAttach(state: Tracked, plan: Attaching['plan'], parked: readonly StampedEvent[]): Tracked {
  const attempt = state.fence.attaches + 1
  return { ...state, gate: { at: 'attaching', attempt, plan, parked }, fence: { ...state.fence, attaches: attempt } }
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
  if (gate.at !== 'detached') return beginAttach(state, REBUILD, [])
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
      const stale = run.state === 'running' && generation !== null && generation < run.generation
      return frame.event === null || stale ? moved : fold(moved, frame.stamp, frame.event)
    }
    default:
      return unreachable(gate)
  }
}

function attached(state: Tracked, gate: Attaching, snapshot: Snapshot, replay: Replay | null): Tracked {
  const { plan, parked } = gate
  const { watermark } = snapshot
  const liveAt = (cursor: Cursor): Tracked => ({ ...state, gate: { at: 'live', cursor, subscriptionId: snapshot.subscriptionId } })
  const upToWatermark = (frame: StampedEvent) => frame.stamp.seq <= watermark.seq

  if (plan.mode === 'replay' && replay !== null && !replay.snapshotRequired && replay.epoch === watermark.epoch && replay.epoch === plan.from.epoch) {
    // The gateway's catch-up frames sit among the parked ones (gateway/session_events.py:114-124). They
    // go in before the snapshot is compared, so a turn that ended in that window keeps its real outcome.
    const caughtUp = [...replay.events, ...parked.filter(upToWatermark)].reduce(admit, liveAt(plan.from))
    if (caughtUp.gate.at !== 'live' || caughtUp.gate.cursor.seq !== watermark.seq) return beginAttach(state, REBUILD, parked)
    return parked.filter(frame => !upToWatermark(frame)).reduce(admit, reconcile(caughtUp, snapshot))
  }
  if (snapshot.history !== null) {
    return parked.filter(frame => frame.stamp.epoch === watermark.epoch).reduce(admit, seed(liveAt(watermark), snapshot, snapshot.history))
  }
  return beginAttach(state, REBUILD, parked)
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
    items: leftOpen.items,
    outcome: LOST,
    rows: []
  }]
  const run: Run = !snapshot.running ? IDLE : {
    state: 'running',
    generation: snapshot.generation,
    stop: sameRun ? before.stop : 'none',
    turn: {
      id: runTurnId(snapshot.generation),
      request: requestOf(page.unfinished?.request ?? null) ?? startedRequest(snapshot.queue),
      items: [...(page.unfinished?.items ?? []), ...snapshot.prompts.map(waitingPrompt)],
      announced: null
    }
  }
  const seeded: Tracked = {
    ...state,
    content: { id: content.id, title: snapshot.title, cwd: snapshot.cwd, history, earlier: page.older === null ? 'none' : 'more', run, outbox: content.outbox },
    fence: {
      revision: Math.max(fence.revision, snapshot.revision),
      text: null,
      older: page.older,
      admissions: {},
      settledThrough: history.reduce<number | null>((through, turn) => highestRow(through, turn.rows), null),
      generation: newest(fence.generation, snapshot.generation),
      attaches: fence.attaches
    }
  }
  return snapshot.queue.reduce(admission, seeded)
}

function markLost(turns: readonly SettledTurn[], settledThrough: number | null): readonly SettledTurn[] {
  const lost = (turn: SettledTurn): SettledTurn => turn.outcome.kind === 'lost' ? turn : { ...turn, outcome: LOST }
  if (settledThrough === null) return turns.map((turn, index) => index === turns.length - 1 ? lost(turn) : turn)
  return turns.map(turn => turn.rows.some(row => row > settledThrough) ? lost(turn) : turn)
}

function reconcile(state: Tracked, snapshot: Snapshot): Tracked {
  let next: Tracked = {
    ...state,
    content: patch(state.content, { title: snapshot.title }),
    fence: patch(state.fence, {
      revision: Math.max(state.fence.revision, snapshot.revision),
      generation: newest(state.fence.generation, snapshot.generation)
    })
  }
  const { run } = next.content
  if (run.state === 'running' && !(snapshot.running && snapshot.generation === run.generation)) next = settle(next, LOST, null, [])
  if (snapshot.running && next.content.run.state === 'idle') {
    next = openRun(next, snapshot.generation, runTurnId(snapshot.generation), startedRequest(snapshot.queue))
  }
  next = editTurn(next, turn => {
    const answered = mapItems(turn, item =>
      isPending(item) && !snapshot.prompts.some(prompt => prompt.id === item.id) ? { ...item, state: answeredFrom(item) } : item)
    return snapshot.prompts
      .filter(prompt => !answered.items.some(item => item.kind === 'prompt' && item.id === prompt.id))
      .reduce((open, prompt) => pushItem(open, waitingPrompt(prompt)), answered)
  })
  return snapshot.queue.reduce(admission, next)
}

function startedRequest(queue: readonly Admission[]): Request | null {
  const started = queue.find(row => row.status === 'started')
  return started === undefined ? null : { text: started.text, inputId: started.inputId }
}

function admission(state: Tracked, row: Pick<Admission, 'inputId' | 'admissionId' | 'status'>): Tracked {
  const { content, fence } = state
  const entry = content.outbox.find(held => held.inputId === row.inputId)
  if (entry === undefined) return state
  const remembered: Tracked = fence.admissions[row.admissionId] === row.inputId
    ? state
    : { ...state, fence: { ...fence, admissions: { ...fence.admissions, [row.admissionId]: row.inputId } } }
  switch (row.status) {
    case 'unknown':
      return remembered
    case 'queued':
      return entry.state.s === 'queued' ? remembered : setEntry(remembered, { inputId: entry.inputId, text: entry.text, state: { s: 'queued' } })
    case 'terminal':
      return dropEntry(state, row.inputId)
    case 'started': {
      const { run } = content
      if (run.state !== 'running') return remembered
      const { request } = run.turn
      if (request !== null && request.inputId !== null && request.inputId !== row.inputId) return remembered
      const claimed = editTurn(state, turn => ({ ...turn, request: { text: request?.text ?? entry.text, inputId: entry.inputId } }))
      return dropEntry(claimed, row.inputId)
    }
    default:
      return unreachable(row.status)
  }
}

function setEntry(state: Tracked, entry: OutboxEntry): Tracked {
  const outbox = state.content.outbox.map(held => held.inputId === entry.inputId ? entry : held)
  return { ...state, content: { ...state.content, outbox } }
}

function dropEntry(state: Tracked, inputId: InputId): Tracked {
  const { content, fence } = state
  if (!content.outbox.some(entry => entry.inputId === inputId)) return state
  const admissions = Object.fromEntries(Object.entries(fence.admissions).filter(([, held]) => held !== inputId))
  return {
    ...state,
    content: { ...content, outbox: content.outbox.filter(entry => entry.inputId !== inputId) },
    fence: { ...fence, admissions }
  }
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
        inputId: action.inputId, text: action.text, ...(action.apiText === undefined ? {} : { apiText: action.apiText }), state: { s: 'sending' }
      }
      if (entry === undefined) return { ...state, content: { ...content, outbox: [...content.outbox, sending] } }
      return entry.state.s === 'failed' ? setEntry(state, sending) : state
    }
    case 'send.admitted':
      return admission(state, action)
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
    case 'answer':
      return editPrompt(state, action.promptId, prompt =>
        prompt.state.s === 'waiting' ? { ...prompt, state: { s: 'sending', reply: action.reply } } : prompt)
    case 'answer.resolved':
      return editPrompt(state, action.promptId, prompt => {
        if (!isClosed(prompt)) return { ...prompt, state: action.byUs ? answeredFrom(prompt) : ANSWERED_ELSEWHERE }
        // The gateway's settle event can arrive before this receipt and assume the reply was ours.
        return prompt.state.s === 'answered' && prompt.state.reply !== null && !action.byUs ? { ...prompt, state: ANSWERED_ELSEWHERE } : prompt
      })
    case 'answer.failed':
      return editPrompt(state, action.promptId, prompt =>
        prompt.state.s === 'sending' ? { ...prompt, state: { s: 'waiting', error: action.message } } : prompt)
    case 'earlier.requested':
      return content.earlier === 'more' ? { ...state, content: { ...content, earlier: 'loading' } } : state
    default:
      return unreachable(action)
  }
}

const IDLE: Run = { state: 'idle' }
const LOST: Outcome = { kind: 'lost' }
const ANSWERED_ELSEWHERE: PromptItem['state'] = { s: 'answered', reply: null }

function fold(state: Tracked, stamp: Stamp, event: SessionEvent): Tracked {
  switch (event.type) {
    case 'turn.started': {
      const { run } = state.content
      if (stamp.generation === null || (event.turnId !== null && holdsTurn(state.content, event.turnId))) return state
      if (run.state === 'running' && stamp.generation <= run.generation) return state
      const settled = settle(state, LOST, null, [])
      const claimed = claimEntry(settled, event.admissionId, event.requestText)
      const request = claimed !== null
        ? { text: claimed.text, inputId: claimed.inputId }
        : requestOf(event.requestText)
      return openRun(
        claimed === null ? settled : dropEntry(settled, claimed.inputId),
        stamp.generation,
        event.turnId ?? runTurnId(stamp.generation),
        request
      )
    }
    case 'text.delta': {
      const open = ensureRun(state, stamp.generation)
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
      return ensureRun(state, stamp.generation)
    case 'tool.announced':
      return editTurn(ensureRun(state, stamp.generation), turn => patch(turn, { announced: event.name }))
    case 'tool.started':
      return editTurn(ensureRun(state, stamp.generation), turn =>
        turn.items.some(item => item.kind === 'tool' && item.id === event.id)
          ? turn
          : pushItem(turn, { kind: 'tool', id: event.id, name: event.name, args: event.args, status: { s: 'running', note: null } }))
    case 'tool.progress':
      return editTurn(state, turn => mapItems(turn, item =>
        item.kind === 'tool' && item.id === event.id && item.status.s === 'running' && item.status.note !== event.note
          ? { ...item, status: { s: 'running', note: event.note } }
          : item))
    case 'tool.finished': {
      const status: ToolItem['status'] = { s: 'done', durationS: event.durationS, diffs: event.diffs, result: event.result }
      return editTurn(ensureRun(state, stamp.generation), turn => {
        if (!turn.items.some(item => item.kind === 'tool' && item.id === event.id)) {
          return pushItem(turn, { kind: 'tool', id: event.id, name: event.name, args: event.args ?? {}, status })
        }
        return mapItems(turn, item =>
          item.kind === 'tool' && item.id === event.id && item.status.s !== 'done'
            ? { ...item, name: event.name, args: event.args ?? item.args, status }
            : item)
      })
    }
    case 'prompt.opened':
      return editTurn(ensureRun(state, event.generation), turn =>
        turn.items.some(item => item.kind === 'prompt' && item.id === event.id) ? turn : pushItem(turn, waitingPrompt(event)))
    case 'prompt.settled':
      return editPrompt(state, event.id, prompt => isClosed(prompt) ? prompt : { ...prompt, state: answeredFrom(prompt) })
    case 'prompts.cancelled':
      return editTurn(state, turn => mapItems(turn, item =>
        isPending(item) && event.ids.includes(item.id) ? { ...item, state: { s: 'withdrawn' } } : item))
    case 'turn.ended':
      // A queued message that is cancelled completes with no generation on its stamp
      // (gateway/session_authority.py:886). That is not the end of the turn running ahead of it.
      return stamp.generation === null ? state : settle(state, event.outcome, event.finalText, event.rows)
    case 'notice':
      return editTurn(ensureRun(state, stamp.generation), turn =>
        pushItem(turn, { kind: 'notice', what: 'said', tone: event.tone, text: event.text }))
    case 'meta': {
      const titled: Tracked = event.title === undefined ? state : { ...state, content: patch(state.content, { title: event.title }) }
      const revised: Tracked = event.revision === undefined
        ? titled
        : { ...titled, fence: patch(titled.fence, { revision: Math.max(titled.fence.revision, event.revision) }) }
      return (event.queue ?? []).reduce(admission, revised)
    }
    default:
      return unreachable(event)
  }
}

function openRun(state: Tracked, generation: Generation, id: TurnId, request: Request | null): Tracked {
  const run: Run = { state: 'running', generation, stop: 'none', turn: { id, request, items: [], announced: null } }
  return { ...state, content: { ...state.content, run }, fence: patch(state.fence, { text: null }) }
}

function ensureRun(state: Tracked, generation: Generation | null): Tracked {
  return state.content.run.state === 'running' || generation === null ? state : openRun(state, generation, runTurnId(generation), null)
}

function runTurnId(generation: Generation): TurnId {
  return `run:${generation}` as TurnId
}

function requestOf(text: string | null): Request | null {
  return text === null ? null : { text, inputId: null }
}

function holdsTurn(content: SessionContent, id: TurnId): boolean {
  return (content.run.state === 'running' && content.run.turn.id === id) || content.history.some(turn => turn.id === id)
}

function holdsDeclined(content: SessionContent, requestId: string): boolean {
  const isIt = (item: Item) => item.kind === 'notice' && item.what === 'declined' && item.requestId === requestId
  return (content.run.state === 'running' && content.run.turn.items.some(isIt)) || content.history.some(turn => turn.items.some(isIt))
}

function claimEntry(state: Tracked, admissionId: string | null, requestText: string | null): OutboxEntry | null {
  const { outbox } = state.content
  const { admissions } = state.fence
  const inputId = admissionId === null ? undefined : admissions[admissionId]
  const admitted = outbox.find(entry => entry.inputId === inputId)
  if (admitted !== undefined) return admitted
  const sending = outbox.filter(entry => entry.state.s === 'sending' && !Object.values(admissions).includes(entry.inputId))
  const [only] = sending
  return only !== undefined && sending.length === 1 && (requestText === null || requestText === only.text) ? only : null
}

function settle(state: Tracked, outcome: Outcome, finalText: string | null, rows: readonly number[]): Tracked {
  const { content, fence } = state
  if (content.run.state !== 'running') return state
  const { id, request, items } = content.run.turn
  const turn: SettledTurn = { id, request, items: withFinalText(items, finalText).map(settledItem), outcome, rows }
  return {
    ...state,
    content: { ...content, history: [...content.history, turn], run: IDLE },
    fence: patch(fence, { text: null, settledThrough: highestRow(fence.settledThrough, rows) })
  }
}

function withFinalText(items: readonly Item[], finalText: string | null): readonly Item[] {
  if (finalText === null || finalText === '') return items
  const tail = items.findLastIndex(item => item.kind !== 'text') + 1
  const [only, ...rest] = items.slice(tail)
  if (only?.kind === 'text' && rest.length === 0 && only.markdown === finalText) return items
  return [...items.slice(0, tail), { kind: 'text', markdown: finalText, sealed: true }]
}

function settledItem(item: Item): Item<'settled'> {
  switch (item.kind) {
    case 'text':
      return isSealed(item) ? item : { ...item, sealed: true }
    case 'tool':
      return isFinished(item) ? item : { ...item, status: { s: 'cut' } }
    case 'prompt':
      return isClosed(item) ? item : { ...item, state: { s: 'withdrawn' } }
    case 'notice':
      return item
    default:
      return unreachable(item)
  }
}

const isSealed = (item: TextItem): item is TextItem & { readonly sealed: true } => item.sealed
const isFinished = (item: ToolItem): item is ToolItem & { readonly status: ToolItem<'settled'>['status'] } => item.status.s !== 'running'
const isClosed = (item: PromptItem): item is PromptItem & { readonly state: PromptItem<'settled'>['state'] } =>
  item.state.s === 'answered' || item.state.s === 'withdrawn'
const isPending = (item: Item): item is PromptItem => item.kind === 'prompt' && !isClosed(item)

function answeredFrom(prompt: PromptItem): PromptItem['state'] {
  return prompt.state.s === 'sending' ? { s: 'answered', reply: prompt.state.reply } : ANSWERED_ELSEWHERE
}

function waitingPrompt(prompt: { readonly id: PromptId; readonly generation: Generation; readonly ask: Ask }): PromptItem {
  return { kind: 'prompt', id: prompt.id, generation: prompt.generation, ask: prompt.ask, state: { s: 'waiting', error: null } }
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

function pushItem(turn: OpenTurn, item: ToolItem | PromptItem | NoticeItem | TextItem): OpenTurn {
  const last = turn.items.at(-1)
  const above = last?.kind === 'text' && !last.sealed ? turn.items.with(-1, { ...last, sealed: true }) : turn.items
  return { ...turn, announced: null, items: [...above, item] }
}

function appendText(turn: OpenTurn, text: string): OpenTurn {
  const last = turn.items.at(-1)
  if (last?.kind !== 'text' || last.sealed) return pushItem(turn, { kind: 'text', markdown: text, sealed: false })
  return { ...turn, announced: null, items: turn.items.with(-1, { ...last, markdown: last.markdown + text }) }
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
  const { run } = session
  if (run.state === 'idle') return { kind: 'idle' }
  if (run.stop === 'requested') return { kind: 'stopping' }
  const { items, announced } = run.turn
  const asking = items.findIndex(isPending)
  if (asking !== -1) return { kind: 'asking', item: asking }
  const working = items.findLastIndex(item => item.kind === 'tool' && item.status.s === 'running')
  if (working !== -1) return { kind: 'working', item: working }
  const last = items.at(-1)
  if (last?.kind === 'text' && !last.sealed) return { kind: 'writing' }
  return announced === null ? { kind: 'thinking' } : { kind: 'preparing', tool: announced }
}
