/**
 * The only place gateway shapes become domain shapes. Everything past these functions trusts its types.
 * Pure. Never throws on bad input: a frame it cannot use is still classified, and the hub counts it.
 */
import { canonicalBotId, type BotCreated, type BotDetails, type BotFacts, type BotId } from '../domain/bots'
import type { ContextBreakdown, ModelConfirm, ModelMenu } from '../domain/command'
import type { PaneAsk } from '../domain/pane'
import type { Admission } from '../domain/queue'
import type { CardRequest, HelperUpdate, HistoryPage, PickOutcome, Replay, Said as SaidTuning, ServerRequest, SessionEvent, ShownNotice, Snapshot, StampedEvent, Stamp } from '../domain/reduce'
import type { CloseWhy } from '../domain/requests'
import { EFFORTS } from '../domain/session'
import type {
  AdmissionId, Answer, Ask, Began, BusyMode, ConnectTarget, FileDiff, Generation, HelperEnd, HelperId, InputId, Item, Json, ModelId, ModelOption, ModelRef, Outcome, PlanEntry, PromptId,
  Question, RequestId, SessionId, SessionUsage, SettledTurn, SideId, SidebarRow, SideTask, StatusAbout, ToolId, ToolResult, TurnId
} from '../domain/session'
import type { PathMatch } from '../domain/path'
import type { RelayState } from '../domain/relay'
import { OWN_COMMANDS, type SlashCatalog, type SlashEntry } from '../domain/slash'
import type { Said, TreeRow } from '../domain/versions'
import type {
  AgentPrintPayload, CanonicalBotDeliverResult, CanonicalCorrectionResult, CanonicalEventsResult, CanonicalListResult, CanonicalPendingAdmission,
  CanonicalPendingPrompt, CanonicalProfilesResult, CanonicalReplayEvent, CanonicalSessionListRow, CanonicalSnapshot, ClarifyQuestion, ClarifyRequestParams,
  CommandDispatchResult, CommandsCatalogResult, CompletionItem, CompletionItemsResult, ConnectionDisplay, ConnectionOperationTarget, ConnectionRequestPayload,
  ConnectionTargetEnvField, ConnectionUpdatePayload, ContextCategory, ErrorPayload, ErrorSurface, MessageCompletePayload, MessageDeltaPayload,
  MessageInterimPayload, MessageStartPayload, MoaAggregatingPayload, MoaPhasePayload, MoaProgressPayload, MoaReferencePayload, ModelOptionProvider,
  ModelOptionsResult, NotificationClearPayload, NotificationShowPayload, PersistedTurn, PreviewClosePayload, PreviewOpenPayload, ProfilesConfigureResult,
  ProfilesCreateResult, ProfilesDescribeResult, ProfilesGetAssetResult, ProjectsTreeResult, ProjectTreeLane, ProjectTreeNode, ProjectTreeRepo,
  ProjectTreeSession, RequestCancelPayload, SecretRequestParams, SessionContextBreakdownResult, SessionLiveInfo, SessionMutateResult, SessionStats,
  SessionTitlePayload, SessionUsagePayload, SideAgentCompletePayload, StatusUpdatePayload, StoredTranscriptResult, StoredTranscriptRow, StreamDeltaPayload,
  SubagentEventPayload, SudoRequestParams, TodoUpdatedPayload, ToolCompletePayload, ToolGeneratingPayload, ToolProgressPayload, ToolStartPayload, Usage,
  VaultCodeRequestParams, VaultSaveLoginRequestParams, VaultUnlockRequestParams
} from './contract.generated'

export type ParsedEvent =
  /** One shown frame of a session's stream: a session id, a seq and a replay epoch on the envelope, and a payload we use. */
  | { readonly scope: 'session'; readonly sessionId: SessionId; readonly type: string; readonly stamp: Stamp; readonly event: SessionEvent }
  /**
   * A frame of a session's stream with nothing to show: a type we leave out for now, or a payload we
   * could not use. It still reaches the session, so the cursor moves and the frame is not mistaken for
   * a hole.
   */
  | { readonly scope: 'session'; readonly sessionId: SessionId; readonly type: string; readonly stamp: Stamp; readonly event: null; readonly skipped: 'unshown' | 'invalid' }
  /** A frame of a session's stream that asks something of the window, not of the chat. It moves the cursor as an unshown frame does. */
  | { readonly scope: 'session'; readonly sessionId: SessionId; readonly type: string; readonly stamp: Stamp; readonly event: null; readonly skipped: 'window'; readonly ask: PaneAsk }
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
function promptOf(value: unknown): { readonly id: PromptId; readonly generation: Generation; readonly ask: Ask; readonly timeoutS: number | null } {
  const p = fields<CanonicalPendingPrompt>(value)
  const id = p.str('prompt_id') as PromptId
  const generation = p.int('execution_generation') as Generation
  const seconds = p.optNum('timeout_s')
  const timeoutS = seconds !== null && seconds > 0 ? seconds : null
  switch (p.str('kind')) {
    case 'approval':
      return { id, generation, timeoutS, ask: { kind: 'approval', command: p.str('command'), reason: p.optStr('description') || null, choices: p.strs('choices') } }
    case 'clarify':
      return { id, generation, timeoutS, ask: { kind: 'clarify', question: p.str('question'), choices: p.strs('choices'), multi: p.optBool('multi_select') ?? false } }
    default:
      throw new Unusable()
  }
}

/** `controls` names what Hermes serves for a queued row. An older Hermes lists none (gateway/session_queued_controls.py:49-59). */
const CONTROLS: { readonly [control: string]: 'sendNow' | 'edit' } = { steer: 'sendNow', replace: 'edit' }

function admissionOf(value: unknown): Admission {
  const row = fields<CanonicalPendingAdmission>(value)
  const state = ((): Admission['state'] => {
    switch (row.str('status')) {
      case 'queued':
        return { s: 'queued', can: (row.optList('controls') ?? []).flatMap(control => (isString(control) ? CONTROLS[control] ?? [] : [])) }
      // A row handed to the running turn reads `started` until that turn settles it (gateway/session_authority.py:461-465).
      case 'started':
        return { s: row.optBool('steering') === true ? 'steering' : 'started' }
      case 'unknown':
        return { s: 'lost', generation: row.int('execution_generation') as Generation }
      case 'terminal':
        return { s: 'terminal' }
      default:
        throw new Unusable()
    }
  })()
  return { admissionId: row.str('admission_id') as AdmissionId, inputId: row.str('input_id') as InputId, text: row.str('text'), state }
}

type Shown = (payload: Obj, envelope: Obj) => SessionEvent | null

function sideAnswer(payload: Obj, kind: SideTask['kind']): SessionEvent {
  const p = fields<SideAgentCompletePayload>(payload)
  const id = p.str('task_id')
  if (id === '') throw new Unusable()
  return { type: 'side.answered', id: id as SideId, kind, asked: p.optStr('question') || null, text: stripAnsi(p.str('text')) }
}

interface MetaFields {
  readonly title?: string | null
  readonly revision?: number | null
  readonly queue?: readonly Admission[] | null
  readonly model?: ModelRef | null
  readonly cwd?: string | null
  readonly tuning?: Partial<SaidTuning>
  readonly pick?: PickOutcome | null
  readonly generation?: number | null
  readonly cutBefore?: number | null
  readonly countsRestart?: true
}

