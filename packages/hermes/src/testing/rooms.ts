/**
 * Hermes's group chats as far as Highwing uses them, played from a fixture's `groups` header. Every rule is the real
 * gateway's, so a client bug fails a fixture test instead of waiting for a live Hermes. The numbers are copied from
 * Hermes, never imported from the client, because this is the oracle the client is tested against.
 */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Clock } from '../wire/link'
import type { GroupsScript, RoomSeed, TurnScript } from './fixture'

type Obj = { readonly [key: string]: unknown }

export interface RoomsDeps {
  readonly clock: Clock
  readonly profiles: readonly string[]
  /** Writes one frame to every open socket, as Hermes sends `groups.changed` to all of them. */
  broadcast(frame: unknown): void
  refuse(reason: string, data?: Obj): never
  unserved(method: string): never
}

/** `_FIELDS` (gateway/session_group_controls.py:36-59). The dispatch takes `profile` off before a room sees the call. */
const FIELDS: { readonly [method: string]: readonly string[] } = {
  'groups.capabilities': [],
  'groups.list': ['limit', 'offset', 'include_disbanded'],
  'groups.create': ['room_id', 'name', 'members'],
  'groups.state': ['room_id', 'include_disbanded'],
  'groups.log': ['room_id', 'since_seq', 'limit', 'include_disbanded'],
  'groups.send': ['room_id', 'event_id', 'payload'],
  'groups.stop': ['room_id', 'cancel_id']
}

/** gateway/hosted_room_discussion.py:30-35 */
const MEMBERS = { min: 2, max: 6 }
const MAX_ROUNDS = 3
const MAX_MESSAGES = 10
const MAX_USER_TEXT_BYTES = 64 * 1024
/** `_MENTION_RE` (gateway/hosted_room_discussion.py:43) */
const MENTION = /@([A-Za-z0-9][A-Za-z0-9._:-]*)/g
/** gateway/hosted_rooms_common.py:19, and the 128-character cap every identifier has at :23. */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
/** gateway/hosted_rooms.py:37, :40, :44 and :46 */
const MAX_NAME = 200
const MAX_LABEL = 200
const MAX_LOG_LIMIT = 500
const MAX_LIST = 500
const RESERVED_HANDLES = ['all', 'everyone']
const GATEWAY = 'fixture-gateway'
const SUPERSEDED = 'superseded_by_newer_user_event'

interface Seat {
  readonly member_id: string
  readonly profile: string
  readonly handle: string
  readonly target: { readonly kind: 'local'; readonly profile: string }
  readonly display_name?: string
}

interface LogEvent {
  readonly room_id: string
  readonly seq: number
  readonly event_id: string
  readonly kind: string
  readonly actor: Obj
  readonly authority_epoch: number
  readonly payload: Obj
  readonly created_at: number
}

interface Turn {
  readonly seat: Seat
  readonly round: number
  readonly about: LogEvent
  readonly started: number
  superseded: boolean
  readonly hold: boolean
  cancel: () => void
}

interface Discussion {
  readonly about: LogEvent
  round: number
  queue: Seat[]
  messages: number
}

interface Room {
  readonly room_id: string
  readonly name: string
  readonly members: readonly Seat[]
  readonly at: number
  readonly epoch: number
  readonly log: LogEvent[]
  running: Turn | null
  discussion: Discussion | null
}

const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)
const identifier = (value: unknown): string | null => {
  const held = typeof value === 'string' ? value.trim() : ''
  return IDENTIFIER.test(held) ? held : null
}
/** `user_event_id` (gateway/hosted_rooms.py:235) */
const userEventId = (key: string) => `user:${createHash('sha256').update(key).digest('hex')}`

/** `_room_from_row` (gateway/hosted_rooms.py) as `groups.list`, `groups.state` and `groups.create` send a room. */
const wire = ({ room_id, name, members, at, epoch, log }: Room) =>
  ({ room_id, name, members, authority_gateway_id: GATEWAY, authority_epoch: epoch, revision: 1, created_at: at, updated_at: at, latest_seq: log.length })

/** `resolve_mentions` (gateway/hosted_room_discussion.py:347-363): the members a text names, in roster order. */
function mentioned(text: string, members: readonly Seat[], everyoneByDefault: boolean): readonly Seat[] {
  const handles = new Set([...text.matchAll(MENTION)].map(([, handle = '']) => handle.toLowerCase()))
  if (handles.has('all') || handles.has('everyone')) return members
  const named = members.filter(seat => handles.has(seat.handle.toLowerCase()))
  return named.length === 0 && everyoneByDefault ? members : named
}

