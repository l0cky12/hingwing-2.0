/**
 * The gateway a fixture is played from: Hermes's canonical dispatcher and the handlers the client
 * talks to, reduced to one story session and several chats per bot: its Bot Chat, the chats the
 * header seeds, and the chats an untitled create makes. Each rule cites the Hermes 0.23.3 source it
 * copies.
 */
import type { SessionEvent } from '../domain/reduce'
import { GATEWAY_PROTOCOL, type Clock, type Reach } from '../wire/link'
import { parseEvent } from '../wire/parse'
import type { ChatSeed, Fixture, FixtureStep } from './fixture'
import { checkParams } from './params'

export interface Peer {
  write(frame: unknown): void
  close(code: number): void
}

export interface GatewayOptions {
  readonly clock: Clock
  readonly timing: 'instant' | 'recorded'
  readonly ringFrames: number
  readonly drop: { readonly afterPush: number; readonly missed: number } | null
  readonly onReceived?: (frame: unknown) => void
}

/** The replay ring's bound per session (Hermes's tui_gateway/event_replay.py:30). */
export const RING_FRAMES = 512
export const ABNORMAL_CLOSE = 1006

type Obj = Readonly<Record<string, unknown>>
type Params = Obj & { readonly seq: number }
type PushStep = Extract<FixtureStep, { push: unknown }>

const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''
/** Python's `type(value) is int`: a whole number, and not a boolean. */
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)

type WireError = { readonly code: number; readonly message: string; readonly data?: unknown }

const epochOf = (step: FixtureStep): unknown => ('push' in step && isObject(step.push) && isObject(step.push.params) ? step.push.params.replay_epoch : undefined)

/** A handler's refusal, as `AuthorityRefusal` reaches the wire (gateway/session_controls.py:401-406). */
class Refused extends Error {
  constructor(reason: string, readonly wire: WireError = { code: 4001, message: reason, data: { reason } }) {
    super(reason)
  }
}

class Later {
  constructor(readonly ms: number, readonly result: unknown) {}
}

/** A socket's `AuthorityConnection` (gateway/session_controls.py:157-190). */
interface Socket {
  readonly peer: Peer
  readonly reach: Reach
  readonly subscriptionId: string
  readonly subscriptions: Map<string, string>
  /** session id -> the seq this socket's last `session.events.since` answered. Spent by the next resume. */
  readonly replayCursors: Map<string, number>
}

interface Model { readonly model: string; readonly provider: string | null }

interface View {
  running: boolean
  generation: number
  revision: number
  title: string
  pending: readonly unknown[]
  readonly prompts: Map<string, Obj>
  model: Model | null
  /** A model switch asked for during a turn. It commits when the turn ends (gateway/session_mutations.py:134-143). */
  deferred: Model | null
  switchesCommitted: number
  branchesCommitted: number
  turnsEnded: number
  /** null until the header or a recorded frame names it. */
  yolo: boolean | null
}

const TRACK: { readonly [T in SessionEvent['type']]?: (view: View, event: Extract<SessionEvent, { type: T }>, payload: Obj) => void } = {
  'turn.started': view => { view.running = true },
  'turn.ended': view => {
    view.running = false
    view.turnsEnded++
    view.prompts.clear()
  },
  'prompt.opened': (view, event, payload) => void view.prompts.set(event.id, payload),
  'prompt.settled': (view, event) => void view.prompts.delete(event.id),
  'prompts.cancelled': (view, event) => event.ids.forEach(id => view.prompts.delete(id)),
  meta: (view, event, payload) => {
    if (event.title !== undefined) view.title = event.title
    if (event.revision !== undefined) view.revision = event.revision
    if (event.yolo !== undefined) view.yolo = event.yolo
    if (Array.isArray(payload.pending)) view.pending = payload.pending
  }
}

type Drop =
  | { readonly at: 'armed'; readonly afterPush: number; readonly missed: number }
  | { readonly at: 'holding'; readonly step: PushStep }
  | { readonly at: 'spent' }

type Handler = (gateway: ScriptedGateway, socket: Socket, params: Obj, routed: string) => unknown
type Check = (gateway: ScriptedGateway, socket: Socket, params: Obj, routed: string) => string | null

const known: Check = (gateway, _socket, params, routed) => (gateway.plays(params, routed) ? null : 'not_found')
const attached: Check = (gateway, socket, params, routed) =>
  gateway.plays(params, routed) && socket.subscriptions.has(gateway.sessionId) ? null : 'permission_denied'
const exactly = (...keys: readonly string[]): Check => (_gateway, _socket, params) =>
  Object.keys(params).length === keys.length && keys.every(key => key in params) ? null : 'invalid_params'
const strings = (allowed: readonly string[]) => (params: Obj) =>
  Object.entries(params).every(([key, value]) => allowed.includes(key) && typeof value === 'string')
