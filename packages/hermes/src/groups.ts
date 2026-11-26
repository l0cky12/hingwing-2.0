import { createHash } from 'node:crypto'
import { refusalOf } from './actor'
import type { Bot } from './domain/bots'
import type { Outcome, Refusal } from './domain/command'
import {
  EMPTY_GROUPS, groupChatOf, groupsOf, logStart, nextGroups, nextPoll, seatsFor, type GroupChat, type GroupDraft, type GroupId, type GroupNews, type Groups
} from './domain/groups'
import type { Link } from './domain/session'
import { NOT_CONNECTED } from './open'
import { METHOD_NOT_FOUND, Offline, RpcRefusal, type Clock, type Method, type Served } from './wire/link'
import { parseGroupList, parseGroupMade, parseGroupPage, parseGroupState, parseGroupSupport } from './wire/parse'

type GroupMethod = Extract<Method, `groups.${string}`>

/**
 * What the book may use of the connection. A group belongs to the socket's own profile, so a call never names a
 * bot: Hermes refuses a frame that names another profile `profile_mismatch` (gateway/session_group_controls.py:67-80).
 */
export interface GroupWire {
  call<M extends GroupMethod>(method: M, params: Served[M]['params'], timeoutMs?: number): Promise<Served[M]['result']>
}

export interface GroupBookDeps {
  readonly clock: Clock
  readonly mintId: () => string
  readonly changed: () => void
}

/** Hermes reads every bot it could seat for `groups.capabilities` and `groups.create`, so a slow disk can stall either. */
const CALL_TIMEOUT_MS = 10_000
/** `MAX_LOG_LIMIT` (gateway/hosted_rooms.py:44). */
const LOG_PAGE = 500
/** `MAX_USER_TEXT_BYTES` (gateway/hosted_room_discussion.py:35). */
const TEXT_MAX_BYTES = 64 * 1024
/**
 * Every message to a group goes out on this one thread. Hermes drops a member's late reply only when a newer message
 * arrived in the same thread (`plan_publication`, gateway/hosted_room_discussion.py:1032-1034), so a second thread id
 * would let a stale reply land under a newer question.
 */
const THREAD = 'main'

const DONE: Outcome = { ok: true, value: undefined }
const NO_GROUPS: Refusal = { kind: 'unsupported', message: 'This Hermes has no group chats. Update Hermes on that machine, then reconnect.' }
const NOT_ALLOWED: Refusal = { kind: 'rejected', message: "Hermes won't let this connection use group chats." }
const NOT_RUNNING: Refusal = { kind: 'rejected', message: "Hermes isn't running group chats right now." }
const GONE_BOT: Outcome<never> = { ok: false, refusal: { kind: 'rejected', field: 'members', message: "One of these bots isn't on this Hermes any more." } }
const GONE_GROUP: Refusal = { kind: 'stale', message: "Hermes no longer has this group chat." }
const TOO_LONG: Outcome<never> = { ok: false, refusal: { kind: 'rejected', message: 'This message is too long for a group chat. Hermes takes up to 64 KB of text.' } }

type During = 'create' | 'send' | 'stop'

/** Every group refusal is code 4001, so Hermes's `reason` tells them apart (`dispatch_group_control`). */
const REASONS = new Map<string | null, (error: RpcRefusal, during: During) => Refusal>([
  ['invalid_params', ({ field, detail }, during) => {
    if (during !== 'create') return GONE_GROUP
    if (field === 'members') return { kind: 'rejected', field: 'members', message: detail === null ? "Hermes can't seat these bots." : `Hermes can't seat these bots: ${detail}` }
    return { kind: 'rejected', message: detail === null ? "Hermes didn't accept this group chat. Try again." : `Hermes didn't accept this group chat: ${detail}` }
  }],
  ['permission_denied', () => NOT_ALLOWED],
  ['profile_mismatch', () => NOT_ALLOWED],
  ['runtime_coordination_required', () => NOT_RUNNING],
  ['room_stop_pending', () => ({ kind: 'rejected', message: 'Hermes is already stopping this group chat.' })]
])

function refusedBy(error: unknown, during: During): Outcome<never> {
  if (error instanceof Offline) return NOT_CONNECTED
  if (!(error instanceof RpcRefusal)) throw error
  return { ok: false, refusal: error.code === METHOD_NOT_FOUND ? NO_GROUPS : REASONS.get(error.reason)?.(error, during) ?? refusalOf(error) }
}