function meta({ title, revision, queue, model, cwd, tuning, pick, generation, cutBefore, countsRestart }: MetaFields): SessionEvent {
  return {
    type: 'meta',
    ...(title == null ? {} : { title }),
    ...(revision == null ? {} : { revision }),
    ...(queue == null ? {} : { queue }),
    ...(model == null ? {} : { model }),
    ...(cwd == null ? {} : { cwd }),
    ...(tuning === undefined || Object.keys(tuning).length === 0 ? {} : { tuning }),
    ...(pick == null ? {} : { pick }),
    ...(generation == null ? {} : { generation: generation as Generation }),
    ...(cutBefore == null ? {} : { cutBefore }),
    ...(countsRestart === undefined ? {} : { countsRestart })
  }
}

type ModelReceiptFields = SessionMutateResult & {
  status?: string; model?: string; provider?: string; execution_generation?: number
  confirm?: string; confirm_message?: string; payload?: unknown; committed_model?: string; committed_provider?: string
  target_message?: unknown
}

/**
 * A model receipt on the stream (gateway/session_mutations.py:352, gateway/session_deferred_pick.py:126-148).
 * A held pick that needs a second yes names the committed model as `committed_model` and the pick in `payload`.
 * A held pick that no longer resolves is `refused` and names the committed model as `model`.
 */
function modelReceipt(p: ReturnType<typeof fields<ModelReceiptFields>>): SessionEvent {
  const revision = p.optInt('revision')
  const status = p.optStr('status')
  if (status !== 'confirmation_required') {
    const switched = status !== 'refused' && status !== 'noop'
    return meta({
      revision, model: modelOf(p.optStr('model'), p.optStr('provider')), pick: { is: 'settled' }, generation: p.optInt('execution_generation'),
      ...(switched ? { countsRestart: true } : {})
    })
  }
  const asked = fields<{ model?: string; provider?: string }>(p.optObj('payload') ?? {})
  const model = modelOf(asked.optStr('model'), asked.optStr('provider'))
  const token = p.optStr('confirm')
  const ask = model === null || !token ? null : { is: 'asking' as const, ask: { model, token, message: p.optStr('confirm_message') || CONFIRM_ASKED } }
  return meta({ revision, model: modelOf(p.optStr('committed_model'), p.optStr('committed_provider')), pick: ask })
}

function modelOf(model: string | null | undefined, provider: string | null | undefined): ModelRef | null {
  return model ? { id: model as ModelId, provider: provider || null } : null
}

const PLAN_STATUSES: readonly string[] = ['pending', 'in_progress', 'completed', 'cancelled'] satisfies PlanEntry['status'][]

const idOf = (raw: unknown): string | null => (isString(raw) && raw !== '' ? raw : isFiniteNumber(raw) ? String(raw) : null)

function planEntryOf(raw: unknown): PlanEntry[] {
  if (!isObject(raw)) return []
  const id = idOf(raw.id)
  const text = words(raw.content)
  if (id === null || text === null) return []
  const status = isString(raw.status) && PLAN_STATUSES.includes(raw.status) ? raw.status as PlanEntry['status'] : 'pending'
  return [{ id, text, status, parentId: idOf(raw.parent) }]
}

const HELPER_ENDS: { readonly [status: string]: HelperEnd } = {
  completed: 'completed', failed: 'failed', error: 'failed', timeout: 'timeout', interrupted: 'interrupted'
}

type SubagentFields = ReturnType<typeof fields<SubagentEventPayload>>

/** A `subagent.*` frame. Older emitters omit `subagent_id`; the delegation and task index name the helper then. */
const helperFrame = (update: (p: SubagentFields) => HelperUpdate): Shown => payload => {
  const p = fields<SubagentEventPayload>(payload)
  return {
    type: 'helper',
    id: (p.optStr('subagent_id') || `${p.optStr('delegation_id') ?? 'task'}:${p.int('task_index')}`) as HelperId,
    parentId: (p.optStr('parent_id') || null) as HelperId | null,
    depth: p.optInt('depth') ?? 0,
    goal: p.str('goal'),
    toolCount: p.optInt('tool_count'),
    update: update(p)
  }
}

