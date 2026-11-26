import type { BotId } from './domain/bots'
import { activityOf } from './domain/reduce'
import { STORED_ROWS, type SessionContent, type SessionId, type Sidebar, type SidebarRow } from './domain/session'
import { Offline, RpcRefusal, type Connection } from './wire/link'
import { parseUserChats } from './wire/parse'

type ListRow = Omit<SidebarRow, 'badge' | 'botChat'>

export interface SessionList {
  /** Whose chats the rows are. null: the socket's own profile. */
  readonly bot: BotId | null
  readonly status: Sidebar['status']
  readonly rows: readonly ListRow[]
  readonly complete: Sidebar['complete']
  /**
   * The live rows whose turn is running now. The stored list cannot say, because its `running`
   * field is always false (gateway/session_listing.py:70).
   */
  readonly running: ReadonlySet<SessionId>
  refresh(): void
  /**
   * List this bot's chats from now on. A bot listed before on this connection shows its last rows at
   * once, `stale` and with no `running`, until its refresh answers. An answer for a bot it left is kept for that bot.
   */
  follow(bot: BotId | null): void
  /** List each of these bots not listed yet, one at a time and only while no other list is asked for, so a first visit shows kept rows too. */
  warm(bots: readonly BotId[]): void
  retitle(id: SessionId, title: string): void
  pin(id: SessionId, pinned: boolean): void
  drop(id: SessionId): void
  stale(): void
}

function merged(live: readonly ListRow[], stored: readonly ListRow[]): readonly ListRow[] {
  const liveIds = new Set(live.map(row => row.id))
  return [...live, ...stored.filter(row => !liveIds.has(row.id))].sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0))
}

/**
 * `include_hidden`, because Hermes hides a bot's Bot Chat from its list. `picker`, because only a
 * picker row carries `preview` and `last_active_at` (gateway/session_picker_fields.py:24-43).
 */
const STORED = { scope: 'stored', limit: STORED_ROWS, include_hidden: true, picker: true } as const
const LIVE = { scope: 'live', picker: true } as const
/**
 * Says which hidden chats run, such as a Bot Chat waiting on an approval. Only for `running`: a live
 * list that includes hidden chats also includes archived ones (gateway/session_controls.py:647-649).
 */
const LIVE_HIDDEN = { scope: 'live', include_hidden: true } as const

/** A bot's chats as Hermes last listed them on this connection. */
interface Listing { readonly rows: readonly ListRow[]; readonly complete: boolean }

const NONE: ReadonlySet<SessionId> = new Set()
/**
 * The most bots `warm` lists ahead. Each is three `session.list` calls of 45 to 72 ms on a real host, one bot at a time,
 * so this many is about a second of background reads once per connection. A larger roster lists the rest on their first visit.
 */
const WARM_LIMIT = 16

/** `owned` hears which bot each listed chat lives in before `changed` runs, so an actor made on `changed` reaches the right profile. */
export function sessionList(conn: Connection, owned: (bot: BotId, sessions: readonly SessionId[]) => void, changed: () => void): SessionList {
  let bot: BotId | null = null
  let status: Sidebar['status'] = 'loading'
  const lists = new Map<BotId | null, Listing>()
  let running = NONE
  /** bot -> whether it is to be listed again once the fetch in flight for it answers. */
  const fetching = new Map<BotId | null, boolean>()
  let warming: readonly BotId[] = []

  const fetch = async (asked: BotId | null) => {
    fetching.set(asked, false)
    const via = asked === null ? conn : conn.as(asked)
    try {
      const [live, hidden, stored] = await Promise.all([via.call('session.list', LIVE), via.call('session.list', LIVE_HIDDEN), via.call('session.list', STORED)])
      const rows = merged(parseUserChats(live.sessions), parseUserChats(stored.sessions))
      lists.set(asked, { rows, complete: stored.sessions.length < STORED_ROWS })
      if (asked !== null) owned(asked, rows.map(row => row.id))
      if (asked === bot) {
        const listed = new Set(rows.map(row => row.id))
        running = new Set(hidden.sessions.filter(row => row.running).map(row => row.session_id as SessionId).filter(id => listed.has(id)))
        status = 'ready'
        changed()
      }
    } catch (error) {
      if (!(error instanceof Offline) && !(error instanceof RpcRefusal)) throw error
    } finally {
      const again = fetching.get(asked) === true
      fetching.delete(asked)
      if (again) void fetch(asked)
      warmNext()
    }
  }

  const warmNext = () => {
    if (fetching.size > 0) return
    const [next, ...rest] = warming.filter(each => !lists.has(each))
    warming = rest
    if (next !== undefined) void fetch(next)
  }

  const refresh = () => {
    if (fetching.has(bot)) fetching.set(bot, true)
    else void fetch(bot)
  }

  const edit = (change: (rows: readonly ListRow[]) => readonly ListRow[]) => {
    let shown = false
    for (const [of, listing] of lists) {
      const rows = change(listing.rows)
      if (rows === listing.rows) continue
      lists.set(of, { ...listing, rows })
      shown ||= of === bot
    }
    if (shown) changed()
  }

  return {
    get bot() { return bot },
    get status() { return status },
    get rows() { return lists.get(bot)?.rows ?? [] },
    get complete() { return lists.get(bot)?.complete ?? false },
    get running() { return running },
    refresh,
    follow: next => {
      if (next === bot) return
      bot = next
      running = NONE
      status = lists.has(next) ? 'stale' : 'loading'
      changed()
      refresh()
    },
    warm: bots => {
      warming = bots.filter(each => !lists.has(each)).slice(0, WARM_LIMIT)
      warmNext()
    },
    retitle: (id, title) => edit(rows => (rows.some(row => row.id === id && row.title !== title) ? rows.map(row => (row.id === id ? { ...row, title } : row)) : rows)),
    pin: (id, pinned) => edit(rows => (rows.some(row => row.id === id && row.pinned !== pinned) ? rows.map(row => (row.id === id ? { ...row, pinned } : row)) : rows)),
    drop: id => edit(rows => (rows.some(row => row.id === id) ? rows.filter(row => row.id !== id) : rows)),
    stale: () => {
      if (status !== 'ready') return
      status = 'stale'
      changed()
    }
  }
}

const BADGES = {
  idle: 'none', thinking: 'running', preparing: 'running', writing: 'running', working: 'running', reasoning: 'running', helping: 'running',
  stopping: 'running', asking: 'asking', answering: 'asking'
} as const satisfies Record<ReturnType<typeof activityOf>['kind'], SidebarRow['badge']>

/** `isBotChat`: whether a chat is some bot's own, as the chat desk knows it. A socket bound to one profile lists that bot's own chat with no bot followed. */
export function deriveSidebar(
  list: Pick<SessionList, 'bot' | 'status' | 'rows' | 'complete' | 'running'>,
  attached: ReadonlyMap<SessionId, SessionContent>,
  isBotChat: (id: SessionId) => boolean = () => false
): Sidebar {
  return {
    bot: list.bot,
    status: list.status,
    complete: list.complete,
    rows: list.rows.map(listed => {
      const row = { ...listed, botChat: isBotChat(listed.id) }
      const session = attached.get(row.id)
      if (session === undefined) return { ...row, badge: list.running.has(row.id) ? 'running' : 'none' }
      return { ...row, title: session.title || row.title, badge: BADGES[activityOf(session).kind] }
    })
  }
}