/** `user_event_id` (gateway/hosted_rooms.py:235): the id Hermes files a message under, from the `event_id` it was sent with. */
const loggedAs = (key: string) => `user:${createHash('sha256').update(key).digest('hex')}`

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const unread = (error: unknown): null => {
  if (error instanceof Offline || error instanceof RpcRefusal) return null
  throw error
}

export interface GroupBook {
  readonly groups: Groups
  readonly chat: GroupChat | null
  linked(state: Link['state']): void
  /** A new socket: pushes sent while the last one was down are gone, so every listed group is read again. */
  online(): void
  refresh(): void
  moved(rooms: readonly GroupId[] | 'all'): void
  follow(group: GroupId | null): void
  create(draft: GroupDraft, roster: readonly Bot[]): Promise<Outcome>
  /** A message sent again after its answer was lost goes out under the same `event_id`, so Hermes keeps it once. */
  send(group: GroupId, text: string): Promise<Outcome>
  stop(group: GroupId): Promise<Outcome>
  close(): void
}

export function groupBook(conn: GroupWire, deps: GroupBookDeps): GroupBook {
  let desk = EMPTY_GROUPS
  let groups = groupsOf(desk)
  let chat = groupChatOf(desk)
  let listing: Promise<boolean> | null = null
  let queued: Promise<boolean> | null = null
  const reads = new Map<GroupId, 'once' | 'again'>()
  const unanswered = new Map<GroupId, { readonly text: string; readonly key: string }>()
  let cancelPoll: (() => void) | null = null

  const take = (news: GroupNews) => {
    desk = nextGroups(desk, news)
    const nextGroupsShown = groupsOf(desk)
    const nextChat = groupChatOf(desk)
    const groupsMoved = !sameJson(nextGroupsShown, groups)
    const chatMoved = !sameJson(nextChat, chat)
    if (groupsMoved) groups = nextGroupsShown
    if (chatMoved) chat = nextChat
    if (groupsMoved || chatMoved) deps.changed()
  }

  /** false: the connection dropped before Hermes answered. */
  const fetch = async (): Promise<boolean> => {
    try {
      take({ on: 'support', support: parseGroupSupport(await conn.call('groups.capabilities', {}, CALL_TIMEOUT_MS)) })
      take({ on: 'listed', groups: parseGroupList(await conn.call('groups.list', {}, CALL_TIMEOUT_MS)) })
      return true
    } catch (error) {
      if (error instanceof Offline) return false
      if (!(error instanceof RpcRefusal)) throw error
      take({ on: 'support', support: { is: error.code === METHOD_NOT_FOUND ? 'unsupported' : 'refused' } })
      return true
    }
  }

  const ask = (): Promise<boolean> => {
    if (listing === null) {
      listing = fetch().finally(() => { listing = null })
      return listing
    }
    queued ??= listing.then(() => {
      queued = null
      return ask()
    })
    return queued
  }

  const stopPoll = () => {
    cancelPoll?.()
    cancelPoll = null
  }

  const arm = () => {
    stopPoll()
    const next = nextPoll(desk)
    if (next !== null) {
      cancelPoll = deps.clock.setTimeout(() => {
        cancelPoll = null
        for (const group of nextPoll(desk)?.groups ?? []) read(group)
      }, next.ms)
    }
  }

  const readOnce = async (group: GroupId) => {
    try {
      const state = parseGroupState(await conn.call('groups.state', { room_id: group }, CALL_TIMEOUT_MS))
      if (state === null) return
      take({ on: 'state', ...state })
    } catch (error) {
      if (error instanceof Offline) return
      if (!(error instanceof RpcRefusal)) throw error
      // Highwing's params are a fixed, closed set, so a bare `invalid_params` is Hermes's word for a room it does not have (session_group_controls.py:97-102).
      if (error.reason === 'invalid_params') {
        take({ on: 'missing', group })
        void ask()
      }
      return
    }
    const held = desk.held[group]
    let start = held === undefined || desk.followed !== group ? null : logStart(held)
    while (start !== null && desk.followed === group) {
      const reply = await conn.call('groups.log', { room_id: group, since_seq: start, limit: LOG_PAGE }, CALL_TIMEOUT_MS).catch(unread)
      const page = reply === null ? null : parseGroupPage(reply)
      if (page === null) return
      take({ on: 'page', group, after: start, ...page })
      start = page.more && page.cursor > start ? page.cursor : null
    }
  }

  const read = (group: GroupId): void => {
    if (reads.has(group)) return void reads.set(group, 'again')
    reads.set(group, 'once')
    void readOnce(group).finally(() => {
      const again = reads.get(group) === 'again'
      reads.delete(group)
      if (again) read(group)
      else arm()
    })
  }

  const readHeld = (rooms: readonly GroupId[]) => {
    for (const group of rooms) if (Object.hasOwn(desk.held, group)) read(group)
  }

  const moved = (rooms: readonly GroupId[] | 'all') => {
    if (rooms !== 'all' && rooms.every(group => Object.hasOwn(desk.held, group))) return readHeld(rooms)
    void ask().then(reached => {
      if (reached) readHeld(rooms === 'all' ? Object.values(desk.held).map(held => held.facts.id) : rooms)
    })
  }

  const blocked = (): Outcome<never> | null => {
    const { support } = desk
    if (support.is === 'unsupported') return { ok: false, refusal: NO_GROUPS }
    if (support.is === 'refused') return { ok: false, refusal: NOT_ALLOWED }
    return support.is === 'able' && !support.driver ? { ok: false, refusal: NOT_RUNNING } : null
  }

  const refuseAndReread = (error: unknown, group: GroupId, during: During): Outcome<never> => {
    if (error instanceof RpcRefusal && error.reason === 'runtime_coordination_required') void ask()
    if (error instanceof RpcRefusal && error.reason === 'invalid_params') read(group)
    return refusedBy(error, during)
  }

  return {
    get groups() { return groups },
    get chat() { return chat },
    linked: state => {
      if (state !== 'connecting') take({ on: 'link', offline: state !== 'online' })
      if (state !== 'online') stopPoll()
    },
    online: () => moved('all'),
    refresh: () => {
      if (desk.support.is !== 'unsupported') void ask()
    },
    moved,
    follow: group => {
      if (desk.followed === group) return
      take({ on: 'followed', group })
      if (group === null) arm()
      else read(group)
    },
    create: async (draft, roster) => {
      const picked = draft.bots.flatMap(id => roster.filter(bot => bot.id === id))
      if (picked.length !== draft.bots.length) return GONE_BOT
      const members = seatsFor(picked).map(({ id, bot, handle }) => ({ member_id: id, profile: bot, handle }))
      let outcome: Outcome
      try {
        const made = parseGroupMade(await conn.call('groups.create', { room_id: draft.group, name: draft.name, members }, CALL_TIMEOUT_MS))
        if (made !== null) take({ on: 'made', facts: made })
        outcome = DONE
      } catch (error) {
        outcome = refusedBy(error, 'create')
      }
      // A refusal moves the dialog to a new id, so the list must first show whether a lost earlier try made the group.
      const reached = await ask()
      return outcome.ok || reached ? outcome : NOT_CONNECTED
    },
    send: async (group, text) => {
      const refused = blocked()
      if (refused !== null) return refused
      if (new TextEncoder().encode(text).length > TEXT_MAX_BYTES) return TOO_LONG
      const lost = unanswered.get(group)
      const key = lost?.text === text ? lost.key : deps.mintId()
      take({ on: 'sending', group, message: { key, eventId: loggedAs(key), text } })
      try {
        await conn.call('groups.send', { room_id: group, event_id: key, payload: { text, thread_id: THREAD } }, CALL_TIMEOUT_MS)
      } catch (error) {
        take({ on: 'unsent', group, key })
        if (error instanceof Offline) {
          unanswered.set(group, { text, key })
          return NOT_CONNECTED
        }
        unanswered.delete(group)
        return refuseAndReread(error, group, 'send')
      }
      unanswered.delete(group)
      read(group)
      return DONE
    },
    stop: async group => {
      const refused = blocked()
      if (refused !== null) return refused
      try {
        await conn.call('groups.stop', { room_id: group, cancel_id: deps.mintId() }, CALL_TIMEOUT_MS)
      } catch (error) {
        return refuseAndReread(error, group, 'stop')
      }
      read(group)
      return DONE
    },
    close: stopPoll
  }
}
