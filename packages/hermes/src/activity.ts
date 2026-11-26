import { botActivitiesOf, sameActivities, unreadAfter, type BotActivities, type Busy, type BusyChats, type ChatBusy, type UnreadChat } from './domain/activity'
import type { BotId } from './domain/bots'
import { activityOf } from './domain/reduce'
import type { SessionContent, SessionId, SidebarRow } from './domain/session'
import { BADGES } from './sidebar'
import { METHOD_NOT_FOUND, Offline, RpcRefusal, type Connection, type Served } from './wire/link'

type LiveStatus = Served['session.active_list']['result']['sessions'][number]['status']

/** gateway/session_active_list.py `_status`: 'waiting' is a turn an approval or a viewer request holds, 'idle' an open chat with no turn. */
export const STATUS_BUSY: { readonly [S in LiveStatus]: ChatBusy | null } = {
  idle: null, starting: 'working', working: 'working', streaming: 'working', resuming: 'working', waiting: 'waiting'
}

const BADGE_BUSY: { readonly [B in SidebarRow['badge']]: ChatBusy | null } = { none: null, running: 'working', asking: 'waiting' }

export const busyOf = (session: SessionContent): ChatBusy | null => BADGE_BUSY[BADGES[activityOf(session).kind]]

/** A chat an attached actor knows. Fresher than a poll, so an idle one is not busy whatever the poll said. */
export interface Attached { readonly bot: BotId | undefined; readonly busy: ChatBusy | null }

export interface ActivityDesk {
  readonly activity: BotActivities
  /** Reads the attached and the shown chats again. */
  update(): void
  /** Asks each listed bot for its live chats, one at a time. Asked during a sweep, it sweeps once more after it. */
  poll(): void
  /** The listed bots, or null while there is no roster. A new set is polled, and a bot that left takes its chats with it. */
  roster(bots: readonly BotId[] | null): void
  /** The chat is gone from its bot, so it can never be opened to be read. */
  forget(chat: SessionId): void
}

export interface ActivityDeps {
  readonly unread: readonly UnreadChat[]
  readonly keep: (chats: readonly UnreadChat[]) => void
  readonly local: () => { readonly attached: ReadonlyMap<SessionId, Attached>; readonly shown: ReadonlySet<SessionId> }
  readonly changed: () => void
}

/**
 * Owns which bots are busy and which chats are unread. Hermes lists a profile's live chats on
 * `session.active_list`, so each bot is asked through its own profile, and only on a socket that
 * reaches every profile. A Hermes without the call shows what attached chats say.
 */
export function activityDesk(conn: Pick<Connection, 'reach' | 'as'>, deps: ActivityDeps): ActivityDesk {
  let unread = deps.unread
  let busy: BusyChats = new Map()
  let activity = botActivitiesOf(busy, unread)
  let bots: readonly BotId[] = []
  const polled = new Map<BotId, ReadonlyMap<SessionId, ChatBusy>>()
  /** Each live chat's message count at the last sweep. A turn can start and end between two sweeps, and only its count says so. */
  const counts = new Map<SessionId, number>()
  /** Chats a sweep found idle with more messages than the sweep before: a turn ended unseen by any sweep. An attached chat says for itself. */
  let ended = new Map<SessionId, Busy>()
  let unsupported = false
  let sweeping = false
  let again = false

  const update = () => {
    const { attached, shown } = deps.local()
    const after = new Map<SessionId, Busy>()
    for (const [bot, chats] of polled) for (const [chat, state] of chats) after.set(chat, { bot, busy: state })
    for (const [chat, known] of attached) {
      const bot = known.bot ?? after.get(chat)?.bot
      if (known.busy === null || bot === undefined) after.delete(chat)
      else after.set(chat, { bot, busy: known.busy })
    }
    const unseen = [...ended].filter(([chat]) => !attached.has(chat))
    const next = unreadAfter(unread, new Map([...unseen, ...busy]), after, shown)
    busy = after
    ended = new Map()
    if (next !== unread) {
      unread = next
      deps.keep(unread)
    }
    const shows = botActivitiesOf(busy, unread)
    if (sameActivities(shows, activity)) return
    activity = shows
    deps.changed()
  }

  /** false: stop the sweep. */
  const ask = async (bot: BotId): Promise<boolean> => {
    try {
      const { sessions } = await conn.as(bot).call('session.active_list', {})
      // The roster may have dropped the bot while it was asked.
      if (!bots.includes(bot)) return true
      polled.set(bot, new Map(sessions.flatMap(row => {
        const state = STATUS_BUSY[row.status] ?? null
        return state === null ? [] : [[row.id as SessionId, state] as const]
      })))
      for (const row of sessions) {
        const chat = row.id as SessionId
        const before = counts.get(chat)
        if (before !== undefined && row.message_count > before && STATUS_BUSY[row.status] === null) ended.set(chat, { bot, busy: 'working' })
        counts.set(chat, row.message_count)
      }
      update()
      return true
    } catch (error) {
      if (error instanceof RpcRefusal && error.code === METHOD_NOT_FOUND) {
        unsupported = true
        polled.clear()
        update()
        return false
      }
      if (error instanceof RpcRefusal) return true
      if (error instanceof Offline) return false
      throw error
    }
  }

  const sweep = async () => {
    sweeping = true
    try {
      for (const bot of bots) {
        if (!(await ask(bot))) break
      }
    } finally {
      sweeping = false
    }
    if (again) {
      again = false
      poll()
    }
  }

  const poll = () => {
    if (unsupported || conn.reach !== 'host' || bots.length === 0) return
    if (sweeping) again = true
    else void sweep()
  }

  return {
    get activity() { return activity },
    update,
    poll,
    roster: next => {
      if (next === null) return
      const listed = new Set(next)
      if (next.length === bots.length && bots.every(bot => listed.has(bot))) return
      bots = next
      for (const bot of polled.keys()) if (!listed.has(bot)) polled.delete(bot)
      busy = new Map([...busy].filter(([, { bot }]) => listed.has(bot)))
      const kept = unread.filter(each => listed.has(each.bot))
      if (kept.length !== unread.length) {
        unread = kept
        deps.keep(unread)
      }
      update()
      poll()
    },
    forget: chat => {
      if (!unread.some(each => each.chat === chat)) return
      unread = unread.filter(each => each.chat !== chat)
      deps.keep(unread)
      update()
    }
  }
}
