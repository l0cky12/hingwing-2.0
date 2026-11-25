/**
 * Hermes's group chats as far as Highwing uses them, played from a fixture's `groups` header. Every rule is the real
 * gateway's, so a client bug fails a fixture test instead of waiting for a live Hermes. The numbers are copied from
 * Hermes, never imported from the client, because this is the oracle the client is tested against.
 */
import type { Clock } from '../wire/link'
import type { GroupsScript } from './fixture'

type Obj = { readonly [key: string]: unknown }

export interface RoomsDeps {
  readonly clock: Clock
  /** Every profile the gateway serves. */
  readonly profiles: readonly string[]
  /** Throws Hermes's refusal: `reason`, and the `field` and `detail` of the check that fired when it names them. */
  refuse(reason: string, named?: { readonly field: string; readonly detail: string }): never
  /** A `groups.*` method Hermes has and this gateway does not play. Fails the run. */
  unserved(method: string): never
}

/** `_FIELDS` (gateway/session_group_controls.py:36-59). The dispatch takes `profile` off before a room sees the call. */
const FIELDS: { readonly [method: string]: readonly string[] } = {
  'groups.capabilities': [],
  'groups.list': ['limit', 'offset', 'include_disbanded'],
  'groups.create': ['room_id', 'name', 'members']
}

/** gateway/hosted_room_discussion.py:30-31 */
const MEMBERS = { min: 2, max: 6 }
/** gateway/hosted_rooms_common.py:19 and the 128-character cap every identifier has. */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
/** gateway/hosted_rooms.py:37, :40 and :46 */
const MAX_NAME = 200
const MAX_LABEL = 200
const MAX_LIST = 500
const RESERVED_HANDLES = ['all', 'everyone']
const GATEWAY = 'fixture-gateway'

interface Seat {
  readonly member_id: string
  readonly profile: string
  readonly handle: string
  readonly target: { readonly kind: 'local'; readonly profile: string }
  readonly display_name?: string
}

interface Room {
  readonly room_id: string
  readonly name: string
  readonly members: readonly Seat[]
  readonly at: number
}

const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)
const identifier = (value: unknown): string | null => {
  const held = typeof value === 'string' ? value.trim() : ''
  return IDENTIFIER.test(held) ? held : null
}

/** `_room_from_row` (gateway/hosted_rooms.py) as `groups.list` and `groups.create` send a room. */
const wire = ({ room_id, name, members, at }: Room) =>
  ({ room_id, name, members, authority_gateway_id: GATEWAY, authority_epoch: 1, revision: 1, created_at: at, updated_at: at, latest_seq: 0 })

export class ScriptedRooms {
  /** Most recently changed first. */
  private readonly rooms: Room[]
  private readonly seatable: readonly string[] | null

  constructor(readonly script: GroupsScript, private readonly deps: RoomsDeps) {
    this.seatable = script.seatable === undefined ? deps.profiles : script.seatable
    this.rooms = (script.rooms ?? []).map(({ id, name, members }) => ({
      room_id: id, name, at: deps.clock.now() / 1000,
      members: members.map(({ profile, handle }) => ({ member_id: profile, profile, handle, target: { kind: 'local', profile } }))
    }))
  }

  call(method: string, params: Obj): unknown {
    const fields = FIELDS[method]
    if (fields === undefined) return this.deps.unserved(method)
    if (Object.keys(params).some(key => !fields.includes(key))) this.deps.refuse('invalid_params')
    switch (method) {
      case 'groups.capabilities': return this.capabilities()
      case 'groups.list': return this.list(params)
      default: return this.create(params)
    }
  }

  /** gateway/session_group_controls.py:166-177 */
  private capabilities(): unknown {
    return {
      protocol_version: 1, driver: this.script.driver ?? true, persistent_process: true, authority_gateway_id: GATEWAY,
      room_link: { enabled: false, reason: 'api_server_required' }, features: ['room_identity', 'monotonic_log'],
      methods: Object.keys(FIELDS), max_log_limit: 500,
      ...(this.script.seatable === null ? {} : { seatable_profiles: [...(this.seatable ?? [])].sort() })
    }
  }

  /** `listing` (gateway/session_group_controls.py:179-192) over a store with no hosted-room service. */
  private list({ limit = MAX_LIST, offset = 0, include_disbanded = false }: Obj): unknown {
    if (!isInt(limit) || limit < 1 || limit > MAX_LIST || !isInt(offset) || offset < 0 || typeof include_disbanded !== 'boolean') this.deps.refuse('invalid_params')
    const page = this.rooms.slice(offset, offset + limit)
    return { rooms: page.map(wire), next_offset: page.length === limit ? offset + limit : null }
  }

  /** `create` (gateway/session_group_controls.py:221-246): the unseatable bots, then the roster, then the room. */
  private create(params: Obj): unknown {
    const seats = this.roster(params.members)
    const id = identifier(params.room_id)
    const name = typeof params.name === 'string' ? params.name.trim() : ''
    if (id === null || name === '' || name.length > MAX_NAME) this.deps.refuse('invalid_params')
    const made: Room = { room_id: id, name, members: seats, at: this.deps.clock.now() / 1000 }
    const held = this.rooms.find(room => room.room_id === id)
    if (held !== undefined) {
      // RoomConflictError carries no reason of its own, so Hermes words it as a bare invalid_params.
      if (held.name !== name || JSON.stringify(held.members) !== JSON.stringify(seats)) this.deps.refuse('invalid_params')
      return { room: { ...wire(held), idempotent: true } }
    }
    this.rooms.unshift(made)
    return { room: wire(made) }
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
      if (target !== undefined && target !== null && !(isObject(target) && target.kind === 'local' && target.profile === profile && Object.keys(target).length === 2)) {
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