/** `_parse` in gateway/session_commands.py:148-156: known keys, all strings, and one word for a name. */
const dispatchable: Check = (_gateway, _socket, params) =>
  strings(['session_id', 'profile', 'name', 'arg'])(params) && String(params.name ?? '').trim().replace(/^\//, '').split(/\s+/).filter(Boolean).length === 1
    ? null
    : 'invalid_params'
const runningGeneration: Check = (gateway, _socket, params) =>
  isInt(params.execution_generation) && gateway.view.running && gateway.view.generation === params.execution_generation ? null : 'stale_generation'

const submissionId: Check = (_gateway, _socket, params) => (isText(params.submission_id || params.input_id) ? null : 'invalid_params')

/**
 * The calls a story answers, each with the checks its handler makes first, in the handler's order.
 * A session verb on a socket that has not attached the session is `permission_denied` for a submit
 * and an answer, whether or not the session exists. An interrupt needs no attachment
 * (gateway/session_authority.py:972-976).
 */
const STORY_CHECKS: Readonly<Record<string, readonly Check[]>> = {
  /** gateway/session_controls.py:884-895 */
  'prompt.submit': [attached, submissionId],
  /** gateway/session_controls.py:995-998, gateway/session_authority.py:1106-1117 */
  'approval.respond': [exactly('session_id', 'execution_generation', 'prompt_id', 'choice'), attached, runningGeneration],
  'clarify.respond': [exactly('session_id', 'execution_generation', 'prompt_id', 'answer'), attached, runningGeneration],
  'session.interrupt': [known, (gateway, _socket, params) => (gateway.view.generation === params.execution_generation ? null : 'stale_generation')],
  /** gateway/session_commands.py:422-425 */
  'command.dispatch': [known, dispatchable]
}
const ANY_STORY_CALL: readonly Check[] = [known]

/** The strict session verbs that drop `profile` before their key check (gateway/session_controls.py:114-120). */
const PROFILE_IMPLICIT: ReadonlySet<string> = new Set([
  'session.create', 'session.list', 'session.info', 'session.resume', 'session.detach', 'prompt.submit', 'prompt.receipt', 'prompt.cancel',
  'prompt.resolve_unknown', 'prompt.steer_queued', 'prompt.replace_queued', 'session.interrupt', 'session.events.since', 'session.mutate',
  'session.stats', 'session.account_usage', 'approval.respond', 'clarify.respond'
])

/** The title Hermes gives the one chat a bot's row opens (tui_gateway/methods_profiles.py:150-181). */
const BOT_CHAT = 'Bot Chat'
/** What `profiles.list` says about a profile's sessions (gateway/session_group_controls.py:405-406). */
const SESSION_FIELDS: ReadonlySet<string> = new Set(['last_session', 'worker_session', 'canonical_session'])

interface Stream {
  readonly ring: readonly Params[]
  readonly epoch: string
}

/** The `approval.request` payload a seeded chat's turn waits on. No handler answers it. */
interface SeededApproval {
  readonly kind: 'approval'
  readonly prompt_id: string
  readonly execution_generation: number
  readonly command: string
  readonly description: string
  readonly choices: readonly string[]
}

class EchoChat implements Stream {
  readonly ring: Params[] = []
  readonly rows: Obj[] = []
  readonly epoch: string
  generation = 0
  /** Moved by each branch made from this chat, as it moves the story's. */
  revision = 0
  asking: SeededApproval | null = null
  yolo = false

  /** `hidden`: out of `session.list` unless it asks for hidden chats, as a Bot Chat is (hermes-bots/canonical-chat.ts:319). */
  constructor(readonly id: string, readonly profile: string, readonly title: string, readonly hidden = false) {
    this.epoch = `${id}-epoch`
  }

  get model(): Model {
    return { model: `${this.profile}-model`, provider: null }
  }

  /** A branch copies a tool row with no id, so the next id is not the row count. */
  get nextRowId(): number {
    return Math.max(0, ...this.rows.map(row => (isInt(row.row_id) ? row.row_id : 0))) + 1
  }

  /** Only a seeded approval keeps a turn open: an echo turn ends before the next frame is read. */
  get running(): boolean {
    return this.asking !== null
  }

  /** A row of `session.list` (gateway/session_listing.py:67-70). `picker` adds what a picker shows (gateway/session_picker_fields.py:24-43). */
  listRow(picker: boolean): Obj {
    const said = (row: Obj | undefined) => (typeof row?.timestamp === 'number' ? row.timestamp : null)
    return {
      session_id: this.id, id: this.id, resolved_id: this.id, title: this.title, source: 'gui', started_at: said(this.rows[0]),
      message_count: this.rows.length, model: this.model.model, running: this.running,
      ...(picker ? { preview: this.rows.at(-1)?.text ?? null, last_active_at: said(this.rows.at(-1)) } : {})
    }
  }
}

function seeded(profile: string, seed: ChatSeed): EchoChat {
  const chat = new EchoChat(seed.id, profile, seed.title, seed.hidden === true)
  seed.rows.forEach(({ role, text }, at) => chat.rows.push({ role, text, timestamp: seed.last_active, row_id: at + 1 }))
  if (seed.asking === undefined) return chat
  chat.generation = 1
  chat.asking = {
    kind: 'approval', prompt_id: `${seed.id}-approval`, execution_generation: 1, command: seed.asking.command,
    description: seed.asking.description, choices: ['once', 'deny', 'session', 'always']
  }
  return chat
}

/**
 * `session.events.since` (gateway/session_controls.py:805-822, gateway/session_events.py:126-138).
 * `cursor` is the seq a resume on the same socket continues from, or null when the client needs a snapshot.
 */
function replayOf({ ring, epoch }: Stream, ringFrames: number, params: Obj, openRequests: readonly unknown[]): { readonly reply: Obj; readonly cursor: number | null } {
  const { last_sequence: sequence = params.last_seen ?? 0, replay_epoch: asked } = params
  if (!isInt(sequence) || sequence < 0 || (asked !== undefined && asked !== null && typeof asked !== 'string')) throw new Refused('invalid_params')
  const latest = ring.at(-1)?.seq ?? 0
  const missing = asked !== epoch || sequence > latest || sequence < latest - ringFrames
  const events = missing ? [] : ring.filter(frame => frame.seq > sequence)
  return {
    reply: {
      events, latest_seq: latest, last_sequence: latest, epoch, replay_epoch: epoch,
      truncated: missing, snapshot_required: missing, count: events.length, open_requests: openRequests
    },
    cursor: missing ? null : events.at(-1)?.seq ?? sequence
  }
}

interface Held extends Stream {
  readonly id: string
  readonly rows: readonly unknown[]
  readonly running: boolean
  readonly generation: number
  readonly revision: number
  readonly title: string
  readonly model: Model | null
  readonly yolo: boolean | null
  readonly pending: readonly unknown[]
  readonly prompts: readonly unknown[]
  readonly openRequests: readonly unknown[]
}

/** The snapshot `session.resume` answers (gateway/session_controls.py:659-769), read at the stream's watermark. */
function snapshotOf(held: Held, subscriptionId: string, params: Obj): Obj {
  const omit = params.omit_messages === true
  const { model } = held
  return {
    session_id: held.id, stored_session_id: held.id,
    messages: omit ? [] : held.rows, ...(omit ? { messages_omitted: true } : {}), message_count: held.rows.length, todo_state: null,
    ...(params.display_projection === true ? { display_messages: held.rows } : {}),
    running: held.running, authority_epoch: 1, replay_epoch: held.epoch, last_sequence: held.ring.at(-1)?.seq ?? 0,
    subscription_id: subscriptionId, revision: held.revision, execution_generation: held.generation,
    pending: held.pending, prompts: held.prompts,
    info: {
      desktop_protocol: GATEWAY_PROTOCOL, title: held.title,
      ...(model === null ? {} : { model: model.model, ...(model.provider === null ? {} : { provider: model.provider }) }),
      ...(held.yolo === null ? {} : { yolo: held.yolo })
    },
    pending_connection: null, open_requests: held.openRequests
  }
}

/** gateway/session_controls.py:386-392 */
const unknownMethod = (method: string) => new Refused('unknown_method', { code: -32601, message: `unknown method: ${method}`, data: { reason: 'unknown_method' } })

/** hermes_constants.py:414 */
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
/** hermes_cli/profiles.py:279 */
const RESERVED_NAMES: ReadonlySet<string> = new Set(['hermes', 'default', 'test', 'tmp', 'root', 'sudo'])
/** hermes_cli/profiles.py:348-365 */
const NAME_RULE = "Use lowercase letters, numbers, '-' or '_', starting with a letter or number, up to 64 characters"

/** `repr` of a Python str, which picks the quote that needs no escape. */
function pyRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'"
  return `${quote}${text.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`)}${quote}`
}

/** `_suggest_profile_name` (hermes_cli/profiles.py:354-357). */
function suggestedName(name: string): string {
  const candidate = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 64)
  return PROFILE_ID.test(candidate) ? candidate : 'my-work'
}

/**
 * A refused create (tui_gateway/methods_profiles.py:332-339): `error.message` is the whole reason, and `data`
 * repeats it in parts of at most 200 characters (hermes_cli/profile_provision.py:190-202).
 */
const refusedCreate = (code: number, message: string, type: string, text: string = message) =>
  new Refused(message, { code, message, data: { type, message_parts: text.match(/[\s\S]{1,200}/g) ?? [] } })

/** The reason `create_profile` refuses a name (hermes_cli/profiles.py:1372-1373 and :398-415), or null. */
function nameRefusal(canon: string, taken: (name: string) => boolean): Refused | null {
  if (canon === 'default') return refusedCreate(4062, "Cannot create a profile named 'default' — it is the built-in profile (~/.hermes).", 'ValueError')
  if (!PROFILE_ID.test(canon)) {
    const suggestion = suggestedName(canon)
    return refusedCreate(4062, `${pyRepr(canon)} is not a valid profile name. ${NAME_RULE} (for example: ${suggestion}). Then run \`hermes profile create ${suggestion}\`.`, 'ValueError')
  }
  if (RESERVED_NAMES.has(canon)) {
    return refusedCreate(4062, `Profile name ${pyRepr(canon)} is reserved — it collides with either the Hermes installation itself or a common system binary.  Pick a different name.`, 'ValueError')
  }
  if (taken(canon)) {
    return refusedCreate(4062, `A profile named '${canon}' already exists. Switch to it with \`hermes profile use ${canon}\`, see all profiles with \`hermes profile list\`, or choose a different name.`, 'FileExistsError')
  }
  return null
}

