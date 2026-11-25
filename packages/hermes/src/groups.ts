import { refusalOf } from './actor'
import type { Bot } from './domain/bots'
import type { Outcome, Refusal } from './domain/command'
import { EMPTY_GROUPS, groupsOf, nextGroups, seatsFor, type GroupDraft, type GroupNews, type Groups } from './domain/groups'
import type { Link } from './domain/session'
import { NOT_CONNECTED } from './open'
import { METHOD_NOT_FOUND, Offline, RpcRefusal, type Method, type Served } from './wire/link'
import { parseGroupList, parseGroupMade, parseGroupSupport } from './wire/parse'

type GroupMethod = Extract<Method, `groups.${string}`>

/**
 * What the book may use of the connection. A group belongs to the socket's own profile, so a call never names a
 * bot: Hermes refuses a frame that names another profile `profile_mismatch` (gateway/session_group_controls.py:67-80).
 */
export interface GroupWire {
  call<M extends GroupMethod>(method: M, params: Served[M]['params'], timeoutMs?: number): Promise<Served[M]['result']>
}

/** Hermes reads every bot it could seat for `groups.capabilities`, so a slow disk can stall it. */
const READ_TIMEOUT_MS = 10_000

const DONE: Outcome = { ok: true, value: undefined }
const NO_GROUPS: Refusal = { kind: 'unsupported', message: 'This Hermes has no group chats. Update Hermes on that machine, then reconnect.' }
const NOT_ALLOWED: Refusal = { kind: 'rejected', message: "Hermes won't let this connection make group chats." }
const GONE_BOT: Outcome<never> = { ok: false, refusal: { kind: 'rejected', field: 'members', message: "One of these bots isn't on this Hermes any more." } }

/** Every group refusal is code 4001, so Hermes's `reason` tells them apart (`dispatch_group_control`). */
const CREATE_REASONS = new Map<string | null, (error: RpcRefusal) => Refusal>([
  ['invalid_params', ({ field, detail }) => field === 'members'
    ? { kind: 'rejected', field: 'members', message: detail === null ? "Hermes can't seat these bots." : `Hermes can't seat these bots: ${detail}` }
    // An id Hermes holds for another group, or once held for a disbanded one. The dialog's next try is under a new id.
    : { kind: 'conflict', message: "Hermes didn't accept this group chat. Try again." }],
  ['permission_denied', () => NOT_ALLOWED],
  ['profile_mismatch', () => NOT_ALLOWED]
])

function refusedCreate(error: unknown): Outcome<never> {
  if (error instanceof Offline) return NOT_CONNECTED
  if (!(error instanceof RpcRefusal)) throw error
  return { ok: false, refusal: error.code === METHOD_NOT_FOUND ? NO_GROUPS : CREATE_REASONS.get(error.reason)?.(error) ?? refusalOf(error) }
}

export interface GroupBook {
  readonly groups: Groups
  linked(state: Link['state']): void
  /**
   * Asks what this Hermes can do with groups, then for its list. For a new socket: whatever the last one said, this
   * Hermes may know more. One ask is in flight at a time, and asking during it runs one more after it.
   */
  ask(): void
  /** Sessions changed, and so may the bots Hermes would seat or the groups another client made. Asks again, except of a Hermes with no group chats. */
  refresh(): void
  /**
   * Makes the group and lists it at once. `roster` is the bots Highwing lists now, which name the seats. Hermes is
   * asked again after any try, because a create whose answer was lost may have made the group.
   */
  create(draft: GroupDraft, roster: readonly Bot[]): Promise<Outcome>
}

/**
 * The one owner of what Highwing knows about group chats, for the hub's lifetime. It holds one `GroupDesk`, changes it
 * only through `nextGroups`, and makes every `groups.*` call. `changed` runs after every change of `groups`, and never
 * for an answer that changed nothing.
 */
export function groupBook(conn: GroupWire, changed: () => void): GroupBook {
  let desk = EMPTY_GROUPS
  let groups = groupsOf(desk)
  let asking = false
  let again = false

  const take = (news: GroupNews) => {
    desk = nextGroups(desk, news)
    const next = groupsOf(desk)
    if (JSON.stringify(next) === JSON.stringify(groups)) return
    groups = next
    changed()
  }

  const fetch = async () => {
    asking = true
    try {
      take({ on: 'support', support: parseGroupSupport(await conn.call('groups.capabilities', {}, READ_TIMEOUT_MS)) })
      take({ on: 'listed', groups: parseGroupList(await conn.call('groups.list', {}, READ_TIMEOUT_MS)) })
    } catch (error) {
      if (error instanceof RpcRefusal) take({ on: 'support', support: { is: error.code === METHOD_NOT_FOUND ? 'unsupported' : 'refused' } })
      else if (!(error instanceof Offline)) throw error
    } finally {
      asking = false
    }
    if (again) {
      again = false
      refresh()
    }
  }

  const ask = () => {
    if (asking) again = true
    else void fetch()
  }
  const refresh = () => {
    if (desk.support.is !== 'unsupported') ask()
  }

  return {
    get groups() { return groups },
    linked: state => {
      if (state !== 'connecting') take({ on: 'link', offline: state !== 'online' })
    },
    ask,
    refresh,
    create: async (draft, roster) => {
      const picked = draft.bots.flatMap(id => roster.filter(bot => bot.id === id))
      if (picked.length !== draft.bots.length) return GONE_BOT
      const members = seatsFor(picked).map(({ id, bot, handle }) => ({ member_id: id, profile: bot, handle }))
      try {
        const made = parseGroupMade(await conn.call('groups.create', { room_id: draft.group, name: draft.name, members }))
        if (made !== null) take({ on: 'made', group: made })
        return DONE
      } catch (error) {
        return refusedCreate(error)
      } finally {
        ask()
      }
    }
  }
}
