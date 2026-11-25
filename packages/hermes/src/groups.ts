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

/** Hermes reads every bot it could seat for `groups.capabilities` and `groups.create`, so a slow disk can stall either. */
const CALL_TIMEOUT_MS = 10_000

const DONE: Outcome = { ok: true, value: undefined }
const NO_GROUPS: Refusal = { kind: 'unsupported', message: 'This Hermes has no group chats. Update Hermes on that machine, then reconnect.' }
const NOT_ALLOWED: Refusal = { kind: 'rejected', message: "Hermes won't let this connection make group chats." }
const GONE_BOT: Outcome<never> = { ok: false, refusal: { kind: 'rejected', field: 'members', message: "One of these bots isn't on this Hermes any more." } }

/** Every group refusal is code 4001, so Hermes's `reason` tells them apart (`dispatch_group_control`). */
const CREATE_REASONS = new Map<string | null, (error: RpcRefusal) => Refusal>([
  ['invalid_params', ({ field, detail }) => field === 'members'
    ? { kind: 'rejected', field: 'members', message: detail === null ? "Hermes can't seat these bots." : `Hermes can't seat these bots: ${detail}` }
    : { kind: 'rejected', message: detail === null ? "Hermes didn't accept this group chat. Try again." : `Hermes didn't accept this group chat: ${detail}` }],
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
  ask(): void
  refresh(): void
  create(draft: GroupDraft, roster: readonly Bot[]): Promise<Outcome>
}

export function groupBook(conn: GroupWire, changed: () => void): GroupBook {
  let desk = EMPTY_GROUPS
  let groups = groupsOf(desk)
  let reading: Promise<boolean> | null = null
  let queued: Promise<boolean> | null = null

  const take = (news: GroupNews) => {
    desk = nextGroups(desk, news)
    const next = groupsOf(desk)
    if (JSON.stringify(next) === JSON.stringify(groups)) return
    groups = next
    changed()
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
    if (reading === null) {
      reading = fetch().finally(() => { reading = null })
      return reading
    }
    queued ??= reading.then(() => {
      queued = null
      return ask()
    })
    return queued
  }
  const refresh = () => {
    if (desk.support.is !== 'unsupported') void ask()
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
      let outcome: Outcome
      try {
        const made = parseGroupMade(await conn.call('groups.create', { room_id: draft.group, name: draft.name, members }, CALL_TIMEOUT_MS))
        if (made !== null) take({ on: 'made', group: made })
        outcome = DONE
      } catch (error) {
        outcome = refusedCreate(error)
      }
      // A refusal moves the dialog to a new id, so the list must first show whether a lost earlier try made the group.
      const reached = await ask()
      return outcome.ok || reached ? outcome : NOT_CONNECTED
    }
  }
}