/** What a branch reads of its parent and moves in it: the story session, or a chat beside it. */
interface Parent {
  readonly id: string
  readonly profile: string
  readonly title: string
  readonly rows: readonly Obj[]
  readonly generation: number
  readonly busy: boolean
  readonly revision: number
  /** Moves the parent's revision and publishes the receipt. Answers the new revision. */
  commit(result: Obj): number
}

/** JSON with every object's keys in order, so two requests that mean the same thing digest the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (!isObject(value)) return JSON.stringify(value) ?? 'null'
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

/**
 * The rows a branch through `through` copies: every row up to it, and the tool rows that follow an assistant row.
 * null: no row has that id.
 */
function rowsThrough(rows: readonly Obj[], through: number): readonly Obj[] | null {
  const at = rows.findIndex(row => row.row_id === through)
  if (at < 0) return null
  let end = at + 1
  if (rows[at]?.role === 'assistant') while (rows[end]?.role === 'tool') end++
  return rows.slice(0, end)
}

function offered(models: Obj): Model[] {
  const rows = Array.isArray(models.providers) ? models.providers.filter(isObject) : []
  return rows.flatMap(row => (Array.isArray(row.models) ? row.models.filter(isText) : []).map(model => ({ model, provider: isText(row.slug) ? row.slug : null })))
}

/** `tui_usage` (gateway/session_usage.py:130-147): the status-bar view of a `session.stats` dict, less what Highwing never reads. */
function usageView(stats: Obj): Obj {
  const count = (key: string) => (isInt(stats[key]) ? stats[key] : 0)
  const max = count('context_length')
  const used = Math.min(count('last_prompt_tokens'), max)
  const source = isText(stats.context_source) ? stats.context_source : 'provider_usage'
  return {
    model: isText(stats.model) ? stats.model : '', input: count('input_tokens') || count('prompt_tokens'),
    output: count('output_tokens') || count('completion_tokens'), reasoning: count('reasoning_tokens'),
    prompt: count('prompt_tokens'), completion: count('completion_tokens'), total: count('total_tokens'), calls: count('api_calls'),
    ...(used === 0 ? {} : {
      context_used: used, context_max: max, context_percent: Math.max(0, Math.min(100, Math.round(used / max * 100))),
      context_source: source, context_estimated: source !== 'provider_usage'
    })
  }
}

const YOLO_WORDS: Readonly<Record<string, boolean>> = { 1: true, on: true, true: true, 0: false, off: false, false: false }

const tokenFor = ({ model }: Model) => `confirm-${model}`

const modelOf = (value: Obj | undefined): Model | null =>
  value !== undefined && isText(value.model) ? { model: value.model, provider: isText(value.provider) ? value.provider : null } : null

/** gateway/session_controls.py:779-803. The subscription is looked up on the routed profile's connection. */
const detach: Handler = (gateway, socket, params, routed) => {
  const { session_id, subscription_id } = params
  if (!isText(session_id) || !isText(subscription_id)) throw new Refused('invalid_params')
  const detached = gateway.profileOf(session_id) === routed && socket.subscriptions.get(session_id) === subscription_id
  if (detached) socket.subscriptions.delete(session_id)
  return { session_id, subscription_id, detached }
}

/** The operations of `session.mutate` the gateway answers itself, as the story does not await them. */
const MUTATIONS: Readonly<Record<string, (gateway: ScriptedGateway, params: Obj, routed: string) => unknown>> = {
  model: (gateway, params, routed) => gateway.switchModel(params, routed),
  branch: (gateway, params, routed) => {
    gateway.authorize(params, routed)
    return gateway.branch(gateway.storyParent(), params, routed)
  }
}

const HANDLERS: Readonly<Record<string, Handler>> = {
  /** tui_gateway/methods_voice.py:526-545 */
  'client.capabilities': () => ({ server_requests: ['clarify', 'secret', 'sudo'], declines_not_shown: true, canonical_clarify_batch: true }),
  /** gateway/session_controls.py:571-590 */
  'runtime.describe': (gateway, _socket, params) => {
    if (Object.keys(params).length > 0) throw new Refused('invalid_params')
    return gateway.fixture.header.describe
  },
  /** gateway/session_controls.py:599-656 */
  'session.list': (gateway, _socket, params, routed) => {
    const { limit = 200, scope = 'live' } = params
    if (!isInt(limit) || limit < 1 || limit > 200 || (scope !== 'live' && scope !== 'stored') || ('title' in params && 'scope' in params)) {
      throw new Refused('invalid_params')
    }
    if ('title' in params) return { sessions: params.title === BOT_CHAT ? gateway.titledRows(routed) : [], scope: 'stored' }
    if (routed !== gateway.home) return gateway.listed(routed, scope, params.include_hidden === true, params.picker === true)
    if (scope === 'stored') return { sessions: gateway.branchRows(routed, params.picker === true), scope, next_cursor: null }
    const { list } = gateway.fixture.header
    const rows = isObject(list) && Array.isArray(list.sessions) ? list.sessions.filter(isObject) : []
    return { sessions: rows.map(row => (row.session_id === gateway.sessionId ? { ...row, running: gateway.view.running } : row)), scope }
  },
  /** gateway/session_discovery.py:8-35 */
  'commands.catalog': (gateway, _socket, params, routed) => {
    const { catalog } = gateway.fixture.header
    if (catalog === undefined) throw new Refused('unknown_method', { code: -32601, message: 'unknown method: commands.catalog', data: { reason: 'unknown_method' } })
    if (!strings(['session_id', 'profile'])(params)) throw new Refused('invalid_params')
    if (params.session_id !== undefined && params.session_id !== '') gateway.authorize(params, routed)
    return catalog
  },
  /**
   * gateway/session_controls.py:505-569: a create ends in a resume of the session, and a titled one
   * is get-or-create. `hidden` is popped before the field check, so it needs no place in `runtime.describe`.
   */
  'session.create': (gateway, socket, params, routed) => {
    if ('hidden' in params && typeof params.hidden !== 'boolean') throw new Refused('invalid_params')
    if (params.title === undefined) return gateway.open(socket, gateway.newChat(routed, params.request_id), {})
    if (params.title !== BOT_CHAT) throw new Refused('unsupported_command')
    return gateway.botChat(socket, routed) ?? gateway.open(socket, gateway.newBotChat(routed), {})
  },
  'session.resume': (gateway, socket, params, routed) => {
    gateway.authorize(params, routed)
    return gateway.attach(socket, params)
  },
  'session.events.since': (gateway, socket, params, routed) => {
    gateway.authorize(params, routed)
    const { reply, cursor } = replayOf(gateway, gateway.options.ringFrames, params, gateway.openRequestList())
    if (cursor !== null) socket.replayCursors.set(gateway.sessionId, cursor)
    gateway.releaseHeld()
    return reply
  },
  /** gateway/session_config.py:11-13 */
  'model.options': (gateway, _socket, params, routed) => {
    if (params.session_id !== undefined && params.session_id !== null) gateway.authorize(params, routed)
    return gateway.modelMenu(gateway.view.model)
  },
  /** gateway/session_usage.py:265-274 */
  'session.stats': (gateway, _socket, params, routed) => {
    const { usage } = gateway.fixture.header
    if (usage === undefined) throw unknownMethod('session.stats')
    gateway.authorize(params, routed)
    return gateway.view.turnsEnded === 0 ? usage.before : usage.after
  },
  /** gateway/session_tui_reads.py:135-149 */
  'session.context_breakdown': (gateway, _socket, params, routed) => {
    const { usage } = gateway.fixture.header
    if (usage === undefined) throw unknownMethod('session.context_breakdown')
    gateway.authorize(params, routed)
    return usage.breakdown
  },
  /** tui_gateway/methods_profiles.py:271-290 */
  'profiles.list': (gateway, socket) => gateway.roster(socket),
  /** tui_gateway/methods_profiles.py:296-347 */
  'profiles.create': (gateway, socket, params) => gateway.create(socket, params),
  'session.mutate': (gateway, socket, params, routed) => {
    const mutation = typeof params.operation === 'string' && Object.hasOwn(MUTATIONS, params.operation) ? MUTATIONS[params.operation] : undefined
    return mutation === undefined ? gateway.story(socket, 'session.mutate', params, routed) : mutation(gateway, params, routed)
  },
  'config.set': (gateway, _socket, params, routed) => gateway.setYolo(params, routed, null),
  'session.detach': detach,
  /**
   * `_delivery_params` (gateway/session_bot.py:804-827), with the id rule of tools/bot_live_delivery.py:131-134,
   * then the target: a profile that is not running refuses `runtime_unavailable` (tui_gateway/methods_bot_relay.py:122).
   * The call answers once the target's turn ends, with the receipt `_result` builds (gateway/session_bot.py:480-512).
   */
  'bot_relay.deliver': (gateway, _socket, params, routed) => {
    const { id, message } = params
    if (typeof id !== 'string' || !/^[0-9a-f]{32,64}$/.test(id) || typeof message !== 'string' || message.trim() === '') throw new Refused('invalid_params')
    const script = gateway.fixture.header.relay?.[routed] ?? { refuse: 'runtime_unavailable' }
    if ('refuse' in script) throw new Refused(script.refuse)
    const sessionId = `bot-chat-${routed}`
    return new Later(script.delay_ms ?? 0, {
      status: 'settled', delivery_id: id, profile_home: `/fixture/profiles/${routed}`, session_id: sessionId, message,
      admission_id: `${sessionId}-admission-${id.slice(0, 8)}`, reply: script.reply
    })
  }
}

