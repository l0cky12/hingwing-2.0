import { shownBot, shownChat, type BotId, type Bots, type OpenChat, type SessionId, type Sidebar, type SidebarRow } from '@highwing/hermes/domain'
import type { Snoozes } from '../../ipc-contract'

export type ChatGroup = 'pinned' | 'sessions' | 'snoozed'

export interface ChatRow {
  readonly id: SessionId
  /** The row's accessible name. Never blank. */
  readonly name: string
  readonly preview: string | null
  /** When it was last used, as `agoOf` says it. Empty when Hermes did not say. */
  readonly when: string
  /** What the chat is doing, or until when it is snoozed. null: neither, so the row shows its preview instead. */
  readonly doing: string | null
  readonly badge: SidebarRow['badge']
  readonly current: boolean
  readonly showsDraft: boolean
  /** Pinned by the user. */
  readonly pinned: boolean
  readonly group: ChatGroup
  /** What its menu offers, in groups, in order. */
  readonly menu: Menu
}

export type RowAction = 'pin' | 'unpin' | 'snooze' | 'wake' | 'rename' | 'retitle' | 'export-md' | 'export-json' | 'export-html' | 'link' | 'archive' | 'delete'
type Menu = readonly (readonly RowAction[])[]

export const ACTION_LABELS: { readonly [A in RowAction]: string } = {
  pin: 'Pin', unpin: 'Unpin', snooze: 'Snooze', wake: 'Wake', rename: 'Rename…', retitle: 'Rename with AI',
  'export-md': 'Export as Markdown', 'export-json': 'Export as JSON', 'export-html': 'Export as HTML', link: 'Copy link', archive: 'Archive', delete: 'Delete…'
}

type RowKind = 'chat' | 'pinned' | 'snoozed' | 'snoozed-pinned' | 'bot-chat'

const NAMING: readonly RowAction[] = ['rename', 'retitle']
const SAVES: readonly RowAction[] = ['export-md', 'export-json', 'export-html', 'link']
const LEAVING: readonly RowAction[] = ['archive', 'delete']

/** A bot's own chat is the one its row opens, and Hermes pins it itself, so the list offers no way to pin, snooze, archive or delete it. */
export const MENUS: { readonly [K in RowKind]: Menu } = {
  chat: [['pin', 'snooze'], NAMING, SAVES, LEAVING],
  pinned: [['unpin', 'snooze'], NAMING, SAVES, LEAVING],
  snoozed: [['pin', 'wake'], NAMING, SAVES, LEAVING],
  'snoozed-pinned': [['unpin', 'wake'], NAMING, SAVES, LEAVING],
  'bot-chat': [NAMING, SAVES]
}

const kindOf = (row: Pick<SidebarRow, 'botChat'>, pinned: boolean, snoozed: boolean): RowKind =>
  row.botChat ? 'bot-chat' : snoozed ? (pinned ? 'snoozed-pinned' : 'snoozed') : pinned ? 'pinned' : 'chat'

/** Pinned by the user. Hermes pins a bot's own chat too, which stays with the other sessions. */
export const pinnedByUser = (row: Pick<SidebarRow, 'botChat' | 'pinned'>): boolean => row.pinned && !row.botChat

/** A snoozed chat waits under Snoozed, pinned or not. */
export const groupOf = (pinned: boolean, snoozed: boolean): ChatGroup => (snoozed ? 'snoozed' : pinned ? 'pinned' : 'sessions')

/** What the list under the header shows. */
export type ChatsView =
  | { readonly show: 'loading' }
  | { readonly show: 'note'; readonly words: string }
  /** The chats the user pinned, every other awake one, then the snoozed ones. Each newest first. Never all empty. */
  | { readonly show: 'rows'; readonly pinned: readonly ChatRow[]; readonly sessions: readonly ChatRow[]; readonly snoozed: readonly ChatRow[] }

export interface ChatSection {
  readonly group: ChatGroup
  /** null: the list draws no headings, since every row is a session. */
  readonly heading: string | null
  readonly rows: readonly ChatRow[]
}

const GROUPS: readonly ChatGroup[] = ['pinned', 'sessions', 'snoozed']
const HEADINGS: { readonly [G in ChatGroup]: string } = { pinned: 'Pinned', sessions: 'Sessions', snoozed: 'Snoozed' }

/** Each group that holds a row, in order, headed only while Pinned or Snoozed holds one. */
export function sectionsOf(view: Extract<ChatsView, { show: 'rows' }>): readonly ChatSection[] {
  const headed = view.pinned.length > 0 || view.snoozed.length > 0
  return GROUPS.filter(group => view[group].length > 0).map(group => ({ group, heading: headed ? HEADINGS[group] : null, rows: view[group] }))
}

export const NO_CHATS = 'No chats yet.'
export const UNTITLED = 'Untitled chat'
export const DRAFT = 'Draft'

const LOADING: ChatsView = { show: 'loading' }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "now", "5m", "3h", "2d". A time a little ahead of this clock is now. */
export function agoOf(at: number, now: number): string {
  const since = now - at
  if (since < MINUTE) return 'now'
  if (since < HOUR) return `${Math.floor(since / MINUTE)}m`
  if (since < DAY) return `${Math.floor(since / HOUR)}h`
  return `${Math.floor(since / DAY)}d`
}

export const DOING: { readonly [B in SidebarRow['badge']]: string | null } = { none: null, running: 'Working', asking: 'Waiting for your OK' }

export const named = (title: string) => (title.trim() === '' ? UNTITLED : title)