function helperEnd(p: SubagentFields): HelperUpdate {
  const status = p.optStr('status')
  const summary = stripAnsi(p.optStr('summary') ?? '')
  return {
    is: 'ended',
    status: status === null ? 'completed' : Object.hasOwn(HELPER_ENDS, status) ? HELPER_ENDS[status]! : 'failed',
    durationS: p.optNum('duration_seconds'),
    summary: summary.trim() === '' ? null : summary
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
    const usage = p.optObj('usage')
    return {
      type: 'turn.ended',
      outcome,
      finalText: outcome.kind === 'failed' ? null : p.optStr('text') || null,
      rows: receipt === null ? [] : fields<PersistedTurn>(receipt).ints('row_ids'),
      userRow: receipt === null ? null : fields<PersistedTurn>(receipt).optInt('user_row_id'),
      usage: usage === null ? null : parseUsage(usage)
    }
  },
  /** Spinner text while a model request is in flight (`gateway/local_viewer_events.py:44`). */
  'thinking.delta': () => ({ type: 'thinking' }),
  'reasoning.delta': payload => ({ type: 'reasoning', text: fields<StreamDeltaPayload>(payload).str('text'), whole: false }),
  /** The whole block, which may repeat the deltas Hermes already streamed for it. */
  'reasoning.available': payload => ({ type: 'reasoning', text: fields<StreamDeltaPayload>(payload).str('text'), whole: true }),
  'todo.updated': payload => {
    const p = fields<TodoUpdatedPayload>(payload)
    const todos = p.optList('todos')
    if (todos === null) throw new Unusable()
    const entries = todos.flatMap(planEntryOf)
    return { type: 'plan', revision: p.int('revision'), entries: entries.filter((entry, index) => entries.findIndex(other => other.id === entry.id) === index) }
  },
  'subagent.spawn_requested': helperFrame(() => ({ is: 'queued' })),
  'subagent.start': helperFrame(() => ({ is: 'working', doing: null })),
  'subagent.thinking': helperFrame(() => ({ is: 'working', doing: 'thinking' })),
  'subagent.progress': helperFrame(() => ({ is: 'progress' })),
  'subagent.tool': helperFrame(p => ({ is: 'tool', name: p.optStr('tool_name') || 'tool', preview: p.optStr('tool_preview') || p.optStr('text') || null })),
  'subagent.complete': helperFrame(helperEnd),
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
      image: p.optStr('image_path') || null,
      result: parseToolResult(p.raw('result'), p.optStr('result_text'), p.optBool('is_error') ?? false)
    }
  },
  /** The four MoA facade events, each a step of one round (`gateway/local_viewer_events.py:129-161`). */
  'moa.progress': payload => {
    const p = fields<MoaProgressPayload>(payload)
    return { type: 'moa', step: { is: 'progress', done: p.int('refs_done'), total: p.int('refs_total') } }
  },
  'moa.reference': payload => {
    const p = fields<MoaReferencePayload>(payload)
    return { type: 'moa', step: { is: 'reference', label: p.str('label'), text: stripAnsi(p.str('text')) } }
  },
  'moa.phase': payload => {
    const p = fields<MoaPhasePayload>(payload)
    if (p.str('phase') !== 'aggregator') throw new Unusable()
    return { type: 'moa', step: { is: 'aggregating', by: p.optStr('aggregator') || null } }
  },
  'moa.aggregating': payload => ({ type: 'moa', step: { is: 'aggregating', by: fields<MoaAggregatingPayload>(payload).optStr('aggregator') || null } }),
  'status.update': payload => {
    const p = fields<StatusUpdatePayload>(payload)
    const kind = p.str('kind')
    if (kind === 'process') return null
    return { type: 'status', about: STATUS_ABOUT[kind] ?? 'other', text: stripAnsi(p.str('text')) }
  },
  'agent.print': payload => ({ type: 'status', about: 'print', text: stripAnsi(fields<AgentPrintPayload>(payload).str('text')) }),
  'notification.show': payload => ({ type: 'notice.shown', notice: noticeOf(payload) }),
  'notification.clear': payload => ({ type: 'notice.cleared', key: fields<NotificationClearPayload>(payload).str('key') }),
  'approval.request': promptOpened,
  'clarify.request': promptOpened,
  'approval.settled': promptSettled,
  'clarify.settled': promptSettled,
  'approval.cancelled': payload => ({ type: 'prompts.cancelled', ids: fields<ApprovalCancelledPayload>(payload).strs('request_ids') as PromptId[] }),
  /** A reason outside Hermes's own five reads as withdrawn (`RequestCancelReason`, tui_gateway/contracts/server_requests.py:372-377). */
  /** A side agent's answer, published on the chat's stream with no generation (gateway/session_tui_side.py:139-151). */
  'btw.complete': payload => sideAnswer(payload, 'btw'),
  'background.complete': payload => sideAnswer(payload, 'background'),
  'request.cancel': payload => {
    const p = fields<RequestCancelPayload>(payload)
    return { type: 'request.cancelled', id: p.str('id') as RequestId, why: CANCEL_WHY[p.str('reason')] ?? 'withdrawn' }
  },
  /** The card of `manage_connections`, opened on the turn that called it (gateway/local_desktop_ui.py:278). */
  'connection.request': (payload, envelope) => ({ type: 'connect', card: connectCard(payload, envelope), settled: null }),
  /**
   * Each change of the card, with the whole card (gateway/local_desktop_ui.py:132-151). The frame
   * with `settled` is its last. An operation of the account, not of a chat, is not this chat's card.
   */
  'connection.update': (payload, envelope) => {
    const p = fields<ConnectionUpdatePayload>(payload)
    if (fields<{ type: string }>(p.optObj('owner') ?? {}).optStr('type') !== 'session') return null
    const settled = p.optBool('settled') === true ? SETTLED_BY[p.optStr('settled_by') ?? ''] ?? 'withdrawn' : null
    return { type: 'connect', card: connectCard(payload, envelope), settled }
  },
  'session.info': payload => {
    const p = fields<CanonicalSessionInfo>(payload)
    // Its execution_generation is how an attached viewer learns a generation a policy change moved (gateway/session_authority.py:484-495).
    return meta({
      title: p.optStr('title'), revision: p.optInt('revision'), queue: p.optList('pending')?.map(admissionOf) ?? null,
      model: modelOf(p.optStr('model'), p.optStr('provider')), cwd: p.optStr('cwd') || null, tuning: saidIn(payload), generation: p.optInt('execution_generation')
    })
  },
  /** A tick after each model call of a turn (`gateway/session_usage.py:176-186`). */
  'session.usage': payload => ({ type: 'usage', context: parseUsage(fields<SessionUsagePayload>(payload).optObj('usage') ?? {}).context }),
  'session.title': payload => meta({ title: fields<SessionTitlePayload>(payload).str('title') }),
  /** A committed `session.mutate` result (`gateway/session_mutations.py:352`). */
  'session.updated': payload => {
    const p = fields<ModelReceiptFields>(payload)
    if (p.optStr('operation') === 'model' && p.optStr('status') !== 'deferred') return modelReceipt(p)
    // A rewind receipt names the row it cut before as `target_message.id` (persistence/sqlite/authority/_mutation.py:192-198).
    const target = p.optStr('operation') === 'rewind' ? p.optObj('target_message') : null
    return meta({
      title: p.optStr('title'), revision: p.optInt('revision'), generation: p.optInt('execution_generation'),
      cutBefore: target === null ? null : fields<{ id?: number }>(target).optInt('id')
    })
  },
  error: payload => ({ type: 'notice', tone: 'error', text: stripAnsi(fields<ErrorPayload>(payload).str('message')) })
}

const nonBlank = (text: string | null) => (text === null || text.trim() === '' ? null : text)

export const FOR_WINDOW: { readonly [type: string]: (payload: unknown) => PaneAsk } = {
  'preview.open': payload => {
    const p = fields<PreviewOpenPayload>(payload)
    const url = nonBlank(p.str('url'))
    if (url === null) throw new Unusable()
    return { do: 'open', url, label: nonBlank(p.optStr('label')) }
  },
  'preview.close': payload => ({ do: 'close', url: nonBlank(fields<PreviewClosePayload>(payload).optStr('url')) })
}

export const UNSHOWN: ReadonlySet<string> = new Set([
  /** Every canonical turn publishes it (`gateway/run_turn_progress.py:1092`); not in the generated contract. */
  'agent.step',
  'agent.terminal.output', 'billing.step_up.verification', 'bot_relay.outbox.pending',
  'browser.progress', 'cron.changed', 'display.install.done',
  'display.install.log', 'display.lease', 'display.status', 'free_tier.challenge', 'gateway.ready', 'groups.changed',
  'message.reaction', 'notice', 'onboarding.ended', 'pairing.changed', 'pane.reveal', 'pet.changed', 'pet.generate.progress',
  'pet.hatch.progress', 'platforms.changed', 'preview.restart.complete',
  'preview.restart.progress', 'projects.changed', 'reaction',
  'review.summary', 'session.control.update', 'session.reclaimed', 'session.resume_progress',
  'setup.ready', 'skills.changed', 'skin.changed', 'terminal.close', 'tip.show', 'tool.output_risk', 'voice.interrupted', 'voice.partial', 'voice.status', 'voice.transcript', 'wake.detected'
])

/**
 * `status.update` kinds: `compacting` is a compaction's progress line, re-tagged by Hermes from its
 * mark (`agent/conversation_compression.py:157-166`), and `compacted` its end. A goal check's verdict
 * is `goal` (`gateway/run_goals.py:238-246`). `warn` is `_emit_warning`.
 */
const STATUS_ABOUT: { readonly [kind: string]: StatusAbout } = { compacting: 'compacting', compacted: 'compacted', goal: 'goal', warn: 'warning' }

const NOTICE_LEVELS: readonly string[] = ['info', 'warn', 'error', 'success'] satisfies ShownNotice['level'][]

