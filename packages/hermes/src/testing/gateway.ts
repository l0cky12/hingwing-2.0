/**
 * The gateway a fixture is played from: Hermes's canonical dispatcher and the handlers the client
 * talks to, reduced to one session. Each rule cites the Hermes 0.23.3 source it copies.
 */
import type { SessionEvent } from '../domain/reduce'
import { GATEWAY_PROTOCOL, type Clock } from '../wire/link'
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

type Handler = (gateway: ScriptedGateway, socket: Socket, params: Obj) => unknown
type Check = (gateway: ScriptedGateway, socket: Socket, params: Obj) => string | null

const attached: Check = (_gateway, socket, params) => (socket.subscriptions.has(String(params.session_id)) ? null : 'permission_denied')
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

/**
 * The calls a story answers, each with the checks its handler makes first, in the handler's order.
 * A session verb on a socket that has not attached the session is `permission_denied` for a submit
 * and an answer. An interrupt needs no attachment (gateway/session_authority.py:972-976).
 */
const STORY_CHECKS: Readonly<Record<string, readonly Check[]>> = {
  /** gateway/session_controls.py:884-895 */
  'prompt.submit': [attached, (_gateway, _socket, params) => (isText(params.submission_id || params.input_id) ? null : 'invalid_params')],
  /** gateway/session_controls.py:995-998, gateway/session_authority.py:1106-1117 */
  'approval.respond': [exactly('session_id', 'execution_generation', 'prompt_id', 'choice'), attached, runningGeneration],
  'clarify.respond': [exactly('session_id', 'execution_generation', 'prompt_id', 'answer'), attached, runningGeneration],
  'session.interrupt': [(gateway, _socket, params) => (gateway.view.generation === params.execution_generation ? null : 'stale_generation')],
  /** gateway/session_commands.py:422-425 */
  'command.dispatch': [dispatchable]
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
  'session.list': (gateway, _socket, params) => {
    const { limit = 200, scope = 'live' } = params
    if (!isInt(limit) || limit < 1 || limit > 200 || (scope !== 'live' && scope !== 'stored') || ('title' in params && 'scope' in params)) {
      throw new Refused('invalid_params')
    }
    if (scope === 'stored') return { sessions: [], scope, next_cursor: null }
    const { list } = gateway.fixture.header
    const rows = isObject(list) && Array.isArray(list.sessions) ? list.sessions.filter(isObject) : []
    return { sessions: rows.map(row => (row.session_id === gateway.sessionId ? { ...row, running: gateway.view.running } : row)), scope }
  },
  /** gateway/session_discovery.py:8-35 */
  'commands.catalog': (gateway, _socket, params) => {
    const { catalog } = gateway.fixture.header
    if (catalog === undefined) throw new Refused('unknown_method', { code: -32601, message: 'unknown method: commands.catalog', data: { reason: 'unknown_method' } })
    if (!strings(['session_id', 'profile'])(params)) throw new Refused('invalid_params')
    if (params.session_id !== undefined && params.session_id !== '') gateway.authorize(params)
    return catalog
  },
  /** gateway/session_controls.py:505-569: a create ends in a resume of the new session. */
  'session.create': (gateway, socket) => gateway.attach(socket, {}),
  'session.resume': (gateway, socket, params) => {
    gateway.authorize(params)
    return gateway.attach(socket, params)
  },
  /** gateway/session_controls.py:805-822, gateway/session_events.py:126-138 */
  'session.events.since': (gateway, socket, params) => {
    gateway.authorize(params)
    const { last_sequence: sequence = params.last_seen ?? 0, replay_epoch: epoch } = params
    if (!isInt(sequence) || sequence < 0 || (epoch !== undefined && epoch !== null && typeof epoch !== 'string')) throw new Refused('invalid_params')
    const latest = gateway.latest
    const missing = epoch !== gateway.epoch || sequence > latest || sequence < latest - gateway.options.ringFrames
    const events = missing ? [] : gateway.ring.filter(frame => frame.seq > sequence)
    if (!missing) socket.replayCursors.set(gateway.sessionId, events.at(-1)?.seq ?? sequence)
    const reply = {
      events, latest_seq: latest, last_sequence: latest, epoch: gateway.epoch, replay_epoch: gateway.epoch,
      truncated: missing, snapshot_required: missing, count: events.length, open_requests: gateway.openRequestList()
    }
    gateway.releaseHeld()
    return reply
  },
  /** gateway/session_config.py:11-13 */
  'model.options': (gateway, _socket, params) => {
    const { models } = gateway.fixture.header
    if (!isObject(models)) throw unknownMethod('model.options')
    if (params.session_id !== undefined && params.session_id !== null) gateway.authorize(params)
    const { model } = gateway.view
    return model === null ? models : { ...models, model: model.model, ...(model.provider === null ? {} : { provider: model.provider }) }
  },
  'session.mutate': (gateway, socket, params) => (params.operation === 'model' ? gateway.switchModel(params) : gateway.story(socket, 'session.mutate', params)),
  /** gateway/session_controls.py:779-803 */
  'session.detach': (_gateway, socket, params) => {
    const { session_id, subscription_id } = params
    if (!isText(session_id) || !isText(subscription_id)) throw new Refused('invalid_params')
    const detached = socket.subscriptions.get(session_id) === subscription_id
    if (detached) socket.subscriptions.delete(session_id)
    return { session_id, subscription_id, detached }
  }
}

