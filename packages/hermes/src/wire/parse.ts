/**
 * The only place gateway shapes become domain shapes. Everything past these functions trusts its types.
 * Pure. Never throws on bad input: a frame it cannot use is still classified, and the hub counts it.
 */
import type { Admission, HistoryPage, Replay, ServerRequest, SessionEvent, Snapshot, StampedEvent, Stamp } from '../domain/reduce'
import type {
  Ask, Began, FileDiff, Generation, Item, Json, Outcome, PromptId, SessionId, SettledTurn, SidebarRow, ToolId, ToolResult, TurnId
} from '../domain/session'
import type {
  CanonicalEventsResult, CanonicalPendingAdmission, CanonicalPendingPrompt, CanonicalReplayEvent, CanonicalSessionListRow,
  CanonicalSnapshot, ErrorPayload, ErrorSurface, MessageCompletePayload, MessageDeltaPayload, MessageInterimPayload,
  MessageStartPayload, PersistedTurn, SessionLiveInfo, SessionMutateResult, SessionTitlePayload, StoredTranscriptResult,
  StoredTranscriptRow, ToolCompletePayload, ToolGeneratingPayload, ToolProgressPayload, ToolStartPayload
} from './contract.generated'

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
   * A session event with no session id, or a frame with no stream position.
   * Never guessed into a session, because one socket serves many of them. Counted as `unrouted`.
   */
  | { readonly scope: 'unrouted'; readonly type: string; readonly why: string }

/** `gateway/session_pending_controls.py:71,93`: the prompt's own generation rides along. */
interface PromptSettledPayload { prompt_id: string; execution_generation: number | null }
/** `tui_gateway/session_lifecycle.py:636-643`, the TUI gateway's broadcast. The canonical gateway settles a dropped prompt with `*.settled`. */
interface ApprovalCancelledPayload { request_ids: string[] }
/** `gateway/session_authority.py:489-495`: the queue and the revision, on every pending-row change. */
type CanonicalSessionInfo = SessionLiveInfo & { pending?: CanonicalPendingAdmission[]; revision?: number }
/** `gateway/run_turn_progress.py:118` adds the executor's verdict to the contract's payload. */
type CanonicalToolComplete = ToolCompletePayload & { is_error?: boolean }
/** `gateway/session_settlement_recovery.py:40-49`, and a cancelled queued row's `{text, content, admission_id, outcome}` (`gateway/session_authority.py:890`). */
type CanonicalComplete = MessageCompletePayload & { outcome?: string; content?: unknown }

type Obj = { readonly [key: string]: unknown }

const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)

class Unusable extends Error {}

function usable<T>(parse: () => T): T | null {
  try {
    return parse()
  } catch (error) {
    if (error instanceof Unusable) return null
    throw error
  }
}

function fields<P>(value: unknown) {
  if (!isObject(value)) throw new Unusable()
  type Key = keyof P & string
  const optional = <T>(key: Key, is: (raw: unknown) => raw is T): T | null => {
    const raw = value[key]
    if (raw === undefined || raw === null) return null
    if (!is(raw)) throw new Unusable()
    return raw
  }
  const required = <T>(key: Key, is: (raw: unknown) => raw is T): T => {
    const raw = optional(key, is)
    if (raw === null) throw new Unusable()
    return raw
  }
  return {
    raw: (key: Key): unknown => value[key],
    str: (key: Key) => required(key, isString),
    optStr: (key: Key) => optional(key, isString),
    int: (key: Key) => required(key, isCount),
    optInt: (key: Key) => optional(key, isCount),
    optNum: (key: Key) => optional(key, isFiniteNumber),
    optBool: (key: Key) => optional(key, isBoolean),
    strs: (key: Key) => required(key, isStrings),
    ints: (key: Key) => required(key, isCounts),
    optList: (key: Key) => optional(key, Array.isArray),
    optObj: (key: Key) => optional(key, isObject)
  }
}

const isString = (raw: unknown): raw is string => typeof raw === 'string'
const isBoolean = (raw: unknown): raw is boolean => typeof raw === 'boolean'
const isFiniteNumber = (raw: unknown): raw is number => typeof raw === 'number' && Number.isFinite(raw)
const isCount = (raw: unknown): raw is number => Number.isSafeInteger(raw) && (raw as number) >= 0
const isStrings = (raw: unknown): raw is string[] => Array.isArray(raw) && raw.every(isString)
const isCounts = (raw: unknown): raw is number[] => Array.isArray(raw) && raw.every(isCount)

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJson)
  return isObject(value) && Object.values(value).every(isJson)
}
const isJsonObject = (raw: unknown): raw is { readonly [key: string]: Json } => isObject(raw) && isJson(raw)