/** `AgentNotice` as `run_turn_progress.py:1119-1127` publishes it. */
function noticeOf(payload: Obj): ShownNotice {
  const p = fields<NotificationShowPayload>(payload)
  const text = stripAnsi(p.str('text'))
  const level = p.optStr('level') ?? 'info'
  const ttl = p.optNum('ttl_ms')
  return {
    key: p.optStr('key') || p.optStr('id') || text,
    level: NOTICE_LEVELS.includes(level) ? level as ShownNotice['level'] : 'info',
    text,
    detail: p.optStr('detail') || null,
    ttlMs: p.optStr('kind') === 'ttl' && ttl !== null && ttl > 0 ? ttl : null
  }
}

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
  if (Object.hasOwn(FOR_WINDOW, type)) {
    const ask = usable(() => FOR_WINDOW[type]!(payload))
    return ask === null ? { scope: 'session', sessionId, type, stamp, event: null, skipped: 'invalid' } : { scope: 'session', sessionId, type, stamp, event: null, skipped: 'window', ask }
  }
  const shown = Object.hasOwn(SHOWN, type) ? SHOWN[type] : undefined
  if (shown === undefined) return { scope: 'session', sessionId, type, stamp, event: null, skipped: 'unshown' }
  const parsed = isObject(payload) ? usable(() => ({ event: shown(payload, params) })) : null
  if (parsed === null) return { scope: 'session', sessionId, type, stamp, event: null, skipped: 'invalid' }
  if (parsed.event === null) return { scope: 'session', sessionId, type, stamp, event: null, skipped: 'unshown' }
  return { scope: 'session', sessionId, type, stamp, event: parsed.event }
}

/**
 * The switches a `session.info` names. Hermes says `reasoning_effort` `''` for the model's own level
 * and `fast` as whether the chat's tier is fast on its model (gateway/session_local.py:486-503).
 */
function saidIn(info: unknown): Partial<SaidTuning> {
  const p = fields<CanonicalSessionInfo>(info)
  const effort = p.optStr('reasoning_effort')
  const fast = p.optBool('fast')
  const yolo = p.optBool('yolo')
  return {
    ...(effort === null ? {} : { effort: effort === '' ? 'default' : EFFORTS.find(level => level === effort) ?? null }),
    ...(fast === null ? {} : { fast }),
    ...(yolo === null ? {} : { yolo })
  }
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
    model: modelOf(reply.info.model, reply.info.provider),
    tuning: { effort: null, fast: null, yolo: null, ...saidIn(reply.info) },
    running: reply.running,
    generation: reply.execution_generation as Generation,
    revision: reply.revision,
    subscriptionId: reply.subscription_id,
    watermark: { epoch: reply.replay_epoch, seq: reply.last_sequence },
    queue: parsePending(reply.pending),
    prompts: reply.prompts.flatMap(prompt => {
      const parsed = usable(() => promptOf(prompt))
      return parsed === null ? [] : [{ id: parsed.id, generation: parsed.generation, ask: parsed.ask }]
    }),
    history: reply.messages_omitted === true ? null : {
      ...parseRows(reply.display_messages ?? []),
      older: first?.['archived_truncated'] === true ? { cursor: null } : null
    },
    openRequests: [
      ...(reply.open_requests ?? []).map(parseServerRequest),
      ...(isObject(reply.pending_connection) ? [parseServerRequest({ id: String(reply.pending_connection.op_id), method: CONNECT, params: { ...reply.pending_connection, session_id: reply.session_id } })] : [])
    ]
  }
}

/**
 * Hermes's status-bar view of a session's usage, as `usage` on `message.complete` and on a `session.usage` tick.
 * Its counters are the running totals of the session's agent (`tui_gateway/server.py:1270-1279`). Only the token
 * counts and the context fill are read. Hermes leaves the fill out until a model call has sized it
 * (`gateway/session_usage.py:139-146`).
 */
export function parseUsage(view: Usage): SessionUsage {
  return usable(() => {
    const p = fields<Usage>(view)
    const input = p.optInt('input')
    const output = p.optInt('output')
    const used = p.optInt('context_used')
    const max = p.optInt('context_max')
    return {
      totals: input === null || output === null ? null : { input, output, reasoning: p.optInt('reasoning') ?? 0 },
      context: used === null || !max ? null : {
        used, max, percent: p.optNum('context_percent') ?? percentOf(used, max), estimated: p.optBool('context_estimated') ?? false
      }
    }
  }) ?? NO_USAGE
}

/**
 * `session.stats`: the counters that view is built from, read the way Hermes builds it
 * (`tui_usage`, `gateway/session_usage.py:130-147`). The canonical gateway has no `session.usage` method.
 */
export function parseStats(reply: SessionStats): SessionUsage {
  return usable(() => {
    const p = fields<SessionStats>(reply)
    const used = p.optInt('last_prompt_tokens')
    const max = p.optInt('context_length')
    return {
      totals: {
        input: p.optInt('input_tokens') || p.optInt('prompt_tokens') || 0,
        output: p.optInt('output_tokens') || p.optInt('completion_tokens') || 0,
        reasoning: p.optInt('reasoning_tokens') ?? 0
      },
      context: !used || !max ? null : {
        used: Math.min(used, max), max, percent: percentOf(Math.min(used, max), max),
        estimated: (p.optStr('context_source') ?? 'provider_usage') !== 'provider_usage'
      }
    }
  }) ?? NO_USAGE
}

const NO_USAGE: SessionUsage = { totals: null, context: null }
const percentOf = (used: number, max: number) => Math.max(0, Math.min(100, Math.round(used / max * 100)))

export function parseContextBreakdown(reply: SessionContextBreakdownResult): ContextBreakdown {
  return usable(() => {
    const p = fields<SessionContextBreakdownResult>(reply)
    return {
      model: p.optStr('model') || null,
      used: p.optNum('context_used') ?? 0,
      max: p.optNum('context_max') ?? 0,
      percent: p.optNum('context_percent') ?? 0,
      estimated: p.optBool('context_estimated') ?? false,
      categories: (p.optList('categories') ?? []).flatMap(row => usable(() => categoryOf(row)) ?? [])
    }
  }) ?? NO_BREAKDOWN
}

function categoryOf(row: unknown): ContextBreakdown['categories'][number] {
  const c = fields<ContextCategory>(row)
  const id = c.str('id')
  return { id, label: c.optStr('label') || id, tokens: c.int('tokens') }
}

const NO_BREAKDOWN: ContextBreakdown = { model: null, used: 0, max: 0, percent: 0, estimated: false, categories: [] }

const PATH_ROW = /^@(file|folder):(.+)$/s

/** The rows of a `complete.path` reply that name a file or folder. Profile rows, directive hints and plugin rows share the list and are left out. */
export function parsePathMatches(reply: CompletionItemsResult): readonly PathMatch[] {
  return (usable(() => fields<CompletionItemsResult>(reply).optList('items')) ?? []).flatMap(row => {
    const text = usable(() => fields<CompletionItem>(row).str('text'))
    const match = text === null ? null : PATH_ROW.exec(text)
    return match === null ? [] : [{ path: match[2] as string, folder: match[1] === 'folder' || (match[2] as string).endsWith('/') }]
  })
}

export function parsePending(rows: readonly unknown[]): Admission[] {
  return rows.flatMap(row => usable(() => admissionOf(row)) ?? [])
}