/** The rows are drawn only while they are the open chat's bot's, so a switch never shows one bot's chats under another. */
export function listedRows(sidebar: Sidebar | undefined, open: OpenChat | undefined): readonly SidebarRow[] | null {
  if (sidebar === undefined || open === undefined || sidebar.status === 'loading' || sidebar.bot !== shownBot(open)) return null
  return sidebar.rows
}

/** A chat stays snoozed until its time, except one that waits for an OK. A bot's own chat is never snoozed. */
export function chatsOf(sidebar: Sidebar | undefined, open: OpenChat | undefined, now: number, drafts: ReadonlySet<SessionId>, snoozes: Snoozes): ChatsView {
  const rows = listedRows(sidebar, open)
  if (rows === null) return LOADING
  if (rows.length === 0) return { show: 'note', words: NO_CHATS }
  const shown = shownChat(open)?.sessionId ?? null
  const chatRow = (row: SidebarRow): ChatRow => {
    const held = snoozes[row.id]
    const until = held !== undefined && held > now && !row.botChat && row.badge !== 'asking' ? held : null
    const pinned = pinnedByUser(row)
    return {
      id: row.id, name: named(row.title), preview: row.preview, when: row.lastActiveAt === null ? '' : agoOf(row.lastActiveAt, now),
      doing: DOING[row.badge] ?? (until === null ? null : `Snoozed until ${untilWords(until, now)}`), badge: row.badge, current: row.id === shown,
      showsDraft: row.id !== shown && drafts.has(row.id), pinned, group: groupOf(pinned, until !== null), menu: MENUS[kindOf(row, pinned, until !== null)]
    }
  }
  const listed = rows.map(chatRow)
  return {
    show: 'rows',
    pinned: listed.filter(row => row.group === 'pinned'),
    sessions: listed.filter(row => row.group === 'sessions'),
    snoozed: listed.filter(row => row.group === 'snoozed')
  }
}

/** When the next snooze runs out, so the list wakes that chat on time. null: none is waiting. */
export function nextWakeOf(snoozes: Snoozes, now: number): number | null {
  const waiting = Object.values(snoozes).filter(until => until > now)
  return waiting.length === 0 ? null : Math.min(...waiting)
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
// Rounded, since a day that changes the clock is 23 or 25 hours long.
const dayNumber = (at: Date) => Math.round(new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() / DAY)
const clockOf = (at: Date) => `${at.getHours() % 12 || 12}:${String(at.getMinutes()).padStart(2, '0')} ${at.getHours() < 12 ? 'AM' : 'PM'}`

/**
 * A time ahead, in this machine's time zone: "6:00 PM" today, "Tomorrow 9:00 AM" (or "Fri 9:00 AM" by `weekday`),
 * a weekday for the rest of the week, and a date past it.
 */
export function untilWords(until: number, now: number, naming: 'day' | 'weekday' = 'day'): string {
  const [at, today] = [new Date(until), new Date(now)]
  const days = dayNumber(at) - dayNumber(today)
  if (days <= 0) return clockOf(at)
  if (days === 1 && naming === 'day') return `Tomorrow ${clockOf(at)}`
  if (days < 7) return `${WEEKDAYS[at.getDay()]} ${clockOf(at)}`
  return `${MONTHS[at.getMonth()]} ${at.getDate()} ${clockOf(at)}`
}

export type SnoozeId = 'hour' | 'hours' | 'evening' | 'tomorrow' | 'week'

/** `when` is the time it ends, shown beside the label. */
export interface SnoozeChoice { readonly id: SnoozeId; readonly label: string; readonly when: string; readonly until: number }

const EVENING = 18
const MORNING = 9

/** How long a chat can be snoozed from `now`, soonest first. A choice already past, or one ending the same minute as a sooner one, is left out. */
export function snoozeChoices(now: Date): readonly SnoozeChoice[] {
  const minute = Math.floor(now.getTime() / MINUTE) * MINUTE
  const dayAt = (days: number, hour: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour).getTime()
  const toMonday = (8 - now.getDay()) % 7 || 7
  const all: readonly Omit<SnoozeChoice, 'when'>[] = [
    { id: 'hour', label: 'In 1 hour', until: minute + HOUR },
    { id: 'hours', label: 'In 3 hours', until: minute + 3 * HOUR },
    { id: 'evening', label: 'This evening', until: dayAt(0, EVENING) },
    { id: 'tomorrow', label: 'Tomorrow', until: dayAt(1, MORNING) },
    { id: 'week', label: 'Next week', until: dayAt(toMonday, MORNING) }
  ]
  const ahead = all.filter(choice => choice.until > now.getTime()).sort((a, b) => a.until - b.until)
  return ahead
    .filter((choice, at) => choice.until !== ahead[at - 1]?.until)
    .map(choice => ({ ...choice, when: untilWords(choice.until, now.getTime(), 'weekday') }))
}

/** The name the roster shows for a bot. null: no bot, or one the roster does not list. */
export function botNameOf(bots: Bots | undefined, bot: BotId | null): string | null {
  if (bot === null || bots?.state !== 'listed') return null
  const { featured, sections } = bots.roster
  if (featured?.id === bot) return featured.name
  return sections.flatMap(section => section.bots).find(held => held.id === bot)?.name ?? null
}

/** The open chat in the top bar: its bot, then its title once it has one. null: nothing to name. */
export function openChatName(bot: string | null, title: string | null): string | null {
  const titled = title === null || title.trim() === '' ? null : title
  if (bot === null) return titled
  return titled === null ? bot : `${bot} · ${titled}`
}