/**
 * Hermes's hosted rooms. It enforces the real gateway's rules: closed key sets per method, a roster of 2 to 6 seatable
 * profiles with unique handles, one room per id, one message per `event_id`, and a log read forward from `since_seq`.
 *
 * A message starts a discussion as Hermes's planner does. Round 0 asks the members the message `@handle`s, or all of
 * them when it names none, in roster order. A reply that `@handle`s a member who has not spoken since gives that member
 * a turn in the next round. Three rounds and ten messages at most, one turn at a time. A newer message makes the
 * running turn log `turn.cancelled` `superseded_by_newer_user_event` when it ends, in place of its reply
 * (`plan_publication`), and its discussion then starts. A held turn has no end of its own, so a newer message ends it.
 * A Stop ends the running turn at once. Every change pushes `groups.changed` with the room's id, unless the header
 * says `change_events: false`.
 */
export class ScriptedRooms {
  private readonly rooms: Room[]
  private readonly seatable: readonly string[] | null
  private readonly turns: Map<string, TurnScript[]>
  private broadcasts = 0
  private tasks = 0

  constructor(readonly script: GroupsScript, private readonly deps: RoomsDeps) {
    this.seatable = script.seatable === undefined ? deps.profiles : script.seatable
    this.turns = new Map(Object.entries(script.turns ?? {}).map(([profile, turns]) => [profile, [...turns]]))
    this.rooms = (script.rooms ?? []).map(seed => this.seeded(seed))
  }

  call(method: string, params: Obj): unknown {
    const fields = FIELDS[method]
    if (fields === undefined) return this.deps.unserved(method)
    if (Object.keys(params).some(key => !fields.includes(key))) this.deps.refuse('invalid_params')
    switch (method) {
      case 'groups.capabilities': return this.capabilities()
      case 'groups.list': return this.list(params)
      case 'groups.create': return this.create(params)
      case 'groups.state': return this.state(this.room(params.room_id))
      case 'groups.log': return this.read(this.room(params.room_id), params)
      case 'groups.send': return this.send(params)
      default: return this.stop(params)
    }
  }

  private seeded({ id, name, members, epoch = 1, log = [] }: RoomSeed): Room {
    const room: Room = {
      room_id: id, name, at: this.now(), epoch, log: [], running: null, discussion: null,
      members: members.map(({ profile, handle }) => ({ member_id: profile, profile, handle, target: { kind: 'local', profile } }))
    }
    let about: LogEvent | null = null
    for (const [index, line] of log.entries()) {
      if ('user' in line) about = this.append(room, `seed:${index}`, 'message.user', { kind: 'user', id: 'user' }, { text: line.user, thread_id: 'main' })
      else this.append(room, `seed:${index}`, 'message.member', { kind: 'member', id: line.member, profile: line.member }, { member_id: line.member, discussion_event_id: about?.event_id ?? 'seed', text: line.text })
    }
    return room
  }

  private now(): number {
    return this.deps.clock.now() / 1000
  }

  private room(raw: unknown): Room {
    return this.rooms.find(room => room.room_id === raw) ?? this.deps.refuse('invalid_params')
  }

  private append(room: Room, event_id: string, kind: string, actor: Obj, payload: Obj): LogEvent {
    const event = { room_id: room.room_id, seq: room.log.length + 1, event_id, kind, actor, authority_epoch: room.epoch, payload, created_at: this.now() }
    room.log.push(event)
    return event
  }

  /** `_groups_changed_payload` (tui_gateway/change_watcher.py:434-441), after the reply that caused it, as the watcher's tick is. */
  private changed(room: Room): void {
    if (this.script.change_events === false) return
    const payload = { room_ids: [room.room_id], broadcast_id: `fixture-process:${++this.broadcasts}` }
    this.deps.clock.setTimeout(() => this.deps.broadcast({ jsonrpc: '2.0', method: 'event', params: { type: 'groups.changed', payload } }), 0)
  }