/** `config.get` and `config.set` of `show_reasoning` answer `'1'` or `'0'` (`gateway/session_busy_controls.py:90-108`). */
export function parseShown(reply: { readonly value?: unknown }): boolean | null {
  return reply.value === '1' ? true : reply.value === '0' ? false : null
}

/** `config.set` of `fast` answers the tier by its word: `fast` or `ultrafast` for a fast one, `normal` for none (agent/fast_mode.py:54-56). */
export function parseFast(reply: { readonly value?: unknown }): boolean | null {
  return isString(reply.value) ? reply.value === 'fast' || reply.value === 'ultrafast' : null
}

const BUSY_MODES: readonly string[] = ['queue', 'steer', 'interrupt'] satisfies BusyMode[]

/** `config.get` and `config.set` of `busy` answer the mode by name (`gateway/session_busy_controls.py:30-72`). */
export function parseBusy(reply: { readonly value?: unknown }): BusyMode | null {
  return isString(reply.value) && BUSY_MODES.includes(reply.value) ? reply.value as BusyMode : null
}

/** What `session.steer` or `session.redirect` did with the words (`CanonicalCorrectionAck`, tui_gateway/contracts/canonical_sessions.py:306-321). */
export type Correction =
  | 'taken'
  /** No agent saw them (`delivered: false`), so they are safe to send as a message. A bare stop phrase that ended a voice chat reads so too: a submit of it is dropped the same way. */
  | 'unread'
  /** `rejected` with no `delivered`: they may have reached the agent, so they are never sent again. */
  | 'unsure'

export function parseCorrection(reply: CanonicalCorrectionResult): Correction {
  if (!('status' in reply)) return 'unread'
  if (reply.status !== 'rejected') return 'taken'
  return reply.delivered === false ? 'unread' : 'unsure'
}

export function parseModelMenu(reply: ModelOptionsResult): ModelMenu {
  const options = (Array.isArray(reply.providers) ? reply.providers : []).flatMap(row => usable(() => providerOptions(row)) ?? [])
  const unique = options.filter((option, index) =>
    options.findIndex(other => other.id === option.id && other.provider === option.provider) === index)
  return { options: unique, fallback: modelOf(typeof reply.model === 'string' ? reply.model : null, typeof reply.provider === 'string' ? reply.provider : null) }
}

function providerOptions(row: unknown): ModelOption[] {
  const p = fields<ModelOptionProvider>(row)
  if (p.optBool('authenticated') === false) return []
  const provider = p.str('slug')
  const providerName = p.optStr('name') || provider
  const unavailable = new Set(p.optList('unavailable_models')?.filter(isString) ?? [])
  return (p.optList('models') ?? [])
    .filter((model): model is string => isString(model) && model !== '' && !unavailable.has(model))
    .map(model => ({ id: model as ModelId, provider, providerName }))
}

export type ModelReceipt =
  | { readonly status: 'committed' }
  | { readonly status: 'deferred'; readonly during: Generation | null }
  | { readonly status: 'confirm'; readonly confirm: ModelConfirm }
  | { readonly status: 'confirm-without-token'; readonly message: string }

export function parseModelReceipt(reply: SessionMutateResult): ModelReceipt {
  return usable(() => receiptOf(reply)) ?? COMMITTED
}

function receiptOf(reply: SessionMutateResult): ModelReceipt {
  const p = fields<SessionMutateResult & { status?: string; execution_generation?: number; confirm?: string; confirm_message?: string }>(reply)
  switch (p.optStr('status')) {
    case 'deferred':
      return { status: 'deferred', during: p.optInt('execution_generation') as Generation | null }
    case 'confirmation_required': {
      const token = p.optStr('confirm')
      const message = p.optStr('confirm_message') || CONFIRM_ASKED
      return token ? { status: 'confirm', confirm: { token, message } } : { status: 'confirm-without-token', message }
    }
    default:
      return COMMITTED
  }
}

const COMMITTED: ModelReceipt = { status: 'committed' }

const CONFIRM_ASKED = 'Hermes asks you to confirm this model before it switches.'

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

/** Whether the page's first row opens a turn, as `parseRows` reads it. If not, the turn its first rows belong to began on an older page. */
export const beginsAtTurn = (page: StoredTranscriptResult): boolean => usable(() => storedRow(page.rows[0], 0))?.opensTurn === true

interface TurnInProgress {
  readonly request: string | null
  readonly requestRow: number | null
  readonly began: Began | null
  readonly items: Item<'settled'>[]
  readonly rows: number[]
}

/**
 * Stored rows -> settled turns, shared by `parseSnapshot` and `parseTranscript` (a transcript
 * `message` row is a `display_messages` row). A user row opens a turn, unless it is words steered
 * into the turn before it, which are an item of that turn. Assistant text, tool rows and compaction
 * rows become its items. Stored rows carry no diff, so a history tool is `done` with
 * `diffs: []`. A turn that ends in an assistant answer is `complete`. A turn with no answer is
 * `unfinished` when it is the last one, else `lost`. Every turn lists the `row_id`s its rows carry.
 * An assistant row's reasoning becomes a sealed reasoning item above its text, with no times.
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
    if (row.opensTurn) turns.push({ request: row.text, requestRow: row.rowId, began: row.at === null ? null : { at: row.at, clock: 'hermes' }, items: [], rows: [] })
    if (row.items.length > 0 && turns.length === 0) turns.push({ request: null, requestRow: null, began: null, items: [], rows: [] })
    const turn = turns.at(-1)
    turn?.items.push(...row.items)
    if (row.rowId !== null) turn?.rows.push(row.rowId)
  })
  // A compaction row sits before the row it was stored on, so it can follow a turn's answer.
  const answered = (turn: TurnInProgress) => turn.items.findLast(item => item.kind !== 'notice' && item.kind !== 'reasoning')?.kind === 'text'
  const last = turns.at(-1)
  const open = last !== undefined && !answered(last) ? last : null
  return {
    turns: turns.flatMap((turn, index): SettledTurn[] => turn === open ? [] : [{
      id: `stored:${turn.rows[0] ?? `@${index}`}` as TurnId,
      request: turn.request === null ? null : { text: turn.request, inputId: null, rowId: turn.requestRow, attachments: [] },
      began: turn.began,
      items: turn.items,
      outcome: answered(turn) ? COMPLETE : LOST,
      rows: turn.rows,
      tokens: null
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
  // Words steered into a turn are stored as a user row of their own, among the turn's rows (agent/prompt_builder.py:585-592).
  const steers = role === 'user' && row.optStr('display_kind') === 'steer'
  const items = ((): Item<'settled'>[] => {
    if (row.optStr('row_kind') === 'compaction') return [{ kind: 'notice', what: 'said', tone: 'info', text }]
    if (steers) return [{ kind: 'steer', text }]
    if (role === 'assistant') {
      const reasoning = row.optStr('reasoning') ?? ''
      return [
        ...(reasoning.trim() === '' ? [] : [{ kind: 'reasoning', text: reasoning, sealed: true, startedAt: null, endedAt: null } as const]),
        ...(text.trim() === '' ? [] : [{ kind: 'text', markdown: text, sealed: true } as const])
      ]
    }
    if (role !== 'tool') return []
    const args = row.raw('args') ?? {}
    if (!isJsonObject(args)) throw new Unusable()
    const content = row.raw('content')
    return [{
      kind: 'tool',
      id: (row.optStr('tool_call_id') || `stored-tool:${index}`) as ToolId,
      name: row.optStr('name') || 'tool',
      args,
      status: { s: 'done', durationS: null, diffs: [], image: null, result: content === undefined ? NO_RESULT : parseToolResult(content, null, false) }
    }]
  })()
  return { opensTurn: role === 'user' && !steers, text, rowId, at, items }
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

/** `_branched_from` is on every row (tui_gateway/methods_projects.py:342), and is no key of the generated contract. */
type TreeSession = ProjectTreeSession & { _branched_from?: string | null }