type ChatHandler = (gateway: ScriptedGateway, socket: Socket, params: Obj, routed: string, chat: EchoChat) => unknown

const CHAT_HANDLERS: Readonly<Record<string, ChatHandler>> = {
  'session.stats': () => { throw unknownMethod('session.stats') },
  'session.resume': (gateway, socket, params, _routed, chat) => gateway.open(socket, chat, params),
  'session.events.since': (gateway, _socket, params, _routed, chat) => replayOf(chat, gateway.options.ringFrames, params, []).reply,
  /** gateway/session_controls.py:884-895 */
  'prompt.submit': (gateway, socket, params, routed, chat) => {
    if (!socket.subscriptions.has(chat.id)) throw new Refused('permission_denied')
    const inputId = params.submission_id || params.input_id
    if (!isText(inputId)) throw new Refused('invalid_params')
    return gateway.echo(chat, inputId, String(params.text ?? ''), routed)
  },
  'model.options': (gateway, _socket, _params, _routed, chat) => gateway.modelMenu(chat.model),
  'config.set': (gateway, _socket, params, routed, chat) => gateway.setYolo(params, routed, chat),
  'session.mutate': (gateway, _socket, params, routed, chat) => {
    if (params.operation !== 'branch') throw new Refused('unsupported_command')
    return gateway.branch(gateway.chatParent(chat), params, routed)
  },
  'session.detach': detach
}

export class ScriptedGateway {
  readonly sessionId: string
  /** The profile a frame with no `profile` is for, and the one the story session lives in: the `is_default` row of the header's profiles. */
  readonly home: string
  /** What a socket reaches when nothing says otherwise: the header's `reach`, else every profile. */
  readonly reach: Reach
  readonly epoch: string
  readonly ring: Params[] = []
  readonly view: View
  readonly received: unknown[] = []
  readonly done: Promise<void>
  dials = 0
  step = 0
  finished = false
  /** Chats a `branch` made. A retry that Hermes answers from its receipt makes none. */
  branchesMade = 0

  private stored: readonly unknown[]
  private readonly profiles: Obj[]
  private readonly botChats = new Map<string, EchoChat>()
  private readonly newChats = new Map<string, EchoChat>()
  private readonly branchChats: EchoChat[] = []
  private readonly receipts = new Map<string, { readonly digest: string; readonly result: Obj }>()
  private readonly seeded: readonly EchoChat[]
  private readonly storyIsBotChatOf: string | null
  private readonly afterReply: (() => void)[] = []
  private readonly sockets = new Set<Socket>()
  private readonly openRequests = new Map<string, { readonly method: string; readonly params: unknown }>()
  private drop: Drop
  private delivered = 0
  private seqShift = 0
  private scheduled = false
  private settle!: { resolve(): void; reject(error: Error): void }

  constructor(readonly fixture: Fixture, readonly options: GatewayOptions) {
    this.sessionId = fixture.header.sessionId
    this.reach = fixture.header.reach ?? 'host'
    this.stored = fixture.header.stored
    this.drop = options.drop === null ? { at: 'spent' } : { at: 'armed', ...options.drop }
    const { models } = fixture.header
    this.view = {
      running: false, generation: 0, revision: 0, title: '', pending: [], prompts: new Map(),
      model: modelOf(isObject(models) ? models : undefined), deferred: null, switchesCommitted: 0, branchesCommitted: 0, turnsEnded: 0, yolo: fixture.header.yolo ?? null
    }
    this.epoch = fixture.steps.map(epochOf).find(isText) ?? 'fixture-epoch'
    this.done = new Promise((resolve, reject) => { this.settle = { resolve, reject } })
    this.done.catch(() => {})
    const { profiles } = fixture.header
    this.profiles = isObject(profiles) && Array.isArray(profiles.profiles) ? profiles.profiles.filter(isObject) : []
    this.home = this.profiles.map(row => (row.is_default === true ? row.name : undefined)).find(isText) ?? 'default'
    this.storyIsBotChatOf = fixture.header.homeBotChat === false ? null : this.home
    for (const { name, canonical_session: named } of this.profiles) {
      const id = isObject(named) ? named.resolved_id || named.id : undefined
      if (!isText(name) || !isObject(named) || !isText(id) || name === this.storyIsBotChatOf) continue
      const chat = new EchoChat(id, name, BOT_CHAT, true)
      if (isText(named.preview)) chat.rows.push({ role: 'assistant', text: named.preview, timestamp: named.last_active ?? null, row_id: 1 })
      this.botChats.set(name, chat)
    }
    this.seeded = Object.entries(fixture.header.chats ?? {}).flatMap(([profile, seeds]) => seeds.map(seed => seeded(profile, seed)))
  }

  get latest(): number {
    return this.ring.at(-1)?.seq ?? 0
  }

  /** A new socket, opened with a ticket of that reach. The gateway speaks first (tui_gateway/ws.py:656-664). */
  accept(peer: Peer, reach: Reach = this.reach): { text(text: string): void; closed(): void } {
    const socket: Socket = { peer, reach, subscriptionId: `subscription-${++this.dials}`, subscriptions: new Map(), replayCursors: new Map() }
    this.sockets.add(socket)
    peer.write({
      jsonrpc: '2.0', method: 'event',
      params: { type: 'gateway.ready', payload: { skin: {}, change_events: true, heartbeat: true, replay_epoch: 'fixture-process', session_authority: true } }
    })
    return {
      text: text => {
        if (this.sockets.has(socket)) this.handle(socket, JSON.parse(text) as unknown)
      },
      closed: () => void this.sockets.delete(socket)
    }
  }