  /** gateway/session_group_controls.py:173-184 */
  private capabilities(): unknown {
    return {
      protocol_version: 1, driver: this.script.driver ?? true, persistent_process: true, authority_gateway_id: GATEWAY,
      room_link: { enabled: false, reason: 'api_server_required' }, features: ['room_identity', 'monotonic_log'],
      methods: Object.keys(FIELDS), max_log_limit: MAX_LOG_LIMIT,
      ...(this.script.seatable === null ? {} : { seatable_profiles: [...(this.seatable ?? [])].sort() })
    }
  }

  /** `listing` (gateway/session_group_controls.py:186-219) over a store with no hosted-room service. */
  private list({ limit = MAX_LIST, offset = 0, include_disbanded = false }: Obj): unknown {
    if (!isInt(limit) || limit < 1 || limit > MAX_LIST || !isInt(offset) || offset < 0 || typeof include_disbanded !== 'boolean') this.deps.refuse('invalid_params')
    const page = this.rooms.slice(offset, offset + limit)
    return { rooms: page.map(wire), next_offset: page.length === limit ? offset + limit : null }
  }

  /** `create` (gateway/session_group_controls.py:221-244): the unseatable bots, then the roster, then the room. */
  private create(params: Obj): unknown {
    const seats = this.roster(params.members)
    const id = identifier(params.room_id)
    const name = typeof params.name === 'string' ? params.name.trim() : ''
    if (id === null || name === '' || name.length > MAX_NAME) this.deps.refuse('invalid_params')
    const held = this.rooms.find(room => room.room_id === id)
    if (held !== undefined) {
      // RoomConflictError carries no reason of its own, so Hermes words it as a bare invalid_params.
      if (held.name !== name || JSON.stringify(held.members) !== JSON.stringify(seats)) this.deps.refuse('invalid_params')
      return { room: { ...wire(held), idempotent: true } }
    }
    const made: Room = { room_id: id, name, members: seats, at: this.now(), epoch: 1, log: [], running: null, discussion: null }
    this.rooms.unshift(made)
    this.changed(made)
    return { room: wire(made) }
  }

  /** `groups_state_result` (gateway/hosted_room_context.py:52-63). Without the driver there is no `driver_status`. */
  private state(room: Room): unknown {
    const { running } = room
    const activity = running === null ? [] : [{
      member_id: running.seat.member_id, status: 'running', thread_id: running.about.payload.thread_id, round_index: running.round, started_at: running.started
    }]
    return {
      room: wire(room), context: { purpose: '', notes: '' },
      ...(this.script.change_events === false ? {} : { change_events: true }),
      ...(this.script.driver === false ? {} : {
        driver_status: { running: running !== null, working: running !== null, blocked: false, counts: {}, pending_actions: [], member_activity: activity, peer_routes: [] }
      })
    }
  }

  /** `read_events_page` (persistence/sqlite/gateway/hosted_rooms.py:319-360) */
  private read(room: Room, { since_seq = 0, limit = 100 }: Obj): unknown {
    if (!isInt(since_seq) || since_seq < 0 || !isInt(limit) || limit < 1 || limit > MAX_LOG_LIMIT || since_seq > room.log.length) this.deps.refuse('invalid_params')
    const events = room.log.slice(since_seq, since_seq + limit)
    const cursor = events.at(-1)?.seq ?? since_seq
    return { events, cursor, latest_seq: room.log.length, has_more: cursor < room.log.length, authority: { gateway_id: GATEWAY, epoch: room.epoch } }
  }

  /** `send` (gateway/session_group_controls.py:313-319) and `validate_user_payload` (gateway/hosted_room_discussion.py:225-237). */
  private send({ room_id, event_id, payload }: Obj): unknown {
    if (this.script.driver === false) this.deps.refuse('runtime_coordination_required', { admitted: false })
    const room = this.room(room_id)
    const key = identifier(event_id) ?? this.deps.refuse('invalid_params')
    const fields = isObject(payload) ? Object.keys(payload).sort().join(',') : ''
    const { text, thread_id: thread } = isObject(payload) ? payload : {}
    if (fields !== 'text,thread_id' || typeof text !== 'string' || text.trim() === '' || new TextEncoder().encode(text).length > MAX_USER_TEXT_BYTES || identifier(thread) === null) {
      this.deps.refuse('invalid_params')
    }
    const id = userEventId(key)
    const held = room.log.find(event => event.event_id === id)
    if (held !== undefined) return { event: { ...held, idempotent: true }, client_event_id: key, accepted: true, driver_started: true }
    const event = this.append(room, id, 'message.user', { kind: 'user', id: 'user' }, { text: text.trim(), thread_id: thread })
    room.discussion = { about: event, round: 0, queue: [...mentioned(event.payload.text as string, room.members, true)], messages: 0 }
    const { running } = room
    if (running !== null && running.about.payload.thread_id === thread) {
      running.superseded = true
      if (running.hold) this.end(room, running, 'cancelled', { reason: SUPERSEDED })
    }
    this.next(room)
    this.changed(room)
    return { event, client_event_id: key, accepted: true, driver_started: true }
  }