export class ScriptedGateway {
  readonly sessionId: string
  readonly epoch: string
  readonly ring: Params[] = []
  readonly view: View
  readonly received: unknown[] = []
  readonly done: Promise<void>
  dials = 0
  step = 0
  finished = false

  private stored: readonly unknown[]
  private readonly sockets = new Set<Socket>()
  private readonly openRequests = new Map<string, { readonly method: string; readonly params: unknown }>()
  private drop: Drop
  private delivered = 0
  private seqShift = 0
  private scheduled = false
  private settle!: { resolve(): void; reject(error: Error): void }

  constructor(readonly fixture: Fixture, readonly options: GatewayOptions) {
    this.sessionId = fixture.header.sessionId
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
  }

  get latest(): number {
    return this.ring.at(-1)?.seq ?? 0
  }

  /** A new socket. The gateway speaks first (tui_gateway/ws.py:656-664). */
  accept(peer: Peer): { text(text: string): void; closed(): void } {
    const socket: Socket = { peer, subscriptionId: `subscription-${++this.dials}`, subscriptions: new Map(), replayCursors: new Map() }
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
    this.pump()
  }

  /**
   * `AuthorityConnection.dispatch` (gateway/session_controls.py:313-410): the closed key set, then
   * the handler, then its refusal. A method nobody declares is JSON-RPC's -32601.
   */
  private dispatch(socket: Socket, method: string, params: unknown): { result: unknown } | { error: WireError } {
    const invalid = (data: Obj): { error: WireError } => ({ error: { code: 4001, message: 'invalid_params', data: { reason: 'invalid_params', ...data } } })
    if (!isObject(params)) return invalid({})
    const fields = checkParams(method, params)
    if (fields !== undefined && fields.length > 0) return invalid({ fields })
    const handler = HANDLERS[method]
    if (handler === undefined && fields === undefined) return { error: { code: -32601, message: `unknown method: ${method}`, data: { reason: 'unknown_method' } } }
    try {
      return { result: handler === undefined ? this.story(socket, method, params) : handler(this, socket, params) }
    } catch (error) {
      if (error instanceof Refused) return { error: error.wire }
      throw error
    }
  }

  /** `authority.authorize` for the one session this gateway has (gateway/session_authority.py:225-229). */
  authorize(params: Obj): void {
    if (params.session_id !== this.sessionId) throw new Refused('not_found')
  }

  story(socket: Socket, method: string, params: Obj): unknown {
    this.authorize(params)
    for (const check of STORY_CHECKS[method] ?? []) {
      const reason = check(this, socket, params)
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
  switchModel(params: Obj): unknown {
    const { view } = this
    const { expected_revision: revision, expected_generation: generation, payload } = params
    if (!isText(params.request_id) || !isInt(revision) || !isInt(generation) || !isObject(payload)) throw new Refused('invalid_params')
    this.authorize(params)
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
    const omit = params.omit_messages === true
    const { view } = this
    return {
      session_id: this.sessionId, stored_session_id: this.sessionId,
      messages: omit ? [] : this.stored, ...(omit ? { messages_omitted: true } : {}), message_count: this.stored.length, todo_state: null,
      ...(params.display_projection === true ? { display_messages: this.stored } : {}),
      running: view.running, authority_epoch: 1, replay_epoch: this.epoch, last_sequence: this.latest,
      subscription_id: socket.subscriptionId, revision: view.revision, execution_generation: view.generation,
      pending: view.pending, prompts: [...view.prompts.values()],
      info: {
        desktop_protocol: GATEWAY_PROTOCOL, title: view.title,
        ...(view.model === null ? {} : { model: view.model.model, ...(view.model.provider === null ? {} : { provider: view.model.provider }) })
      },
      pending_connection: null, open_requests: this.openRequestList()
    }
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

  private viewers(): Socket[] {
    return [...this.sockets].filter(socket => socket.subscriptions.has(this.sessionId))
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