const ANSI = new RegExp(String.raw`\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]`, 'g')
const stripAnsi = (text: string) => text.replace(ANSI, '')

const RESULT_CAP = 256 * 1024

function clip(raw: string): { readonly text: string; readonly clipped: number } {
  const text = stripAnsi(raw)
  return text.length <= RESULT_CAP ? { text, clipped: 0 } : { text: text.slice(0, RESULT_CAP), clipped: text.length - RESULT_CAP }
}

const COMPLETE: Outcome = { kind: 'complete' }
const STOPPED: Outcome = { kind: 'stopped' }
const LOST: Outcome = { kind: 'lost' }
const NO_RESULT: ToolResult = { kind: 'none' }

/** An approval or clarify prompt. Event payloads and snapshot entries are the same dict (`gateway/session_pending_controls.py:18-51,74`). */
function promptOf(value: unknown): { readonly id: PromptId; readonly generation: Generation; readonly ask: Ask } {
  const p = fields<CanonicalPendingPrompt>(value)
  const id = p.str('prompt_id') as PromptId
  const generation = p.int('execution_generation') as Generation
  switch (p.str('kind')) {
    case 'approval':
      return { id, generation, ask: { kind: 'approval', command: p.str('command'), reason: p.optStr('description') || null, choices: p.strs('choices') } }
    case 'clarify':
      return { id, generation, ask: { kind: 'clarify', question: p.str('question'), choices: p.strs('choices'), multi: p.optBool('multi_select') ?? false } }
    default:
      throw new Unusable()
  }
}

const ADMISSION_STATUSES: readonly string[] = ['queued', 'started', 'unknown', 'terminal'] satisfies Admission['status'][]

function admissionOf(value: unknown): Admission {
  const row = fields<CanonicalPendingAdmission>(value)
  const status = row.str('status')
  if (!ADMISSION_STATUSES.includes(status)) throw new Unusable()
  return { inputId: row.str('input_id') as Admission['inputId'], admissionId: row.str('admission_id'), text: row.str('text'), status: status as Admission['status'] }
}

type Shown = (payload: Obj, envelope: Obj) => SessionEvent

function meta(title: string | null, revision: number | null, queue: readonly Admission[] | null): SessionEvent {
  return {
    type: 'meta',
    ...(title === null ? {} : { title }),
    ...(revision === null ? {} : { revision }),
    ...(queue === null ? {} : { queue })
  }
}

const promptOpened: Shown = payload => ({ type: 'prompt.opened', ...promptOf(payload) })
const promptSettled: Shown = payload => ({ type: 'prompt.settled', id: fields<PromptSettledPayload>(payload).str('prompt_id') as PromptId })