  private handle(socket: Socket, frame: unknown): void {
    this.received.push(frame)
    this.options.onReceived?.(frame)
    if (!isObject(frame)) return
    const { id, method } = frame
    if (typeof method !== 'string') {
      // A viewer's answer to a server request settles it only from a socket attached to its session
      // (gateway/session_server_requests.py:53-75), and gets no reply.
      const open = typeof id === 'string' ? this.openRequests.get(id) : undefined
      if (open !== undefined && socket.subscriptions.has(this.sessionId)) this.openRequests.delete(id as string)
      return
    }
    // Answered by the read loop, ahead of every handler (tui_gateway/ws.py:710-714).
    if (method === 'gateway.ping') return socket.peer.write({ jsonrpc: '2.0', id, result: { ok: true } })
    const reply = this.dispatch(socket, method, frame.params ?? {})
    if ('result' in reply && reply.result instanceof Later) {
      const { ms, result } = reply.result
      this.options.clock.setTimeout(() => {
        if (this.sockets.has(socket)) socket.peer.write({ jsonrpc: '2.0', id, result })
      }, ms)
    } else {
      socket.peer.write({ jsonrpc: '2.0', id, ...reply })
    }
    for (const publish of this.afterReply.splice(0)) publish()
    this.pump()
  }

  /**
   * `AuthorityConnection.dispatch` (gateway/session_controls.py:313-410): the profile the frame
   * names, then the closed key set, then the handler, then its refusal. A method nobody declares
   * is JSON-RPC's -32601.
   */
  private dispatch(socket: Socket, method: string, raw: unknown): { result: unknown } | { error: WireError } {
    const refusal = (reason: string, data: Obj = {}): { error: WireError } => ({ error: { code: 4001, message: reason, data: { reason, ...data } } })
    // A Hermes without the bot relay declares none of its methods, so no param check is reached.
    if (method.startsWith('bot_relay.') && this.fixture.header.relay === undefined) return { error: unknownMethod(method).wire }
    if (!isObject(raw)) return refusal('invalid_params')
    const { profile, ...unscoped } = raw
    const named = isText(profile)
    // gateway/session_controls.py:197-223: only a host-scoped socket reaches a profile other than its own, and only one this gateway serves.
    if (named && profile !== this.home && (socket.reach === 'profile' || !this.profiles.some(row => row.name === profile))) return refusal('profile_mismatch')
    const routed = named ? profile : this.home
    // gateway/session_controls.py:336-349: the strict session verbs never carried the key, so it is dropped before their key check.
    const params = named && PROFILE_IMPLICIT.has(method) ? unscoped : raw
    const fields = checkParams(method, params)
    if (fields !== undefined && fields.length > 0) return refusal('invalid_params', { fields })
    const chat = this.echoChats().find(held => held.id === params.session_id && held.profile === routed)
    const handler = HANDLERS[method]
    if (handler === undefined && fields === undefined) return { error: { code: -32601, message: `unknown method: ${method}`, data: { reason: 'unknown_method' } } }
    try {
      if (chat !== undefined) return { result: this.chat(socket, method, params, routed, chat) }
      return { result: handler === undefined ? this.story(socket, method, params, routed) : handler(this, socket, params, routed) }
    } catch (error) {
      if (error instanceof Refused) return { error: error.wire }
      throw error
    }
  }

  /** Whether the frame is for the story session, on the profile it lives in. */
  plays(params: Obj, routed: string): boolean {
    return params.session_id === this.sessionId && routed === this.home
  }

  /** The profile a session lives in, or undefined for a session this gateway does not have. */
  profileOf(sessionId: string): string | undefined {
    return sessionId === this.sessionId ? this.home : this.echoChats().find(chat => chat.id === sessionId)?.profile
  }

  private echoChats(): EchoChat[] {
    return [...this.botChats.values(), ...this.seeded, ...this.newChats.values(), ...this.branchChats]
  }

  /** Live lists only running chats, where Hermes lists every open one (gateway/session_live_listing.py:77-100). */
  listed(routed: string, scope: 'live' | 'stored', hidden: boolean, picker: boolean): Obj {
    const chats = this.echoChats().filter(chat => chat.profile === routed && (hidden || !chat.hidden) && (scope === 'stored' || chat.running))
    const rows = chats.map(chat => chat.listRow(picker)).sort((a, b) => Number(b.last_active_at ?? b.started_at ?? 0) - Number(a.last_active_at ?? a.started_at ?? 0))
    return scope === 'live' ? { sessions: rows, scope } : { sessions: rows.map(row => ({ ...row, running: false })), scope, next_cursor: null }
  }

  /** `authority.authorize` for the story session (gateway/session_authority.py:225-229). */
  authorize(params: Obj, routed: string): void {
    if (!this.plays(params, routed)) throw new Refused('not_found')
  }

  private chat(socket: Socket, method: string, params: Obj, routed: string, chat: EchoChat): unknown {
    const handler = CHAT_HANDLERS[method]
    if (handler === undefined) throw new Refused('unsupported_command')
    return handler(this, socket, params, routed, chat)
  }

  story(socket: Socket, method: string, params: Obj, routed: string): unknown {
    for (const check of STORY_CHECKS[method] ?? ANY_STORY_CALL) {
      const reason = check(this, socket, params, routed)
      if (reason !== null) throw new Refused(reason)
    }
    const step = this.fixture.steps[this.step]
    if (step === undefined || !('await' in step) || step.await !== method) {
      const waiting = step !== undefined && 'await' in step ? `it waits for ${step.await}` : 'it waits for no call'
      const unexpected = `the story did not expect ${method} at step ${this.step}: ${waiting}`
      this.settle.reject(new Error(unexpected))
      throw new Refused(unexpected, { code: -32603, message: unexpected })
    }
    this.step++
    if (step.error !== undefined) throw new Refused(step.error.message, step.error)
    if (method === 'session.mutate') this.publishReceipt()
    return step.reply
  }

  /**
   * A committed mutation publishes its receipt as `session.updated` before the reply goes out
   * (gateway/session_mutations.py:347-352, as `commitModel` does), so the steps after a `session.mutate`
   * step up to the next awaited call play now. Played after the reply they would race the client's next call.
   */
  private publishReceipt(): void {
    for (let next = this.fixture.steps[this.step]; next !== undefined && !('await' in next); next = this.fixture.steps[this.step]) this.play(next)
  }

  storyParent(): Parent {
    const { view } = this
    return {
      id: this.sessionId, profile: this.home, title: view.title || this.listedTitle(), rows: this.stored.filter(isObject),
      generation: view.generation, busy: view.running || view.pending.length > 0, revision: view.revision,
      commit: result => {
        view.revision++
        view.branchesCommitted++
        this.branchesMade++
        this.emit('session.info', { revision: view.revision, title: view.title, running: view.running })
        this.emit('session.updated', { ...result, revision: view.revision })
        return view.revision
      }
    }
  }

  chatParent(chat: EchoChat): Parent {
    return {
      id: chat.id, profile: chat.profile, title: chat.title, rows: chat.rows, generation: chat.generation, busy: chat.running, revision: chat.revision,
      commit: result => {
        chat.revision++
        this.branchesMade++
        this.say(chat, 'session.info', { revision: chat.revision, title: chat.title, running: chat.running })
        this.say(chat, 'session.updated', { ...result, revision: chat.revision })
        return chat.revision
      }
    }
  }

