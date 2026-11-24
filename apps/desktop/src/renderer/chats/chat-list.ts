import type { BotId, Bots, OpenChat, SessionId, Sidebar, SidebarRow } from '@highwing/hermes/domain'

export interface ChatRow {
  readonly id: SessionId
  /** The row's accessible name. Never blank. */
  readonly name: string
  readonly preview: string | null
  /** When it was last used, as `agoOf` says it. Empty when Hermes did not say. */
  readonly when: string
  /** What the chat is doing. null: nothing, so the row shows its preview instead. */
  readonly doing: string | null
  readonly badge: SidebarRow['badge']
  readonly current: boolean
}

/** What the list under the header shows. */
export type ChatsView =
  | { readonly show: 'loading' }
  | { readonly show: 'note'; readonly words: string }
  /** Never empty. */
  | { readonly show: 'rows'; readonly rows: readonly ChatRow[] }

export const NO_CHATS = 'No chats yet.'
export const UNTITLED = 'Untitled chat'
export const CHATS = 'Chats'

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

const DOING: { readonly [B in SidebarRow['badge']]: string | null } = { none: null, running: 'Working', asking: 'Waiting for your OK' }

const named = (title: string) => (title.trim() === '' ? UNTITLED : title)

/**
 * `sidebar` and `open` undefined: Electron main has not pushed them yet. The rows are drawn only
 * while they are the open chat's bot's, so a switch never shows one bot's chats under another.
 */
export function chatsOf(sidebar: Sidebar | undefined, open: OpenChat | undefined, now: number): ChatsView {
  if (sidebar === undefined || open === undefined || sidebar.status === 'loading' || sidebar.bot !== (open.shown?.bot ?? null)) return LOADING
  if (sidebar.rows.length === 0) return { show: 'note', words: NO_CHATS }
  const shown = open.shown?.sessionId ?? null
  return {
    show: 'rows',
    rows: sidebar.rows.map(row => ({
      id: row.id, name: named(row.title), preview: row.preview, when: row.lastActiveAt === null ? '' : agoOf(row.lastActiveAt, now),
      doing: DOING[row.badge], badge: row.badge, current: row.id === shown
    }))
  }
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