export const SHOWN: { readonly [type: string]: Shown } = {
  /** `{}` for an ordinary admission (`gateway/session_authority.py:1239`). The turn id, when stamped, rides on the deltas. */
  'message.start': (payload, envelope) => {
    const p = fields<MessageStartPayload>(payload)
    const turnId = p.optStr('turn_id')
    return {
      type: 'turn.started',
      turnId: turnId ? turnId as TurnId : null,
      admissionId: fields<CanonicalReplayEvent>(envelope).optStr('admission_id'),
      requestText: p.optStr('display_text')
    }
  },
  /** `text: null` closes the text before a tool round. `segment` + `offset` (UTF-16) place a chunk (`gateway/run_turn_runner.py:263-275`). */
  'message.delta': payload => {
    const p = fields<MessageDeltaPayload>(payload)
    if (p.raw('text') === null) return { type: 'text.sealed', text: null }
    const segment = p.optInt('segment')
    const offset = p.optInt('offset')
    return { type: 'text.delta', text: p.str('text'), at: segment === null || offset === null ? null : { segment, offset } }
  },
  /** Commentary handed over whole (`gateway/run_turn_runner.py:393-394`). */
  'message.interim': payload => ({ type: 'text.sealed', text: fields<MessageInterimPayload>(payload).str('text') }),
  /** `text` is null for a streamed local turn: the deltas were the reply (`gateway/session_settlement_recovery.py:40-108`). */
  'message.complete': payload => {
    const p = fields<CanonicalComplete>(payload)
    const outcome = outcomeOf(p)
    const receipt = p.optObj('persisted_turn')
    return {
      type: 'turn.ended',
      outcome,
      finalText: outcome.kind === 'failed' ? null : p.optStr('text') || null,
      rows: receipt === null ? [] : fields<PersistedTurn>(receipt).ints('row_ids')
    }
  },
  /** Spinner text while a model request is in flight (`gateway/local_viewer_events.py:44`). */
  'thinking.delta': () => ({ type: 'thinking' }),
  'tool.generating': payload => ({ type: 'tool.announced', name: fields<ToolGeneratingPayload>(payload).str('name') }),
  'tool.start': payload => {
    const p = fields<ToolStartPayload>(payload)
    const args = p.raw('args') ?? {}
    if (!isJsonObject(args)) throw new Unusable()
    return { type: 'tool.started', id: toolIdOf(p.str('tool_id')), name: p.str('name'), args }
  },
  'tool.progress': payload => {
    const p = fields<ToolProgressPayload>(payload)
    const total = p.optNum('total')
    const count = `${p.optNum('progress') ?? 0}${total === null ? '' : ` of ${total}`}`
    return { type: 'tool.progress', id: toolIdOf(p.str('tool_id')), note: stripAnsi(p.optStr('message') || count) }
  },
  'tool.complete': payload => {
    const p = fields<CanonicalToolComplete>(payload)
    const args = p.raw('args') ?? null
    const diff = p.optStr('inline_diff')
    if (args !== null && !isJsonObject(args)) throw new Unusable()
    return {
      type: 'tool.finished',
      id: toolIdOf(p.str('tool_id')),
      name: p.str('name'),
      args,
      durationS: p.optNum('duration_s'),
      diffs: diff === null ? [] : parseInlineDiff(diff),
      result: parseToolResult(p.raw('result'), p.optStr('result_text'), p.optBool('is_error') ?? false)
    }
  },
  'approval.request': promptOpened,
  'clarify.request': promptOpened,
  'approval.settled': promptSettled,
  'clarify.settled': promptSettled,
  'approval.cancelled': payload => ({ type: 'prompts.cancelled', ids: fields<ApprovalCancelledPayload>(payload).strs('request_ids') as PromptId[] }),
  'session.info': payload => {
    const p = fields<CanonicalSessionInfo>(payload)
    return meta(p.optStr('title'), p.optInt('revision'), p.optList('pending')?.map(admissionOf) ?? null)
  },
  'session.title': payload => meta(fields<SessionTitlePayload>(payload).str('title'), null, null),
  /** A committed `session.mutate` result (`gateway/session_mutations.py:352`). */
  'session.updated': payload => {
    const p = fields<SessionMutateResult>(payload)
    return meta(p.optStr('title'), p.optInt('revision'), null)
  },
  error: payload => ({ type: 'notice', tone: 'error', text: stripAnsi(fields<ErrorPayload>(payload).str('message')) })
}

export const UNSHOWN: ReadonlySet<string> = new Set([
  /** Every canonical turn publishes it (`gateway/run_turn_progress.py:1092`); not in the generated contract. */
  'agent.step',
  'agent.print', 'agent.terminal.output', 'background.complete', 'billing.step_up.verification', 'bot_relay.outbox.pending',
  'browser.progress', 'btw.complete', 'connection.request', 'connection.update', 'cron.changed', 'display.install.done',
  'display.install.log', 'display.lease', 'display.status', 'free_tier.challenge', 'gateway.ready', 'groups.changed',
  'message.reaction', 'moa.aggregating', 'moa.phase', 'moa.progress', 'moa.reference', 'notice', 'notification.clear',
  'notification.show', 'onboarding.ended', 'pairing.changed', 'pane.reveal', 'pet.changed', 'pet.generate.progress',
  'pet.hatch.progress', 'platforms.changed', 'preview.close', 'preview.open', 'preview.restart.complete',
  'preview.restart.progress', 'projects.changed', 'reaction', 'reasoning.available', 'reasoning.delta', 'request.cancel',
  'review.summary', 'session.control.update', 'session.reclaimed', 'session.resume_progress', 'session.usage',
  'setup.ready', 'skills.changed', 'skin.changed', 'status.update', 'subagent.complete', 'subagent.progress',
  'subagent.spawn_requested', 'subagent.start', 'subagent.thinking', 'subagent.tool', 'terminal.close', 'tip.show',
  'todo.updated', 'tool.output_risk', 'voice.interrupted', 'voice.partial', 'voice.status', 'voice.transcript', 'wake.detected'
])

