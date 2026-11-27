/** What the bots sidebar shows on a bot's face: a turn under way, a turn waiting on the user, or a reply not yet seen. */
import type { BotId } from './bots'
import type { SessionId } from './session'

/** What a bot's face shows. One at a time: waiting over working over unread. */
export type BotActivity = 'waiting' | 'working' | 'unread'
/** Bots with something to show. A bot not in it shows nothing. Plain JSON: it crosses IPC. */
export type BotActivities = Readonly<Partial<Record<BotId, BotActivity>>>
/** A chat whose turn ended while no window showed it. Kept across restarts. */
export interface UnreadChat { readonly chat: SessionId; readonly bot: BotId }
/** A chat with a turn under way, and whether it waits on the user. */
export type ChatBusy = 'working' | 'waiting'
export interface Busy { readonly bot: BotId; readonly busy: ChatBusy }
export type BusyChats = ReadonlyMap<SessionId, Busy>

/**
 * A chat busy `before` and not `after` ended its turn: unread, unless a window shows it. A shown
 * chat is read. The same array when nothing changed, so a caller can skip a write.
 */
export function unreadAfter(unread: readonly UnreadChat[], before: BusyChats, after: BusyChats, shown: ReadonlySet<SessionId>): readonly UnreadChat[] {
  const held = new Set(unread.map(each => each.chat))
  const ended = [...before].flatMap(([chat, { bot }]) => (after.has(chat) || shown.has(chat) || held.has(chat) ? [] : [{ chat, bot }]))
  const seen = unread.some(each => shown.has(each.chat))
  if (ended.length === 0 && !seen) return unread
  return [...unread.filter(each => !shown.has(each.chat)), ...ended]
}

/** Lower wins. */
const PRECEDENCE: { readonly [A in BotActivity]: number } = { waiting: 0, working: 1, unread: 2 }

export function botActivitiesOf(busy: BusyChats, unread: readonly UnreadChat[]): BotActivities {
  const shown = new Map<BotId, BotActivity>()
  const offer = (bot: BotId, activity: BotActivity) => {
    const held = shown.get(bot)
    if (held === undefined || PRECEDENCE[activity] < PRECEDENCE[held]) shown.set(bot, activity)
  }
  for (const { bot, busy: activity } of busy.values()) offer(bot, activity)
  for (const { bot } of unread) offer(bot, 'unread')
  return Object.fromEntries(shown)
}

/** An own key only: a bot may be named `constructor`. */
export const activityIn = (activities: BotActivities | undefined, bot: BotId): BotActivity | null =>
  activities !== undefined && Object.hasOwn(activities, bot) ? activities[bot] ?? null : null

export function sameActivities(a: BotActivities, b: BotActivities): boolean {
  const keys = Object.keys(a) as BotId[]
  return keys.length === Object.keys(b).length && keys.every(bot => activityIn(a, bot) === activityIn(b, bot))
}