  private listedTitle(): string {
    const { list } = this.fixture.header
    const rows = isObject(list) && Array.isArray(list.sessions) ? list.sessions.filter(isObject) : []
    const title = rows.find(row => row.session_id === this.sessionId)?.title
    return typeof title === 'string' ? title : ''
  }

  /**
   * `session.mutate` with operation `branch` (persistence/authority/runtime.py:299-310, persistence/sqlite/authority/_mutation_publish.py:60-79),
   * checked in the handler's order: the params, the receipt, the fences, an idle session, then the cut. The child is a chat
   * of the parent's profile that holds the copied rows. It is named the next title in the parent's lineage.
   */
  branch(parent: Parent, params: Obj, routed: string): unknown {
    const { request_id: requestId, expected_revision: revision, expected_generation: generation, payload } = params
    if (this.fixture.header.branches !== true) throw new Refused('invalid_params')
    if (!isText(requestId) || !isInt(revision) || !isInt(generation) || !isObject(payload)) throw new Refused('invalid_params')
    const { through_message_id: through, title, ...others } = payload
    const wrongThrough = through !== undefined && !(isInt(through) && through > 0)
    if (Object.keys(others).length > 0 || wrongThrough || (title !== undefined && !isText(title))) throw new Refused('invalid_params')
    // runtime.py:90-96: the digest covers both fences, so a resend under the same id with other fences is not a retry.
    const key = JSON.stringify([routed, parent.id, requestId])
    const digest = canonical({ operation: 'branch', payload, expected_revision: revision, expected_generation: generation })
    const receipt = this.receipts.get(key)
    if (receipt !== undefined) {
      if (receipt.digest !== digest) throw new Refused('admission_conflict')
      return receipt.result
    }
    const fenced = (reason: string) => new Refused(reason, { code: 4001, message: reason, data: { reason, revision: parent.revision, execution_generation: parent.generation } })
    if (revision !== parent.revision) throw fenced('revision_conflict')
    if (generation !== parent.generation) throw fenced('stale_generation')
    if (parent.busy) throw new Refused('session_busy')
    const copied = through === undefined ? parent.rows : rowsThrough(parent.rows, through)
    if (copied === null) throw new Refused('invalid_params')
    const child = new EchoChat(`branch-${routed}-${this.branchChats.length + 1}`, routed, isText(title) ? title : this.nextTitle(parent.title, routed))
    let next = 0
    child.rows.push(...copied.map(row => (isInt(row.row_id) ? { ...row, row_id: ++next } : row)))
    this.branchChats.push(child)
    const result = { session_id: parent.id, operation: 'branch', branched_session_id: child.id, copied_messages: copied.length }
    const committed = { ...result, revision: parent.commit(result) }
    this.receipts.set(key, { digest, result: committed })
    return committed
  }

  /** "Sort the invoices" is followed by "Sort the invoices #2", then "#3", skipping a title the profile already has. */
  private nextTitle(parent: string, routed: string): string {
    if (parent === '') return ''
    const taken = new Set(this.echoChats().filter(chat => chat.profile === routed).map(chat => chat.title))
    const [, base = parent, n = '1'] = /^(.*) #(\d+)$/.exec(parent) ?? []
    for (let at = Number(n) + 1; ; at++) if (!taken.has(`${base} #${at}`)) return `${base} #${at}`
  }

  /** The branch children of a profile, as `session.list {scope: 'stored'}` lists them. */
  branchRows(routed: string, picker: boolean): Obj[] {
    return this.branchChats.filter(chat => chat.profile === routed).map(chat => ({ ...chat.listRow(picker), running: false }))
  }

  /**
   * `session.mutate` with operation `model` (gateway/session_mutations.py, gateway/session_mutation_model.py),
   * checked in the handler's order. During a turn the switch waits for the turn to end.
   */
  switchModel(params: Obj, routed: string): unknown {
    const { view } = this
    const { expected_revision: revision, expected_generation: generation, payload } = params
    if (!isText(params.request_id) || !isInt(revision) || !isInt(generation) || !isObject(payload)) throw new Refused('invalid_params')
    this.authorize(params, routed)
    // gateway/session_controls.py:915-920: both refusals carry the fresh fences.
    const fenced = (reason: string) => new Refused(reason, { code: 4001, message: reason, data: { reason, revision: view.revision, execution_generation: view.generation } })
    if (revision !== view.revision) throw fenced('revision_conflict')
    if (generation !== view.generation) throw fenced('stale_generation')
    const asked = modelOf(payload)
    const models = this.fixture.header.models
    const known = asked !== null && isObject(models) && offered(models).some(({ model, provider }) =>
      model === asked.model && (asked.provider === null || asked.provider === provider))
    if (asked === null || !known) throw new Refused('invalid_params')
    if (view.running) {
      view.deferred = asked
      return { ...this.receipt(asked), status: 'deferred', execution_generation: view.generation }
    }
    if (this.guards(asked) && payload.confirm !== tokenFor(asked)) return { session_id: this.sessionId, operation: 'model', ...this.confirmation(asked) }
    return this.commitModel(asked)
  }

  private yoloAt(yolo: boolean): boolean | null {
    return this.fixture.header.yolo === undefined ? null : yolo
  }

  /**
   * `config.set` for key `yolo` (gateway/session_tui_config.py:187-193,357-377, gateway/session_busy_controls.py:30-44,134-166).
   * It sets this chat's flag and sends no session.info, so the reply is all a client hears. A missing value, which Hermes takes
   * as a toggle, is refused: Highwing always names the state.
   */
  setYolo(params: Obj, routed: string, chat: EchoChat | null): unknown {
    if (this.fixture.header.yolo === undefined) throw unknownMethod('config.set')
    if (params.key !== 'yolo') throw new Refused('invalid_params')
    if ('scope' in params) {
      if (params.scope === 'global') {
        const message = 'Highwing wrote the global YOLO: config.set with scope "global" flips the whole profile'
        this.settle.reject(new Error(message))
        throw new Refused(message, { code: -32603, message })
      }
      throw new Refused('invalid_params')
    }
    if (Object.keys(params).some(key => !['session_id', 'profile', 'key', 'value'].includes(key))) throw new Refused('invalid_params')
    if (!isText(params.session_id)) throw new Refused('invalid_params')
    if (chat === null) this.authorize(params, routed)
    const word = typeof params.value === 'string' ? params.value.trim().toLowerCase() : undefined
    if (word === undefined || !Object.hasOwn(YOLO_WORDS, word)) throw new Refused('invalid_params')
    if (this.fixture.header.yoloDenied === true) throw new Refused('permission_denied')
    const on = YOLO_WORDS[word] === true
    if (chat === null) this.view.yolo = on
    else chat.yolo = on
    return { key: 'yolo', value: on ? '1' : '0', scope: 'session' }
  }

  private guards({ model }: Model): boolean {
    return this.fixture.header.guarded?.includes(model) ?? false
  }

  /** gateway/session_mutation_model.py:351-387: nothing is applied until the pick comes back with `confirm`. */
  private confirmation({ model, provider }: Model): Obj {
    return {
      status: 'confirmation_required', confirm_required: true, confirm: tokenFor({ model, provider }), target_model: model,
      ...(provider === null ? {} : { target_provider: provider }), confirm_message: `${model} costs more per message.`
    }
  }

  /** gateway/session_deferred_pick.py:120-134: a guarded held pick is asked at the turn boundary, not applied. */
  private landDeferred(model: Model): void {
    this.view.deferred = null
    if (!this.guards(model)) return void this.commitModel(model)
    const committed = this.view.model
    this.emit('session.updated', {
      session_id: this.sessionId, operation: 'model', ...this.confirmation(model),
      payload: { model: model.model, ...(model.provider === null ? {} : { provider: model.provider }) },
      ...(committed === null ? {} : { committed_model: committed.model, ...(committed.provider === null ? {} : { committed_provider: committed.provider }) })
    })
  }