/**
 * `status` is the contract's TurnStatus. Without one, `outcome` decides the way Hermes derives the
 * status from it (`gateway/session_settlement_recovery.py:45-47`, where `interrupted` goes out as `cancelled`).
 */
function outcomeOf(p: ReturnType<typeof fields<CanonicalComplete>>): Outcome {
  const status = p.optStr('status')
  const outcome = p.optStr('outcome')
  if (status === 'complete' || (status === null && outcome === 'completed')) return COMPLETE
  if (status === 'interrupted' || (status === null && outcome === 'cancelled')) return STOPPED
  if (status === null && outcome === null) throw new Unusable()
  const surface = p.optObj('error_surface')
  const said = surface === null ? null : fields<ErrorSurface>(surface)
  return {
    kind: 'failed',
    message: stripAnsi(p.optStr('failure_reason') || p.optStr('error') || p.optStr('text') || 'Hermes said the turn failed and gave no reason.'),
    code: said?.optStr('code') ?? null,
    retryable: said?.optBool('retryable') ?? p.optBool('recoverable') ?? false
  }
}

function toolIdOf(id: string): ToolId {
  if (id === '') throw new Unusable()
  return id as ToolId
}

function stampOf(envelope: Obj): Stamp | null {
  return usable(() => {
    const frame = fields<CanonicalReplayEvent>(envelope)
    const epoch = frame.str('replay_epoch')
    const seq = frame.int('seq')
    if (epoch === '' || seq === 0) throw new Unusable()
    return { epoch, seq, generation: frame.optInt('execution_generation') as Generation | null }
  })
}

export function parseEvent(params: unknown): ParsedEvent {
  if (!isObject(params) || typeof params.type !== 'string' || params.type === '') return { scope: 'unrouted', type: '', why: 'not an event' }
  const { type, session_id: id, payload } = params
  if (type === 'sessions.changed') return { scope: 'app', event: 'sessions.changed' }
  if (typeof id !== 'string' || id === '') return { scope: 'unrouted', type, why: 'no session id' }
  const sessionId = id as SessionId
  if (type === 'session.replay_gap') return { scope: 'gap', sessionId }
  const stamp = stampOf(params)
  if (stamp === null) return { scope: 'unrouted', type, why: 'no stream position' }
  const shown = Object.hasOwn(SHOWN, type) ? SHOWN[type] : undefined
  if (shown === undefined) return { scope: 'session', sessionId, type, stamp, event: null, skipped: 'unshown' }
  const event = isObject(payload) ? usable(() => shown(payload, params)) : null
  if (event === null) return { scope: 'session', sessionId, type, stamp, event: null, skipped: 'invalid' }
  return { scope: 'session', sessionId, type, stamp, event }
}

/**
 * `messages_omitted` -> history null. Otherwise history comes from `display_messages`, the gateway's
 * own display rows, through `parseRows`. `older` is set when the first stored row carries
 * `archived_truncated` (`gateway/session_local_recovery.py:388`), which only `messages` keeps.
 */
export function parseSnapshot(reply: CanonicalSnapshot): Snapshot {
  const first = reply.messages[0]
  return {
    id: reply.session_id as SessionId,
    title: reply.info.title ?? '',
    cwd: reply.info.cwd || null,
    running: reply.running,
    generation: reply.execution_generation as Generation,
    revision: reply.revision,
    subscriptionId: reply.subscription_id,
    watermark: { epoch: reply.replay_epoch, seq: reply.last_sequence },
    queue: reply.pending.flatMap(row => usable(() => admissionOf(row)) ?? []),
    prompts: reply.prompts.flatMap(prompt => usable(() => promptOf(prompt)) ?? []),
    history: reply.messages_omitted === true ? null : {
      ...parseRows(reply.display_messages ?? []),
      older: first?.['archived_truncated'] === true ? { cursor: null } : null
    },
    openRequests: (reply.open_requests ?? []).map(parseServerRequest)
  }
}

export function parseReplay(reply: CanonicalEventsResult): Replay {
  const events = reply.events.flatMap((params): StampedEvent[] => {
    const parsed = parseEvent(params)
    return parsed.scope === 'session' ? [{ stamp: parsed.stamp, event: parsed.event, seenAt: null }] : []
  })
  return { snapshotRequired: reply.snapshot_required, epoch: reply.epoch, events }
}