/**
 * A chat is a version of its parent only when `_branched_from` names that parent, which a branch writes
 * (persistence/sqlite/authority/_mutation_publish.py:124).
 */
export function parseTreeRows(reply: ProjectsTreeResult): TreeRow[] | null {
  return usable(() => {
    const listed = (held: readonly unknown[] | null): readonly unknown[] => held ?? []
    const rows = new Map<SessionId, TreeRow>()
    for (const node of fields<ProjectsTreeResult>(reply).optList('projects') ?? []) {
      const project = fields<ProjectTreeNode>(node)
      const lanes = listed(project.optList('repos')).flatMap(repo => listed(fields<ProjectTreeRepo>(repo).optList('groups')))
      for (const value of [...listed(project.optList('previewSessions')), ...lanes.flatMap(lane => listed(fields<ProjectTreeLane>(lane).optList('sessions')))]) {
        const row = fields<TreeSession>(value)
        const id = row.str('id') as SessionId
        if (id === '' || row.optBool('archived') === true || rows.has(id)) continue
        const branchedFrom = row.optStr('_branched_from')
        const parent = branchedFrom !== null && branchedFrom !== '' && branchedFrom !== id && branchedFrom === row.optStr('parent_session_id') ? branchedFrom as SessionId : null
        rows.set(id, { id, parent, startedAt: row.optNum('started_at') ?? 0 })
      }
    }
    return [...rows.values()]
  })
}

export function parseSaid(reply: StoredTranscriptResult): { readonly said: readonly Said[]; readonly next: string | null; readonly reset: boolean } | null {
  return usable(() => {
    const page = fields<StoredTranscriptResult>(reply)
    const said = (page.optList('rows') ?? []).map((value): Said => {
      const row = fields<StoredTranscriptRow>(value)
      const [role, kind] = [row.str('role'), row.str('row_kind')]
      const key = JSON.stringify([role, kind, row.optStr('text'), row.raw('content') ?? null, row.optStr('tool_call_id'), row.optStr('name'), row.raw('args') ?? null])
      return { user: role === 'user' && kind === 'message', rowId: row.optInt('row_id'), key }
    })
    return { said, next: page.optStr('next_cursor'), reset: page.optBool('reset') === true }
  })
}

const words = (raw: unknown): string | null => (isString(raw) && raw.trim() !== '' ? raw.trim() : null)

type ProfileRow = Obj & { readonly name: string }

const profileRows = (reply: CanonicalProfilesResult): readonly ProfileRow[] =>
  (isObject(reply) && Array.isArray(reply.profiles) ? reply.profiles as readonly unknown[] : []).filter((row): row is ProfileRow => isObject(row) && isString(row.name) && row.name.trim() !== '')

/** The shape Hermes's Bots plugin writes: `BotMeta` in apps/desktop/src/plugins/hermes-bots/types.ts. */
const botMetaOf = (row: ProfileRow): Obj => (isObject(row.ui_meta) && isObject(row.ui_meta['hermes-bots']) ? row.ui_meta['hermes-bots'] : {})

const shownNameOf = (row: ProfileRow): string => words(botMetaOf(row).title) ?? words(row.display_name) ?? row.name

/** `profiles.list` as flat facts, in the reply's order, without the bots the user hid. */
export function parseBots(reply: CanonicalProfilesResult): readonly BotFacts[] {
  const seen = new Set<string>()
  return profileRows(reply).flatMap((row): BotFacts[] => {
    if (seen.has(row.name)) return []
    seen.add(row.name)
    const meta = botMetaOf(row)
    if (meta.hidden === true) return []
    // A row previews the chat a click opens, as Hermes's own bot row does (hermes-bots/bot-row.tsx:144).
    const session = isObject(row.canonical_session) ? row.canonical_session : row.last_session
    return [{
      id: row.name as BotId,
      name: shownNameOf(row),
      isDefault: row.is_default === true,
      section: words(meta.sectionName),
      preview: isObject(session) ? words(session.preview) : null,
      description: words(row.description),
      chat: isObject(row.canonical_session) ? titledId(row.canonical_session) : null,
      picture: row.has_avatar === true
    }]
  })
}

/**
 * The Bots plugin's record of one bot, which a rename writes back whole, since Hermes replaces a `ui_meta` key whole
 * (tui_gateway/methods_profiles.py:524-528). `revision` is null for a Hermes whose rows carry no `ui_meta_revisions`,
 * which predates the per-key check.
 */
export function parseBotRecord(reply: CanonicalProfilesResult, bot: BotId): { readonly name: string; readonly meta: Obj; readonly revision: number | null } | null {
  const row = profileRows(reply).find(held => held.name === bot)
  if (row === undefined) return null
  const revisions = row.ui_meta_revisions
  const revision = isObject(revisions) ? (Number.isInteger(revisions['hermes-bots']) ? Math.max(0, revisions['hermes-bots'] as number) : 0) : null
  return { name: shownNameOf(row), meta: botMetaOf(row), revision }
}

export function parseDetails(described: ProfilesDescribeResult, listed: CanonicalProfilesResult, bot: BotId): BotDetails | null {
  const record = parseBotRecord(listed, bot)
  if (record === null) return null
  const text = (raw: unknown) => (isString(raw) ? raw : '')
  return { bot, name: record.name, description: text(described.description), persona: text(described.soul), revision: record.revision }
}

/**
 * What a `profiles.configure` did with the sections sent. A clash wrote nothing of `ui_meta`; the other
 * sections are applied each on its own (tui_gateway/methods_profiles.py:387-410).
 */
export type Configured =
  | { readonly is: 'saved' }
  | { readonly is: 'clash' }
  | { readonly is: 'unsaved'; readonly sections: readonly string[] }

export function parseConfigured(reply: ProfilesConfigureResult, sent: readonly string[]): Configured {
  const applied: Obj = isObject(reply) && isObject(reply.applied) ? reply.applied : {}
  if (isObject(applied.ui_meta_conflicts) && Object.keys(applied.ui_meta_conflicts).length > 0) return { is: 'clash' }
  const sections = sent.filter(section => applied[section] !== true)
  return sections.length === 0 ? { is: 'saved' } : { is: 'unsaved', sections }
}

/** `profiles.get_asset`'s picture as the data URL Hermes builds (tui_gateway/methods_profiles.py:451-465), or null for none. */
export const parsePicture = (reply: ProfilesGetAssetResult): string | null =>
  isObject(reply) && reply.found === true && isString(reply.data) && reply.data.startsWith('data:image/') ? reply.data : null

/**
 * `profiles.create`'s reply. Its `name` echoes the typed one, so the bot is the last segment of `path`,
 * the profile directory Hermes made (tui_gateway/methods_profiles.py:341-347).
 */
