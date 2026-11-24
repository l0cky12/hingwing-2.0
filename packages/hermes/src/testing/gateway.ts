/**
 * The gateway a fixture is played from: Hermes's canonical dispatcher and the handlers the client
 * talks to, reduced to one story session and one Bot Chat per bot. Each rule cites the Hermes
 * 0.23.3 source it copies.
 */
import type { SessionEvent } from '../domain/reduce'
import { GATEWAY_PROTOCOL, type Clock, type Reach } from '../wire/link'
import { parseEvent } from '../wire/parse'
import type { Fixture, FixtureStep } from './fixture'
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
}

const TRACK: { readonly [T in SessionEvent['type']]?: (view: View, event: Extract<SessionEvent, { type: T }>, payload: Obj) => void } = {
  'turn.started': view => { view.running = true },
  'turn.ended': view => {
    view.running = false
    view.prompts.clear()
  },
  'prompt.opened': (view, event, payload) => void view.prompts.set(event.id, payload),
  'prompt.settled': (view, event) => void view.prompts.delete(event.id),
  'prompts.cancelled': (view, event) => event.ids.forEach(id => view.prompts.delete(id)),
  meta: (view, event, payload) => {
    if (event.title !== undefined) view.title = event.title
    if (event.revision !== undefined) view.revision = event.revision
    if (Array.isArray(payload.pending)) view.pending = payload.pending
  }
}

type Drop =
  | { readonly at: 'armed'; readonly afterPush: number; readonly missed: number }
  | { readonly at: 'holding'; readonly step: PushStep }
  | { readonly at: 'spent' }

/** `routed` is the profile the frame is for: the one its `profile` names, else the home profile. */
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
/** What `profiles.list` says about a profile's sessions (gateway/session_group_controls.py:401-404). */
const SESSION_FIELDS: ReadonlySet<string> = new Set(['last_session', 'worker_session', 'canonical_session'])

interface Stream {
  readonly ring: readonly Params[]
  readonly epoch: string
}

/** A chat of one bot that is not the story. It answers by itself and plays one echo turn per submit. */
class BotChat implements Stream {
  readonly ring: Params[] = []
  readonly rows: Obj[] = []
  readonly epoch: string
  generation = 0

  constructor(readonly id: string, readonly profile: string) {
    this.epoch = `${id}-epoch`
  }

  get model(): Model {
    return { model: `${this.profile}-model`, provider: null }
  }
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
      ...(model === null ? {} : { model: model.model, ...(model.provider === null ? {} : { provider: model.provider }) })
    },
    pending_connection: null, open_requests: held.openRequests
  }
}

/** gateway/session_controls.py:386-392 */
const unknownMethod = (method: string) => new Refused('unknown_method', { code: -32601, message: `unknown method: ${method}`, data: { reason: 'unknown_method' } })

function offered(models: Obj): Model[] {
  const rows = Array.isArray(models.providers) ? models.providers.filter(isObject) : []
  return rows.flatMap(row => (Array.isArray(row.models) ? row.models.filter(isText) : []).map(model => ({ model, provider: isText(row.slug) ? row.slug : null })))
}

const tokenFor = ({ model }: Model) => `confirm-${model}`

const modelOf = (value: Obj | undefined): Model | null =>
  value !== undefined && isText(value.model) ? { model: value.model, provider: isText(value.provider) ? value.provider : null } : null

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
    if (routed !== gateway.home) return { sessions: [], scope }
    if (scope === 'stored') return { sessions: [], scope, next_cursor: null }
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
    if (params.title === undefined && routed === gateway.home) return gateway.attach(socket, {})
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
  /** tui_gateway/methods_profiles.py:271-290 */
  'profiles.list': (gateway, socket) => gateway.roster(socket),
  'session.mutate': (gateway, socket, params, routed) =>
    (params.operation === 'model' ? gateway.switchModel(params, routed) : gateway.story(socket, 'session.mutate', params, routed)),
  /** gateway/session_controls.py:779-803. The subscription is looked up on the routed profile's connection. */
  'session.detach': (gateway, socket, params, routed) => {
    const { session_id, subscription_id } = params
    if (!isText(session_id) || !isText(subscription_id)) throw new Refused('invalid_params')
    const detached = gateway.profileOf(session_id) === routed && socket.subscriptions.get(session_id) === subscription_id
    if (detached) socket.subscriptions.delete(session_id)
    return { session_id, subscription_id, detached }
  }
}

type ChatHandler = (gateway: ScriptedGateway, socket: Socket, params: Obj, routed: string, chat: BotChat) => unknown

