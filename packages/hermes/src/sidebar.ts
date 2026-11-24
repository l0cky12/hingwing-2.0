import type { BotId } from './domain/bots'
import { activityOf } from './domain/reduce'
import type { SessionContent, SessionId, Sidebar, SidebarRow } from './domain/session'
import { Offline, RpcRefusal, type Connection } from './wire/link'
import { parseListRows } from './wire/parse'

type ListRow = Omit<SidebarRow, 'badge'>

export interface SessionList {
  /** Whose chats the rows are. null: the socket's own profile. */
  readonly bot: BotId | null
  readonly status: Sidebar['status']
  readonly rows: readonly ListRow[]
  /**
   * The live rows whose turn is running now. The stored list cannot say, because its `running`
   * field is always false (gateway/session_listing.py:70).
   */
  readonly running: ReadonlySet<SessionId>
  refresh(): void
  /** List this bot's chats from now on. A list that answers for the bot it left is dropped. */
  follow(bot: BotId | null): void
  retitle(id: SessionId, title: string): void
  drop(id: SessionId): void
  stale(): void
}

const STORED_ROWS = 100

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

/** `owned` hears which bot each listed chat lives in before `changed` runs, so an actor made on `changed` reaches the right profile. */
export function sessionList(conn: Connection, owned: (bot: BotId, sessions: readonly SessionId[]) => void, changed: () => void): SessionList {
  let bot: BotId | null = null
  let status: Sidebar['status'] = 'loading'
  let rows: readonly ListRow[] = []
  let running: ReadonlySet<SessionId> = new Set()
  let fetching = false
  let again = false

  const fetch = async () => {
    fetching = true
    const asked = bot
    const via = asked === null ? conn : conn.as(asked)
    try {
      const [live, hidden, stored] = await Promise.all([via.call('session.list', LIVE), via.call('session.list', LIVE_HIDDEN), via.call('session.list', STORED)])
      if (asked === bot) {
        rows = merged(parseListRows(live.sessions), parseListRows(stored.sessions))
        const listed = new Set(rows.map(row => row.id))
        running = new Set(hidden.sessions.filter(row => row.running).map(row => row.session_id as SessionId).filter(id => listed.has(id)))
        status = 'ready'
        if (asked !== null) owned(asked, rows.map(row => row.id))
        changed()
      }
    } catch (error) {
      if (!(error instanceof Offline) && !(error instanceof RpcRefusal)) throw error
    } finally {
      fetching = false
    }
    if (again) {
      again = false
      void fetch()
    }
  }

  const refresh = () => {
    if (fetching) again = true
    else void fetch()
  }

  return {
    get bot() { return bot },
    get status() { return status },
    get rows() { return rows },
    get running() { return running },
    refresh,
    follow: next => {
      if (next === bot) return
      bot = next
      rows = []
      running = new Set()
      status = 'loading'
      changed()
      refresh()
    },
    retitle: (id, title) => {
      if (!rows.some(row => row.id === id && row.title !== title)) return
      rows = rows.map(row => (row.id === id ? { ...row, title } : row))
      changed()
    },
    drop: id => {
      if (!rows.some(row => row.id === id)) return
      rows = rows.filter(row => row.id !== id)
      changed()
    },
    stale: () => {
      if (status !== 'ready') return
      status = 'stale'
      changed()
    }
  }
}

const BADGES = {
  idle: 'none', thinking: 'running', preparing: 'running', writing: 'running', working: 'running', reasoning: 'running', helping: 'running',
  stopping: 'running', asking: 'asking'
} as const satisfies Record<ReturnType<typeof activityOf>['kind'], SidebarRow['badge']>

export function deriveSidebar(list: Pick<SessionList, 'bot' | 'status' | 'rows' | 'running'>, attached: ReadonlyMap<SessionId, SessionContent>): Sidebar {
  return {
    bot: list.bot,
    status: list.status,
    rows: list.rows.map(row => {
      const session = attached.get(row.id)
      if (session === undefined) return { ...row, badge: list.running.has(row.id) ? 'running' : 'none' }
      return { ...row, title: session.title || row.title, badge: BADGES[activityOf(session).kind] }
    })
  }
}