  private receipt({ model, provider }: Model): Obj {
    return { session_id: this.sessionId, operation: 'model', model, ...(provider === null ? {} : { provider }), revision: this.view.revision }
  }

  /** gateway/session_mutations.py:347-352: session.info names the model, then the receipt goes out as session.updated. */
  private commitModel(model: Model): Obj {
    const { view } = this
    view.revision++
    view.switchesCommitted++
    // persistence/sqlite/authority/_runtime_picks.py:38-47: committing a policy moves the generation.
    view.generation++
    view.model = model
    view.deferred = null
    const receipt = { ...this.receipt(model), execution_generation: view.generation }
    const { model: name, provider } = model
    this.emit('session.info', { model: name, ...(provider === null ? {} : { provider }), revision: view.revision, title: view.title, running: view.running })
    this.emit('session.updated', receipt)
    return receipt
  }

  private emit(type: string, payload: Obj): void {
    const params = { type, session_id: this.sessionId, replay_epoch: this.epoch, seq: this.latest + 1, payload }
    this.seqShift++
    this.ring.push(params)
    for (const socket of this.viewers()) socket.peer.write({ jsonrpc: '2.0', method: 'event', params })
  }

  /**
   * `session.resume` (gateway/session_controls.py:659-769) over `SessionAuthority.attach`
   * (gateway/session_authority.py:373-420): the frames after the socket's replay cursor are written
   * before it joins the fanout, and the snapshot is read at the watermark that follows them.
   */
  attach(socket: Socket, params: Obj): unknown {
    this.releaseHeld()
    const replayFrom = socket.replayCursors.get(this.sessionId)
    socket.replayCursors.delete(this.sessionId)
    if (replayFrom !== undefined && !socket.subscriptions.has(this.sessionId)) {
      for (const frame of this.ring) if (frame.seq > replayFrom) socket.peer.write({ jsonrpc: '2.0', method: 'event', params: frame })
    }
    socket.subscriptions.set(this.sessionId, socket.subscriptionId)
    const { view } = this
    return snapshotOf({
      id: this.sessionId, rows: this.stored, ring: this.ring, epoch: this.epoch, running: view.running, generation: view.generation,
      revision: view.revision, title: view.title, model: view.model, yolo: view.yolo, pending: view.pending, prompts: [...view.prompts.values()],
      openRequests: this.openRequestList()
    }, socket.subscriptionId, params)
  }

  /**
   * `session.resume` for a chat beside the story. Its turns end before the next frame is read, so
   * it runs only while a seeded approval waits.
   */
  open(socket: Socket, chat: EchoChat, params: Obj): unknown {
    socket.subscriptions.set(chat.id, socket.subscriptionId)
    return snapshotOf({
      id: chat.id, rows: chat.rows, ring: chat.ring, epoch: chat.epoch, running: chat.running, generation: chat.generation,
      revision: chat.revision, title: chat.title, model: chat.model, yolo: this.yoloAt(chat.yolo), pending: [], prompts: chat.asking === null ? [] : [chat.asking], openRequests: []
    }, socket.subscriptionId, params)
  }

  /** The routed profile's Bot Chat, attached, or undefined when it has none. */
  botChat(socket: Socket, routed: string): unknown {
    const chat = this.botChats.get(routed)
    if (chat !== undefined) return this.open(socket, chat, {})
    return this.botChatId(routed) === undefined ? undefined : this.attach(socket, {})
  }

  newBotChat(routed: string): EchoChat {
    const chat = new EchoChat(`bot-chat-${routed}`, routed, BOT_CHAT, true)
    this.botChats.set(routed, chat)
    return chat
  }

  /** An untitled create makes a new, empty chat in the routed profile. A retry with the same `request_id` gets the chat the first one made (gateway/session_local.py:308, :365). */
  newChat(routed: string, requestId: unknown): EchoChat {
    const key = isText(requestId) ? JSON.stringify([routed, requestId]) : null
    const held = key === null ? undefined : this.newChats.get(key)
    if (held !== undefined) return held
    const chat = new EchoChat(`chat-${routed}-${this.newChats.size + 1}`, routed, '')
    this.newChats.set(key ?? chat.id, chat)
    return chat
  }

  private botChatId(profile: string): string | undefined {
    return profile === this.storyIsBotChatOf ? this.sessionId : this.botChats.get(profile)?.id
  }

  /** The reply rows of `session.list {title: 'Bot Chat'}` (gateway/session_controls.py:617-638): the one session with that title, or none. */
  titledRows(routed: string): readonly Obj[] {
    const id = this.botChatId(routed)
    if (id === undefined) return []
    return [{ session_id: id, id, resolved_id: id, title: BOT_CHAT, root_title: BOT_CHAT, source: 'gui', started_at: null, message_count: 0, running: false }]
  }

  /**
   * One turn of a chat beside the story, published after the receipt as `SessionAuthority` publishes a turn
   * (gateway/session_authority.py:484-495 for the queue row, :1239 for the start). The reply names
   * the profile the frame was routed by, so a test reads which bot the message ran as.
   */
  echo(chat: EchoChat, inputId: string, text: string, routed: string): unknown {
    const generation = ++chat.generation
    const admission = {
      admission_id: `${chat.id}-admission-${generation}`, ref: { profile_id: routed, session_id: chat.id }, sequence: generation,
      status: 'queued', outcome: null, authority_epoch: 1, execution_generation: null
    }
    const turn = { authority_epoch: 1, execution_generation: generation, admission_id: admission.admission_id }
    const said = `${routed}: ${text}`
    const timestamp = this.options.clock.now() / 1000
    const first = chat.nextRowId
    this.afterReply.push(() => {
      this.say(chat, 'session.info', { pending: [{ ...admission, input_id: inputId, text }], running: false, execution_generation: generation - 1, revision: chat.revision })
      this.say(chat, 'message.start', {}, turn)
      this.say(chat, 'message.delta', { text: said, segment: 0, offset: 0 }, turn)
      chat.rows.push({ role: 'user', text, timestamp, row_id: first }, { role: 'assistant', text: said, timestamp, row_id: first + 1 })
      this.say(chat, 'message.complete', {
        text: null, outcome: 'completed', status: 'complete', persisted_turn: { row_ids: [first, first + 1], complete: true, submission_id: inputId }
      }, turn)
    })
    return admission
  }

  private say(chat: EchoChat, type: string, payload: Obj, stamp: Obj = {}): void {
    const params = { ...stamp, type, session_id: chat.id, payload, replay_epoch: chat.epoch, seq: (chat.ring.at(-1)?.seq ?? 0) + 1 }
    chat.ring.push(params)
    for (const socket of this.viewers(chat.id)) socket.peer.write({ jsonrpc: '2.0', method: 'event', params })
  }

  modelMenu(current: Model | null): unknown {
    const { models } = this.fixture.header
    if (!isObject(models)) throw unknownMethod('model.options')
    return current === null ? models : { ...models, model: current.model, ...(current.provider === null ? {} : { provider: current.provider }) }
  }