  /** `stop_room`: a fence in the log, then the running turn ends at once. */
  private stop({ room_id, cancel_id }: Obj): unknown {
    if (this.script.driver === false) this.deps.refuse('runtime_coordination_required')
    const room = this.room(room_id)
    const fence = identifier(cancel_id) ?? this.deps.refuse('invalid_params')
    this.append(room, `room-stop:${createHash('sha256').update(fence).digest('hex').slice(0, 32)}`, 'room.stop_requested', { kind: 'gateway', id: GATEWAY }, { cancel_id: fence })
    const { running } = room
    room.discussion = null
    if (running !== null) this.end(room, running, 'cancelled', { reason: 'member turn cancelled' })
    this.changed(room)
    return { cancelled: running === null ? 0 : 1 }
  }

  /** The members a discussion's replies `@handle`d and have not spoken since (`_unaddressed_member_mentions`), rotated by round as `_rotate` does. */
  private cited(room: Room, discussion: Discussion, round: number): Seat[] {
    const citedAt = new Map<string, number>()
    const spokeAt = new Map<string, number>()
    for (const event of room.log) {
      if (event.kind !== 'message.member' || event.payload.discussion_event_id !== discussion.about.event_id) continue
      const speaker = event.payload.member_id as string
      spokeAt.set(speaker, event.seq)
      for (const seat of mentioned(event.payload.text as string, room.members, false)) if (seat.member_id !== speaker) citedAt.set(seat.member_id, event.seq)
    }
    const turn = round % room.members.length
    return [...room.members.slice(turn), ...room.members.slice(0, turn)]
      .filter(seat => citedAt.has(seat.member_id) && (spokeAt.get(seat.member_id) ?? 0) <= (citedAt.get(seat.member_id) ?? 0))
  }

  private next(room: Room): void {
    const { discussion } = room
    if (room.running !== null || discussion === null) return
    if (discussion.queue.length === 0 && discussion.round + 1 < MAX_ROUNDS && discussion.messages < MAX_MESSAGES) {
      discussion.round += 1
      discussion.queue = this.cited(room, discussion, discussion.round)
    }
    const seat = discussion.messages < MAX_MESSAGES ? discussion.queue.shift() : undefined
    if (seat === undefined) {
      room.discussion = null
      this.append(room, `activity:${room.log.length + 1}`, 'room.activity', { kind: 'gateway', id: GATEWAY }, { status: 'settled', reason_code: 'settled', thread_id: discussion.about.payload.thread_id, discussion_event_id: discussion.about.event_id })
      return
    }
    const script = this.turns.get(seat.profile)?.shift()
    const turn: Turn = { seat, round: discussion.round, about: discussion.about, started: this.now(), superseded: false, hold: script !== undefined && 'hold' in script, cancel: () => {} }
    room.running = turn
    if (script === undefined) {
      turn.cancel = this.deps.clock.setTimeout(() => this.end(room, turn, 'settled', { passed: true, message_event_id: null }), 0)
    } else if ('fail' in script) {
      turn.cancel = this.deps.clock.setTimeout(() => this.end(room, turn, 'failed', { error: script.fail }), script.delay_ms ?? 0)
    } else if ('reply' in script) {
      turn.cancel = this.deps.clock.setTimeout(() => this.end(room, turn, 'settled', { passed: false }, script.reply), script.delay_ms ?? 0)
    }
  }