/** Consecutive `session.transcript` pages of older rows, newest page first. Same row parser as the snapshot. */
export function parseTranscript(pages: readonly StoredTranscriptResult[]): HistoryPage {
  const oldestFirst = pages.toReversed()
  const cursor = oldestFirst[0]?.next_cursor ?? null
  return { ...parseRows(oldestFirst.flatMap(page => page.rows)), older: cursor === null ? null : { cursor } }
}

interface TurnInProgress {
  readonly request: string | null
  readonly began: Began | null
  readonly items: Item<'settled'>[]
  readonly rows: number[]
}

/**
 * Stored rows -> settled turns, shared by `parseSnapshot` and `parseTranscript` (a transcript
 * `message` row is a `display_messages` row). A user row opens a turn. Assistant text, tool rows and
 * compaction rows become its items. Stored rows carry no diff, so a history tool is `done` with
 * `diffs: []`. A turn that ends in an assistant answer is `complete`. A turn with no answer is
 * `unfinished` when it is the last one, else `lost`. Every turn lists the `row_id`s its rows carry.
 *
 * Display rows come from `tui_gateway/session_history.py:297-373`: a tool row has no `row_id`, carries
 * `content` only for write_file, patch, skill_manage and clarify, and an assistant row with no text is
 * left out, so a turn lists fewer ids than the completion receipt names.
 */
export function parseRows(rows: readonly unknown[]): Pick<HistoryPage, 'turns' | 'unfinished'> {
  const turns: TurnInProgress[] = []
  rows.forEach((value, index) => {
    const row = usable(() => storedRow(value, index))
    if (row === null) return
    if (row.role === 'user') turns.push({ request: row.text, began: row.at === null ? null : { at: row.at, clock: 'hermes' }, items: [], rows: [] })
    if (row.item !== null && turns.length === 0) turns.push({ request: null, began: null, items: [], rows: [] })
    const turn = turns.at(-1)
    if (row.item !== null) turn?.items.push(row.item)
    if (row.rowId !== null) turn?.rows.push(row.rowId)
  })
  // A compaction row sits before the row it was stored on, so it can follow a turn's answer.
  const answered = (turn: TurnInProgress) => turn.items.findLast(item => item.kind !== 'notice')?.kind === 'text'
  const last = turns.at(-1)
  const open = last !== undefined && !answered(last) ? last : null
  return {
    turns: turns.flatMap((turn, index): SettledTurn[] => turn === open ? [] : [{
      id: `stored:${turn.rows[0] ?? `@${index}`}` as TurnId,
      request: turn.request === null ? null : { text: turn.request, inputId: null },
      began: turn.began,
      items: turn.items,
      outcome: answered(turn) ? COMPLETE : LOST,
      rows: turn.rows
    }]),
    unfinished: open === null ? null : { request: open.request, began: open.began, items: open.items }
  }
}

function storedRow(value: unknown, index: number) {
  const row = fields<StoredTranscriptRow>(value)
  const role = row.optStr('role')
  const text = row.optStr('text') ?? ''
  const rowId = row.optInt('row_id')
  const seconds = row.optNum('timestamp')
  const at = seconds !== null && seconds > 0 ? Math.round(seconds * 1000) : null
  const item = ((): Item<'settled'> | null => {
    if (row.optStr('row_kind') === 'compaction') return { kind: 'notice', what: 'said', tone: 'info', text }
    if (role === 'assistant') return text.trim() === '' ? null : { kind: 'text', markdown: text, sealed: true }
    if (role !== 'tool') return null
    const args = row.raw('args') ?? {}
    if (!isJsonObject(args)) throw new Unusable()
    const content = row.raw('content')
    return {
      kind: 'tool',
      id: (row.optStr('tool_call_id') || `stored-tool:${index}`) as ToolId,
      name: row.optStr('name') || 'tool',
      args,
      status: { s: 'done', durationS: null, diffs: [], result: content === undefined ? NO_RESULT : parseToolResult(content, null, false) }
    }
  })()
  return { role, text, rowId, at, item }
}

export function parseListRows(rows: readonly CanonicalSessionListRow[]): Omit<SidebarRow, 'badge'>[] {
  return rows.map(row => {
    const seconds = row.last_active_at ?? row.started_at
    return {
      id: row.session_id as SessionId,
      title: row.title,
      preview: row.preview || null,
      lastActiveAt: seconds === null ? null : Math.round(seconds * 1000)
    }
  })
}