export function parseCreated(reply: ProfilesCreateResult): BotCreated {
  const [leaf] = isString(reply.path) ? reply.path.split(/[\\/]/).filter(segment => segment !== '').reverse() : []
  return {
    bot: (leaf ?? canonicalBotId(isString(reply.name) ? reply.name : '')) as BotId,
    warnings: Array.isArray(reply.warnings) ? reply.warnings.flatMap(warning => words(warning) ?? []) : []
  }
}

/** A target that is not running answers with one of these, as a refusal or in a failed receipt (tui_gateway/methods_bot_relay.py:122). */
const NOT_RUNNING: ReadonlySet<string> = new Set(['runtime_unavailable', 'runtime_offline'])

/** What to say when `name` never got the message because of `reason`, or null for a reason with no words of its own. */
export function undeliveredWords(reason: string | null, name: string): string | null {
  if (reason === 'unknown_profile') return `${name} isn't on this Hermes any more, so it didn't get your message.`
  return NOT_RUNNING.has(reason ?? '') ? `${name} is offline, so it didn't get your message.` : null
}

const RECEIPT_WORDS: { readonly [status: string]: (name: string, receipt: Obj) => RelayState } = {
  settled: (name, { reply }) => (isString(reply) && reply.trim() !== '' ? { s: 'answered', reply } : { s: 'failed', words: `${name} sent back an empty reply.` }),
  failed: (name, { error, reason }) => {
    const said = words(error) ?? words(reason)
    return { s: 'failed', words: undeliveredWords(words(reason), name) ?? undeliveredWords(words(error), name) ?? (said === null ? `${name} couldn't answer.` : `${name} couldn't answer: ${said}`) }
  },
  cancelled: name => ({ s: 'failed', words: `${name}'s turn was stopped before it answered.` })
}

/** The receipt of `bot_relay.deliver` as the one answer of `name`. A receipt that is not final when the call returns carries no answer. */
export function parseDelivery(reply: CanonicalBotDeliverResult, name: string): RelayState {
  const receipt: Obj = isObject(reply) ? reply : {}
  const read = isString(receipt.status) && Object.hasOwn(RECEIPT_WORDS, receipt.status) ? RECEIPT_WORDS[receipt.status] : undefined
  return read?.(name, receipt) ?? { s: 'failed', words: `${name} got your message, but Hermes didn't pass back an answer.` }
}

/** The session a Bot Chat is now: `resolved_id` once a compression moved it, as Hermes's Bots plugin opens it (hermes-bots/canonical-chat.ts:530). */
const titledId = (row: Obj): SessionId | null => (words(row.resolved_id) ?? words(row.id)) as SessionId | null

/** The chat a `branch` made, as the receipt names it (persistence/sqlite/authority/_mutation_publish.py:152). null: the reply names none. */
export function parseBranched(reply: SessionMutateResult): SessionId | null {
  return (isObject(reply) ? words(reply.branched_session_id) : null) as SessionId | null
}

/** The reply to `session.list {title}`: the one session with that title (gateway/session_controls.py:617-638), or null. */
export function parseTitled(reply: CanonicalListResult): SessionId | null {
  const [row]: readonly unknown[] = isObject(reply) && Array.isArray(reply.sessions) ? reply.sessions : []
  return isObject(row) ? titledId(row) : null
}

const CANCEL_WHY: { readonly [reason: string]: CloseWhy } = {
  resolved: 'resolved', timeout: 'timeout', interrupted: 'interrupted', shutdown: 'withdrawn', session_closed: 'withdrawn'
}

/** `SettleReason` in Hermes's tools/connectors/contract.py. */
const SETTLED_BY: { readonly [reason: string]: CloseWhy } = { all_resolved: 'done', continue: 'done', deadline: 'timeout', interrupt: 'interrupted' }

const CONNECT = 'connection.request'

type Card = (params: Obj) => Pick<CardRequest, 'ask' | 'waitS'>

export const REQUESTS: { readonly [method: string]: Card } = {
  /** `SUDO_TIMEOUT_S`, gateway/session_sudo_prompt.py:19. The command is redacted by Hermes. */
  sudo: params => ({ waitS: 120, ask: { kind: 'secret', for: { is: 'sudo', command: stripAnsi(fields<SudoRequestParams>(params).optStr('command') ?? '') } } }),
  /** `SECRET_TIMEOUT_S`, gateway/session_secret_prompt.py:19 */
  secret: params => {
    const p = fields<SecretRequestParams>(params)
    return { waitS: 120, ask: { kind: 'secret', for: { is: 'env', name: p.str('env_var'), prompt: stripAnsi(p.str('prompt')) } } }
  },
  /** `UNLOCK_TIMEOUT_S`, `SAVE_LOGIN_TIMEOUT_S` and `CODE_TIMEOUT_S`, gateway/session_vault_prompt.py:22-24 */
  'vault.unlock_prompt': params => {
    const p = fields<VaultUnlockRequestParams>(params)
    return { waitS: 120, ask: { kind: 'secret', for: { is: 'vault', backend: p.str('backend'), name: p.str('display_name') } } }
  },
  'vault.save_login': params => {
    const p = fields<VaultSaveLoginRequestParams>(params)
    return { waitS: 180, ask: { kind: 'secret', for: { is: 'login', site: p.str('site'), origin: p.str('origin') } } }
  },
  'vault.code': params => {
    const p = fields<VaultCodeRequestParams>(params)
    return { waitS: 180, ask: { kind: 'secret', for: { is: 'code', site: p.optStr('site') || null, hint: p.optStr('hint') || null } } }
  },
  /**
   * The clarify tool's batch (gateway/session_clarify_batch.py) and a plugin command's choice, which
   * is one question `q0` (gateway/plugin_command_choice.py:71-78). Hermes waits its `clarify_timeout`
   * config for both (tools/clarify_gateway.py:294-301), which no frame carries.
   */
  clarify: params => {
    const p = fields<ClarifyRequestParams>(params)
    const questions = (p.optList('questions') ?? []).map(questionOf)
    if (questions.length === 0) throw new Unusable()
    const locked = p.optObj('answers') ?? {}
    const answers = Object.fromEntries(questions.flatMap(question => (question.id in locked ? [[question.id, answerOf(locked[question.id], question.multi)]] : [])))
    return { waitS: null, ask: { kind: 'questions', questions, answers } }
  },
  /** `timeout_seconds` is the operation's whole wait, counted from when it opened (tools/connectors/operation.py:270-281). */
  [CONNECT]: params => {
    const p = fields<ConnectionRequestPayload & ConnectionUpdatePayload>(params)
    const display = p.optObj('display')
    return {
      waitS: p.optNum('timeout_seconds'),
      ask: {
        kind: 'connect',
        rev: p.int('seq'),
        targets: (p.optList('targets') ?? []).flatMap(target => usable(() => targetOf(target)) ?? []),
        suggested: display === null ? [] : fields<ConnectionDisplay>(display).strs('suggested')
      }
    }
  }
}

function questionOf(value: unknown): Question {
  const q = fields<ClarifyQuestion>(value)
  return { id: q.str('qid'), text: stripAnsi(q.str('question')), choices: q.optList('choices')?.filter(isString) ?? [], multi: q.optBool('multi_select') ?? false }
}