  /**
   * `profiles.list` (tui_gateway/methods_profiles.py:271-290): the header's rows, each naming the
   * Bot Chat its profile has now. A socket bound to one profile gets the other rows with no session
   * fields (gateway/session_group_controls.py:366-384).
   */
  roster(socket: Socket): unknown {
    const { profiles } = this.fixture.header
    if (!isObject(profiles)) throw unknownMethod('profiles.list')
    return {
      ...profiles,
      profiles: this.profiles.map(row => {
        if (!isText(row.name)) return row
        if (socket.reach === 'profile' && row.name !== this.home) return Object.fromEntries(Object.entries(row).filter(([key]) => !SESSION_FIELDS.has(key)))
        return { ...row, canonical_session: this.canonical(row.name, row.canonical_session) }
      })
    }
  }

  /**
   * `profiles.create` (tui_gateway/methods_profiles.py:296-347). It is no canonical method: only a socket whose grant covers
   * the interactive purpose reaches the legacy handler (tui_gateway/ws.py:403-411, tui_gateway/ws_legacy_fallback.py:53-62),
   * so a bound socket gets -32601. The new profile joins the roster, and calls routed to it work like any listed bot's.
   */
  create(socket: Socket, params: Obj): unknown {
    const { profiles, createWarnings = [] } = this.fixture.header
    if (!isObject(profiles) || socket.reach === 'profile') throw unknownMethod('profiles.create')
    const asked = (key: string) => (typeof params[key] === 'string' ? params[key].trim() : '')
    if (asked('name') === '') throw refusedCreate(4061, 'name required', 'ValueError', 'profile name cannot be empty')
    const canon = asked('name').toLowerCase()
    const refusal = nameRefusal(canon, name => this.profiles.some(row => row.name === name))
    if (refusal !== null) throw refusal
    const [model, provider] = [asked('model'), asked('provider')]
    const pinned = model !== '' && provider !== ''
    const soulWritten = typeof params.soul === 'string' && params.soul.trim() !== ''
    const home = this.profiles.find(row => row.name === this.home)?.path
    const path = `${isText(home) ? home : '/hermes-home'}/profiles/${canon}`
    this.profiles.push({
      name: canon, path, is_default: false, model: pinned ? model : null, provider: pinned ? provider : null, description: asked('description'),
      display_name: '', skill_count: 0, previous_names: []
    })
    return {
      ok: true, name: asked('name'), path, soul_written: soulWritten, model_set: pinned,
      mirrored: { env: true, auth: 'shared', model_inherited: !pinned, voice: false }, warnings: createWarnings
    }
  }

  private canonical(profile: string, recorded: unknown): Obj | null {
    const id = this.botChatId(profile)
    if (id === undefined) return null
    const kept = isObject(recorded) ? recorded : { root_title: BOT_CHAT, title: BOT_CHAT, preview: '' }
    return { ...kept, id, resolved_id: id }
  }

  /** gateway/session_server_requests.py:125-135 */
  openRequestList(): unknown[] {
    return [...this.openRequests].map(([id, { method, params }]) => ({ id, method, params }))
  }

  releaseHeld(): void {
    if (this.drop.at !== 'holding') return
    const { step } = this.drop
    this.drop = { at: 'spent' }
    this.publish(step)
  }

  private viewers(sessionId: string = this.sessionId): Socket[] {
    return [...this.sockets].filter(socket => socket.subscriptions.has(sessionId))
  }

  private pump(): void {
    const step = this.fixture.steps[this.step]
    if (this.scheduled || this.finished) return
    if (step === undefined) {
      this.finished = true
      return this.settle.resolve()
    }
    if ('await' in step || this.viewers().length === 0) return
    const before = this.fixture.steps[this.step - 1]?.at ?? 0
    this.scheduled = true
    this.options.clock.setTimeout(() => {
      this.scheduled = false
      if (this.fixture.steps[this.step] === step && this.viewers().length > 0) this.play(step)
      this.pump()
    }, this.options.timing === 'recorded' ? step.at - before : 0)
  }

  private play(step: Exclude<FixtureStep, { await: string }>): void {
    this.step++
    if ('stored' in step) {
      this.stored = step.stored
    } else if ('drop' in step) {
      this.closeAll(step.drop)
    } else {
      this.publish(step)
      if (this.drop.at === 'armed' && this.delivered === this.drop.afterPush) this.vanish(this.drop.missed)
    }
  }

  private closeAll(code: number): void {
    for (const socket of this.sockets) socket.peer.close(code)
    this.sockets.clear()
  }

  private vanish(missed: number): void {
    this.closeAll(ABNORMAL_CLOSE)
    const lost: PushStep[] = []
    for (let next = this.fixture.steps[this.step]; next !== undefined && lost.length < missed; next = this.fixture.steps[this.step]) {
      if ('stored' in next) this.stored = next.stored
      else if ('push' in next) lost.push(next)
      else break
      this.step++
    }
    const held = lost.length > 1 ? lost.pop() : undefined
    this.drop = held === undefined ? { at: 'spent' } : { at: 'holding', step: held }
    lost.forEach(step => this.publish(step))
  }

  /**
   * A session event is stamped into the ring and fanned out to the sockets attached to the session
   * (gateway/session_events.py:76-112).
   */
  private publish(step: PushStep): void {
    const push = this.withUsage(this.restamp(step.push))
    if (!isObject(push)) return
    const { id, method, params } = push
    if (method !== 'event') {
      if (typeof id === 'string' && typeof method === 'string') this.openRequests.set(id, { method, params })
    } else if (isObject(params) && isInt(params.seq)) {
      this.ring.push({ ...params, seq: params.seq })
      this.track(params)
    }
    const to = method === 'event' && isObject(params) && params.session_id === undefined ? [...this.sockets] : this.viewers()
    for (const socket of to) socket.peer.write(push)
    if (to.length > 0) this.delivered++
    if (!this.view.running && this.view.deferred !== null) this.landDeferred(this.view.deferred)
  }

  /** A turn's end carries the session's usage view for a local viewer (gateway/session_settlement_recovery.py:84-88). */
  private withUsage(push: unknown): unknown {
    const { usage } = this.fixture.header
    if (usage === undefined || !isObject(push) || !isObject(push.params)) return push
    const { params } = push
    if (params.type !== 'message.complete' || !isInt(params.execution_generation) || !isObject(params.payload)) return push
    return { ...push, params: { ...params, payload: { ...params.payload, usage: usageView(usage.after) } } }
  }

  private restamp(push: unknown): unknown {
    if (this.seqShift === 0 || !isObject(push) || push.method !== 'event' || !isObject(push.params)) return push
    const { params } = push
    if (!isInt(params.seq)) return push
    const shift = this.view.switchesCommitted
    const revisions = shift + this.view.branchesCommitted
    const moved = (fields: Obj): Obj => ({
      ...fields,
      ...(isInt(fields.revision) ? { revision: fields.revision + revisions } : {}),
      ...(isInt(fields.execution_generation) ? { execution_generation: fields.execution_generation + shift } : {})
    })
    const payload = isObject(params.payload) ? moved(params.payload) : params.payload
    return { ...push, params: { ...moved(params), seq: params.seq + this.seqShift, payload } }
  }

  private track(params: Obj): void {
    const parsed = parseEvent(params)
    if (parsed.scope !== 'session') return
    const ended = parsed.event?.type === 'turn.ended'
    // An end frame with no generation is a cancelled queued message, not the end of the run (gateway/session_authority.py:886).
    if (parsed.stamp.generation === null && ended) return
    if (parsed.stamp.generation !== null) this.view.generation = Math.max(this.view.generation, parsed.stamp.generation)
    if (parsed.event === null) return
    const change = TRACK[parsed.event.type] as ((view: View, event: SessionEvent, payload: Obj) => void) | undefined
    change?.(this.view, parsed.event, isObject(params.payload) ? params.payload : {})
  }
}
