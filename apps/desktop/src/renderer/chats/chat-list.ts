import { shownBot, shownChat, type BotId, type Bots, type OpenChat, type SessionId, type Sidebar, type SidebarRow } from '@highwing/hermes/domain'

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
  readonly showsDraft: boolean
  /** What its More menu offers, in order. */
  readonly offers: readonly RowAction[]
}

export type RowAction = 'rename' | 'pin' | 'unpin' | 'export-md' | 'export-json' | 'export-html' | 'link' | 'archive' | 'remove'

export const ACTION_LABELS: { readonly [A in RowAction]: string } = {
  rename: 'Rename…', pin: 'Pin', unpin: 'Unpin', 'export-md': 'Export as Markdown', 'export-json': 'Export as JSON', 'export-html': 'Export as HTML', link: 'Copy link',
  archive: 'Archive', remove: 'Remove…'
}

const SAVES: readonly RowAction[] = ['export-md', 'export-json', 'export-html', 'link']
const BOT_CHAT: readonly RowAction[] = ['rename', ...SAVES]
const UNPINNED: readonly RowAction[] = ['rename', 'pin', ...SAVES, 'archive', 'remove']
const PINNED: readonly RowAction[] = ['rename', 'unpin', ...SAVES, 'archive', 'remove']

/** A bot's own chat is the one its row opens, and Hermes pins it itself, so the list offers no way to pin, archive or remove it. */
export const offersOf = (row: Pick<SidebarRow, 'botChat' | 'pinned'>): readonly RowAction[] => (row.botChat ? BOT_CHAT : row.pinned ? PINNED : UNPINNED)

/** Pinned by the user. Hermes pins a bot's own chat too, which stays with the other sessions. */
export const pinnedByUser = (row: Pick<SidebarRow, 'botChat' | 'pinned'>): boolean => row.pinned && !row.botChat

/** What the list under the header shows. */
export type ChatsView =
  | { readonly show: 'loading' }
  | { readonly show: 'note'; readonly words: string }
  /**
   * The chats the user pinned, then every other. Each newest first. Never both empty. The window
   * heads the groups only while `pinned` holds a row.
   */
  | { readonly show: 'rows'; readonly pinned: readonly ChatRow[]; readonly sessions: readonly ChatRow[] }

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

export function chatsOf(sidebar: Sidebar | undefined, open: OpenChat | undefined, now: number, drafts: ReadonlySet<SessionId>): ChatsView {
  const rows = listedRows(sidebar, open)
  if (rows === null) return LOADING
  if (rows.length === 0) return { show: 'note', words: NO_CHATS }
  const shown = shownChat(open)?.sessionId ?? null
  const chatRow = (row: SidebarRow): ChatRow => ({
    id: row.id, name: named(row.title), preview: row.preview, when: row.lastActiveAt === null ? '' : agoOf(row.lastActiveAt, now),
    doing: DOING[row.badge], badge: row.badge, current: row.id === shown, showsDraft: row.id !== shown && drafts.has(row.id), offers: offersOf(row)
  })
  return {
    show: 'rows',
    pinned: rows.filter(pinnedByUser).map(chatRow),
    sessions: rows.filter(row => !pinnedByUser(row)).map(chatRow)
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