/** A server-to-client request frame, or an `open_requests` entry of a snapshot. Its params carry the session (`tui_gateway/server_requests.py:98,103`); an app-level one has `''`. */
export function parseServerRequest(request: { readonly id: string; readonly method: string; readonly params: unknown }): ServerRequest {
  const sessionId = isObject(request.params) ? request.params.session_id : undefined
  return { requestId: request.id, method: request.method, sessionId: typeof sessionId === 'string' && sessionId !== '' ? sessionId as SessionId : null }
}

function diffLineKind(line: string): FileDiff['lines'][number]['t'] | null {
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('-')) return 'del'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith(' ')) return 'ctx'
  return null
}

const FILE_HEADER = /^(.+) → (.+)$/
const PATCH_NOTE = /^# (?:Moved|Deleted): /

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/

function hunksAreWhole(lines: FileDiff['lines']): boolean {
  let left = { old: 0, new: 0 }
  let hunks = 0
  for (const line of lines) {
    if (line.t === 'hunk') {
      const header = HUNK_HEADER.exec(line.text)
      if (header === null || left.old !== 0 || left.new !== 0) return false
      left = { old: Number(header[1] ?? 1), new: Number(header[2] ?? 1) }
      hunks++
    } else {
      if (line.t !== 'add') left.old--
      if (line.t !== 'del') left.new--
    }
  }
  return hunks > 0 && left.old === 0 && left.new === 0
}

/**
 * Hermes's `inline_diff`: ANSI-coloured, with a "review diff" banner and an "a/x → b/x" line per file
 * (`agent/display.py:746-790`). Lines before the first file header and lines with no diff prefix are dropped.
 * Hermes ends a capped diff with an "omitted" summary line, so a last line that is not part of a diff marks the
 * file before it cut. The patch tool's own `# Moved:` and `# Deleted:` notes are not a summary.
 */
export function parseInlineDiff(raw: string): FileDiff[] {
  const files: { path: string; deletesFile: boolean; lines: FileDiff['lines'][number][] }[] = []
  let summarized = false
  for (const line of stripAnsi(raw).split('\n')) {
    if (line === '') continue
    const t = diffLineKind(line)
    const header = t === null ? FILE_HEADER.exec(line) : null
    summarized = t === null && header === null && files.length > 0 && !PATCH_NOTE.test(line)
    if (header !== null) {
      const [, from = '', to = ''] = header
      files.push({ path: (to === '/dev/null' ? from : to).replace(/^[ab]\//, ''), deletesFile: to === '/dev/null', lines: [] })
    } else if (t !== null) {
      files.at(-1)?.lines.push({ t, text: t === 'hunk' ? line : line.slice(1) })
    }
  }
  return files.map(({ path, deletesFile, lines }, index) => ({
    path,
    createsFile: lines.find(line => line.t === 'hunk')?.text.startsWith('@@ -0,0') ?? false,
    deletesFile,
    cut: (summarized && index === files.length - 1) || !hunksAreWhole(lines),
    added: lines.filter(line => line.t === 'add').length,
    removed: lines.filter(line => line.t === 'del').length,
    lines
  }))
}

/**
 * `{output, exit_code, error}` -> command; a string -> text; other JSON -> pretty-printed text. Caps at 256 kB.
 * The gateway sends `result` as a JSON string (`gateway/session_tool_events.py:25-30`), so a string
 * holding a JSON object or array is read as that value. `resultText` is Hermes's own rendering under /verbose.
 */
export function parseToolResult(result: unknown, resultText: string | null, isError: boolean): ToolResult {
  const value = typeof result === 'string' ? decodedJson(result) ?? result : result
  if (isObject(value) && typeof value.output === 'string' && 'exit_code' in value) {
    const { text, clipped } = clip(value.output)
    return { kind: 'command', output: text, exitCode: Number.isSafeInteger(value.exit_code) ? value.exit_code as number : null, clipped }
  }
  const shown = resultText ?? (typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value, null, 2))
  if (shown === '') return NO_RESULT
  const { text, clipped } = clip(shown)
  return { kind: 'text', text, isError, clipped }
}

function decodedJson(text: string): Obj | readonly unknown[] | undefined {
  if (!/^\s*[[{]/.test(text)) return undefined
  try {
    const value: unknown = JSON.parse(text)
    return isObject(value) || Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}