/** A locked answer as Hermes holds it: null for skipped, else one string, which for several picks is a JSON array of labels (tools/clarify_tool.py:36-47). */
function answerOf(raw: unknown, multi: boolean): Answer {
  if (!isString(raw)) return null
  if (!multi) return [raw]
  try {
    const picks: unknown = JSON.parse(raw)
    return isStrings(picks) ? picks : [raw]
  } catch {
    return [raw]
  }
}

const TARGET_KINDS: readonly string[] = ['connector', 'mcp', 'plugin', 'skill'] satisfies ConnectTarget['kind'][]
const TARGET_ACTIONS: readonly string[] = ['authorize', 'connect', 'enable', 'install', 'reconnect'] satisfies ConnectTarget['action'][]
/** `TargetState` in Hermes's tools/connectors/contract.py. */
const TARGET_STATES: { readonly [state: string]: ConnectTarget['state'] } = {
  pending: 'pending', initiated: 'started', connected: 'connected', skipped: 'skipped', failed: 'failed', expired: 'expired', not_connected: 'not-connected'
}
const WEB_LINK = /^https?:\/\//i

function targetOf(value: unknown): ConnectTarget {
  const t = fields<ConnectionOperationTarget>(value)
  const kind = t.str('kind')
  const action = t.str('action')
  const state = TARGET_STATES[t.str('state')]
  if (!TARGET_KINDS.includes(kind) || !TARGET_ACTIONS.includes(action) || state === undefined) throw new Unusable()
  const url = t.optStr('connect_url')
  return {
    name: t.str('name'),
    kind: kind as ConnectTarget['kind'],
    action: action as ConnectTarget['action'],
    state,
    resolved: t.optBool('resolved') ?? false,
    detail: t.optStr('detail') || null,
    instructions: t.optStr('instructions') || null,
    url: url !== null && WEB_LINK.test(url) ? url : null,
    fields: (t.optList('required_env') ?? []).map(value => {
      const field = fields<ConnectionTargetEnvField>(value)
      return { name: field.str('name'), prompt: field.optStr('prompt') || null, required: field.optBool('required') ?? false, secret: field.optBool('secret') ?? false, initial: field.optStr('default') ?? '' }
    })
  }
}

function connectCard(payload: Obj, envelope: Obj): CardRequest {
  const id = fields<ConnectionRequestPayload>(payload).str('op_id')
  const request = parseServerRequest({ id, method: CONNECT, params: { ...payload, session_id: envelope.session_id } })
  if (request.kind !== 'card') throw new Unusable()
  return request
}

/**
 * A server-to-client request frame, an `open_requests` entry of a snapshot, or a connector card. Its
 * params carry the session (`gateway/session_server_requests.py:175`).
 */
export function parseServerRequest(request: { readonly id: string; readonly method: string; readonly params: unknown }): ServerRequest {
  const { method, params } = request
  const requestId = request.id as RequestId
  const named = isObject(params) ? params.session_id : undefined
  const sessionId = typeof named === 'string' && named !== '' ? named as SessionId : null
  const card = Object.hasOwn(REQUESTS, method) ? REQUESTS[method] : undefined
  if (card === undefined) return { kind: 'bridge', requestId, sessionId, method }
  const parsed = isObject(params) ? usable(() => card(params)) : null
  return sessionId === null || parsed === null ? { kind: 'unusable', requestId, method } : { kind: 'card', requestId, sessionId, method, ...parsed }
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

/**
 * The registry commands the gateway runs for a local chat when typed bare: every `read` and `control`
 * verdict of `command_verdict` in Hermes 0.23.3's gateway/session_commands.py. The catalog lists every
 * command and says nothing about this, and `command.dispatch` refuses the rest with `unsupported_command`.
 */
const GATEWAY_RUNS: ReadonlySet<string> = new Set([
  'title', 'approve', 'deny', 'goal', 'heartbeat', 'refine', 'review', 'loop', 'plan', 'moa', 'subgoal', 'status',
  'egress', 'context', 'whoami', 'profile', 'codex-runtime', 'personality', 'diff', 'verbose', 'footer', 'yolo',
  'approvals', 'reasoning', 'fast', 'voice', 'busy', 'autoprune', 'toolsets', 'skills', 'memory', 'bundles', 'learn',
  'init', 'cron', 'suggestions', 'blueprint', 'curator', 'kanban', 'commands', 'help', 'usage', 'login', 'topup',
  'insights', 'platforms', 'version', 'debug'
])

/** `/new` opens a chat, which only the hub can. The rest are rows of `OWN_COMMANDS`. */
const HIGHWING_RUNS: ReadonlySet<string> = new Set(['new', ...Object.keys(OWN_COMMANDS)])

/** `desktop` is `null` for a command a desktop app should offer, else the reason it should not. */
const offered = (meta: unknown) => isObject(meta) && (meta.desktop === null || meta.desktop === undefined)

export function parseCatalog(reply: CommandsCatalogResult): SlashCatalog {
  if (!isObject(reply)) return []
  const pairs = Array.isArray(reply.pairs) ? reply.pairs : []
  const skills = isObject(reply.skills) ? reply.skills : {}
  const meta = isObject(reply.commands) ? reply.commands : {}
  const plugins = isObject(reply.plugin_commands) ? reply.plugin_commands : {}
  const commands: SlashEntry[] = []
  const skillRows: SlashEntry[] = []
  const seen = new Set<string>()
  for (const pair of pairs) {
    const [key, description] = Array.isArray(pair) ? pair : []
    if (!isString(key) || !isString(description) || !key.startsWith('/') || seen.has(key)) continue
    const name = key.slice(1)
    if (name === '' || /\s/.test(name)) continue
    seen.add(key)
    if (Object.hasOwn(skills, key)) {
      skillRows.push({ kind: 'skill', name, description })
    } else if ((GATEWAY_RUNS.has(name) || HIGHWING_RUNS.has(name) || Object.hasOwn(plugins, name)) && offered(meta[key])) {
      commands.push({ kind: 'command', name, description })
    }
  }
  return [...commands, ...skillRows]
}

export type Directive =
  | { readonly do: 'show'; readonly text: string }
  | { readonly do: 'submit'; readonly text: string; readonly apiText: string; readonly note: string | null }

/**
 * The canonical runner answers `exec` (a plugin or quick command too), `send` and `skill`
 * (gateway/session_commands.py:422-533). The client submits `message` with its own input id; the gateway
 * never does. `null` for a directive Highwing cannot carry out.
 */
export function parseDirective(reply: CommandDispatchResult, typed: string): Directive | null {
  if (!isObject(reply)) return null
  switch (reply.type) {
    case 'exec':
      return { do: 'show', text: stripAnsi(reply.output ?? '').trim() }
    case 'send':
    case 'skill': {
      if (!isString(reply.message) || reply.message.trim() === '') return null
      const display = isString(reply.display) && reply.display.trim() !== '' ? reply.display.trim() : typed
      const note = isString(reply.notice) && reply.notice.trim() !== '' ? stripAnsi(reply.notice).trim() : null
      return { do: 'submit', text: display, apiText: reply.message, note }
    }
    default:
      return null
  }
}