/** The calls a Bot Chat answers. Any other verb for it is `unsupported_command`. */
const CHAT_HANDLERS: Readonly<Record<string, ChatHandler>> = {
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
  'session.detach': HANDLERS['session.detach'] as Handler
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

  private stored: readonly unknown[]
  private readonly profiles: readonly Obj[]
  /** profile -> its Bot Chat. The home profile's is the story session, unless the header says `homeBotChat: false`. */
  private readonly botChats = new Map<string, BotChat>()
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
      model: modelOf(isObject(models) ? models : undefined), deferred: null, switchesCommitted: 0
    }
    this.epoch = fixture.steps.map(epochOf).find(isText) ?? 'fixture-epoch'
    this.done = new Promise((resolve, reject) => { this.settle = { resolve, reject } })
    this.done.catch(() => {})
    const { profiles } = fixture.header
    this.profiles = isObject(profiles) && Array.isArray(profiles.profiles) ? profiles.profiles.filter(isObject) : []
    this.home = this.profiles.map(row => (row.is_default === true ? row.name : undefined)).find(isText) ?? 'default'
    for (const { name, canonical_session: named } of this.profiles) {
      const id = isObject(named) ? named.resolved_id || named.id : undefined
      if (!isText(name) || !isObject(named) || !isText(id) || (name === this.home && this.storyIsBotChat)) continue
      const chat = new BotChat(id, name)
      if (isText(named.preview)) chat.rows.push({ role: 'assistant', text: named.preview, timestamp: named.last_active ?? null, row_id: 1 })
      this.botChats.set(name, chat)
    }
  }

  private get storyIsBotChat(): boolean {
    return this.fixture.header.homeBotChat !== false
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
    socket.peer.write({ jsonrpc: '2.0', id, ...reply })
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
    const chat = [...this.botChats.values()].find(held => held.id === params.session_id && held.profile === routed)
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
    return sessionId === this.sessionId ? this.home : [...this.botChats.values()].find(chat => chat.id === sessionId)?.profile
  }

  /** `authority.authorize` for the story session (gateway/session_authority.py:225-229). */
  authorize(params: Obj, routed: string): void {
    if (!this.plays(params, routed)) throw new Refused('not_found')
  }

  private chat(socket: Socket, method: string, params: Obj, routed: string, chat: BotChat): unknown {
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
    return step.reply
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
      revision: view.revision, title: view.title, model: view.model, pending: view.pending, prompts: [...view.prompts.values()],
      openRequests: this.openRequestList()
    }, socket.subscriptionId, params)
  }

  /** `session.resume` for a Bot Chat. Its turns end before the next frame is read, so it is never running. */
  open(socket: Socket, chat: BotChat, params: Obj): unknown {
    socket.subscriptions.set(chat.id, socket.subscriptionId)
    return snapshotOf({
      id: chat.id, rows: chat.rows, ring: chat.ring, epoch: chat.epoch, running: false, generation: chat.generation,
      revision: 0, title: BOT_CHAT, model: chat.model, pending: [], prompts: [], openRequests: []
    }, socket.subscriptionId, params)
  }

  /** The routed profile's Bot Chat, attached, or undefined when it has none. */
  botChat(socket: Socket, routed: string): unknown {
    const chat = this.botChats.get(routed)
    if (chat !== undefined) return this.open(socket, chat, {})
    return this.botChatId(routed) === undefined ? undefined : this.attach(socket, {})
  }

  newBotChat(routed: string): BotChat {
    const chat = new BotChat(`bot-chat-${routed}`, routed)
    this.botChats.set(routed, chat)
    return chat
  }

  private botChatId(profile: string): string | undefined {
    return this.botChats.get(profile)?.id ?? (profile === this.home && this.storyIsBotChat ? this.sessionId : undefined)
  }

  /** The reply rows of `session.list {title: 'Bot Chat'}` (gateway/session_controls.py:626-641): the one session with that title, or none. */
  titledRows(routed: string): readonly Obj[] {
    const id = this.botChatId(routed)
    if (id === undefined) return []
    return [{ session_id: id, id, resolved_id: id, title: BOT_CHAT, root_title: BOT_CHAT, source: 'gui', started_at: null, message_count: 0, running: false }]
  }

  /**
   * One turn of a Bot Chat, published after the receipt as `SessionAuthority` publishes a turn
   * (gateway/session_authority.py:484-495 for the queue row, :1239 for the start). The reply names
   * the profile the frame was routed by, so a test reads which bot the message ran as.
   */
  echo(chat: BotChat, inputId: string, text: string, routed: string): unknown {
    const generation = ++chat.generation
    const admission = {
      admission_id: `${chat.id}-admission-${generation}`, ref: { profile_id: routed, session_id: chat.id }, sequence: generation,
      status: 'queued', outcome: null, authority_epoch: 1, execution_generation: null
    }
    const turn = { authority_epoch: 1, execution_generation: generation, admission_id: admission.admission_id }
    const said = `${routed}: ${text}`
    const timestamp = this.options.clock.now() / 1000
    const first = chat.rows.length + 1
    this.afterReply.push(() => {
      this.say(chat, 'session.info', { pending: [{ ...admission, input_id: inputId, text }], running: false, execution_generation: generation - 1, revision: 0 })
      this.say(chat, 'message.start', {}, turn)
      this.say(chat, 'message.delta', { text: said, segment: 0, offset: 0 }, turn)
      chat.rows.push({ role: 'user', text, timestamp, row_id: first }, { role: 'assistant', text: said, timestamp, row_id: first + 1 })
      this.say(chat, 'message.complete', {
        text: null, outcome: 'completed', status: 'complete', persisted_turn: { row_ids: [first, first + 1], complete: true, submission_id: inputId }
      }, turn)
    })
    return admission
  }

  private say(chat: BotChat, type: string, payload: Obj, stamp: Obj = {}): void {
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
      profiles: (profiles.profiles as readonly unknown[]).map(row => {
        if (!isObject(row) || !isText(row.name)) return row
        if (socket.reach === 'profile' && row.name !== this.home) return Object.fromEntries(Object.entries(row).filter(([key]) => !SESSION_FIELDS.has(key)))
        return { ...row, canonical_session: this.canonical(row.name, row.canonical_session) }
      })
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
    const push = this.restamp(step.push)
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

  private restamp(push: unknown): unknown {
    if (this.seqShift === 0 || !isObject(push) || push.method !== 'event' || !isObject(push.params)) return push
    const { params } = push
    if (!isInt(params.seq)) return push
    const shift = this.view.switchesCommitted
    const moved = (fields: Obj): Obj => ({
      ...fields,
      ...(isInt(fields.revision) ? { revision: fields.revision + shift } : {}),
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