  /** `plan_publication` (gateway/hosted_room_discussion.py:1014-1058): a reply then its receipt, or a receipt alone. A superseded turn's result is dropped. */
  private end(room: Room, turn: Turn, status: 'settled' | 'failed' | 'cancelled', extra: Obj, reply?: string): void {
    turn.cancel()
    if (room.running === turn) room.running = null
    const task = ++this.tasks
    const coordinates = {
      discussion_event_id: turn.about.event_id, member_id: turn.seat.member_id, member_index: room.members.indexOf(turn.seat), round_index: turn.round,
      task_id: `dtask:${task}`, thread_id: turn.about.payload.thread_id, turn_id: `d${turn.about.seq}.r${turn.round}.m${turn.seat.member_id}`, seen_through_seq: room.log.length
    }
    const gateway = { kind: 'gateway', id: GATEWAY }
    if (turn.superseded && status !== 'cancelled') {
      this.append(room, `dterminal:${task}`, 'turn.cancelled', gateway, { ...coordinates, reason: SUPERSEDED })
    } else if (reply !== undefined) {
      const message = this.append(room, `dmessage:${task}`, 'message.member', { kind: 'member', id: turn.seat.member_id, profile: turn.seat.profile }, { ...coordinates, text: reply })
      this.append(room, `dterminal:${task}`, 'turn.settled', gateway, { ...coordinates, ...extra, message_event_id: message.event_id })
      if (room.discussion?.about === turn.about) room.discussion.messages += 1
    } else {
      this.append(room, `dterminal:${task}`, `turn.${status}`, gateway, { ...coordinates, ...extra })
    }
    this.next(room)
    this.changed(room)
  }

  /** `refuse_unseatable` (gateway/session_hosted_members.py:65-75), then `validate_roster` (gateway/hosted_room_discussion.py:278-321). */
  private roster(raw: unknown): readonly Seat[] {
    const refuse = (detail: string): never => this.deps.refuse('invalid_params', { field: 'members', detail })
    const members = Array.isArray(raw) ? raw : []
    members.forEach((member, index) => {
      const profile = isObject(member) ? member.profile : undefined
      if (typeof profile === 'string' && this.deps.profiles.includes(profile) && this.seatable !== null && !this.seatable.includes(profile)) {
        refuse(`member ${index} profile '${profile}': this bot can't join group chats yet`)
      }
    })
    if (!Array.isArray(raw)) refuse('members must be a list')
    if (members.length < MEMBERS.min || members.length > MEMBERS.max) refuse(`members must contain between ${MEMBERS.min} and ${MEMBERS.max} entries`)
    const seen = { profiles: new Set<string>(), handles: new Set(RESERVED_HANDLES), ids: new Set<string>() }
    return members.map((member: unknown, index): Seat => {
      if (!isObject(member)) return refuse(`member ${index} must be an object`)
      const missing = ['member_id', 'profile', 'handle'].filter(key => !(key in member))
      const unknown = Object.keys(member).filter(key => !['member_id', 'profile', 'handle', 'display_name', 'target'].includes(key))
      if (missing.length > 0) refuse(`member ${index} is missing fields: ${missing.join(', ')}`)
      if (unknown.length > 0) refuse(`member ${index} has unknown fields: ${unknown.sort().join(', ')}`)
      const id = identifier(member.member_id) ?? refuse(`invalid member ${index} id`)
      const profile = identifier(member.profile) ?? refuse(`invalid member ${index} profile`)
      const handle = identifier(member.handle) ?? refuse(`invalid member ${index} handle`)
      const { target, display_name: label = '' } = member
      if (target !== undefined && target !== null && !isDeepStrictEqual(target, { kind: 'local', profile })) {
        refuse(`member ${index} target must be a local target for its profile`)
      }
      if (!this.deps.profiles.includes(profile)) refuse(`member ${index} profile '${profile}' is not local to this gateway`)
      if (typeof label !== 'string') return refuse(`member ${index} display_name must be a string`)
      const shown = label.trim()
      if (shown.length > MAX_LABEL) refuse(`member ${index} display_name is too long`)
      for (const [key, set, problem] of [
        [profile, seen.profiles, 'member profiles must be unique'],
        [handle.toLowerCase(), seen.handles, 'member handles must be unique and cannot reserve @all or @everyone'],
        [id.toLowerCase(), seen.ids, 'member ids must be unique']
      ] as const) {
        if (set.has(key)) refuse(problem)
        set.add(key)
      }
      return { member_id: id, profile, handle, target: { kind: 'local', profile }, ...(shown === '' ? {} : { display_name: shown }) }
    })
  }
}
