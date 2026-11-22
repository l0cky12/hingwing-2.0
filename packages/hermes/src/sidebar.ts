/**
 * The session list. Private to `@highwing/hermes`; the hub publishes its result as `Hermes.sidebar`.
 * The rows come from the gateway. What an attached session knows better (its title, whether it is
 * asking) is merged in when the sidebar is published and is never written back into the rows.
 */
import { activityOf } from './domain/reduce'
import type { SessionContent, SessionId, Sidebar, SidebarRow } from './domain/session'
import { Offline, RpcRefusal, type Connection } from './wire/link'
import { parseListRows } from './wire/parse'

type ListRow = Omit<SidebarRow, 'badge'>

export interface SessionList {
  readonly status: Sidebar['status']
  /**
   * Both of the gateway's lists, most recently active first. `session.list {scope: 'live'}` holds
   * every session the gateway has mounted and `{scope: 'stored', limit: 100}` the ones it has not:
   * closed chats and rows from older versions (Hermes's gateway/session_controls.py:641-656,
   * gateway/session_listing.py:103-170). A session is in one or the other.
   */
  readonly rows: readonly ListRow[]
  /**
   * The live rows whose turn is running now. The stored list cannot say, because its `running`
   * field is always false (gateway/session_listing.py:70). The hub keeps every one of these attached.
   */
  readonly running: ReadonlySet<SessionId>
  /**
   * Fetch both lists and replace `rows` and `running` together. Calls made while one is in flight
   * collapse into one follow-up fetch. Called on every `onOnline` and, debounced 300 ms, on
   * `sessions.changed` and after each turn of an attached session starts or ends.
   */
  refresh(): void
  /** `session.title` for any session, attached or not. */
  retitle(id: SessionId, title: string): void
  /** Hide a row at once after a successful archive. The next refresh confirms it. */
  drop(id: SessionId): void
  /** Socket lost: keep the rows, mark them stale. */
  stale(): void
}

const STORED_ROWS = 100

function merged(live: readonly ListRow[], stored: readonly ListRow[]): readonly ListRow[] {
  const liveIds = new Set(live.map(row => row.id))
  return [...live, ...stored.filter(row => !liveIds.has(row.id))].sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0))
}

export function sessionList(conn: Connection, changed: () => void): SessionList {
  let status: Sidebar['status'] = 'loading'
  let rows: readonly ListRow[] = []
  let running: ReadonlySet<SessionId> = new Set()
  let fetching = false
  let again = false

  const fetch = async () => {
    fetching = true
    try {
      const [live, stored] = await Promise.all([
        conn.call('session.list', { scope: 'live' }),
        conn.call('session.list', { scope: 'stored', limit: STORED_ROWS })
      ])
      rows = merged(parseListRows(live.sessions), parseListRows(stored.sessions))
      running = new Set(live.sessions.filter(row => row.running).map(row => row.session_id as SessionId))
      status = 'ready'
      changed()
    } catch (error) {
      // The next `onOnline` refreshes again. A refusal leaves the rows as they are.
      if (!(error instanceof Offline) && !(error instanceof RpcRefusal)) throw error
    } finally {
      fetching = false
    }
    if (again) {
      again = false
      void fetch()
    }
  }

  return {
    get status() { return status },
    get rows() { return rows },
    get running() { return running },
    refresh: () => {
      if (fetching) again = true
      else void fetch()
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
  idle: 'none', thinking: 'running', preparing: 'running', writing: 'running', working: 'running', stopping: 'running', asking: 'asking'
} as const satisfies Record<ReturnType<typeof activityOf>['kind'], SidebarRow['badge']>

/**
 * Pure. Order is the list's. For a session in `attached`, the sessions whose first attach has
 * settled: title from the session, badge from `activityOf`. Otherwise 'running' when
 * `list.running` has it, else 'none'.
 */
export function deriveSidebar(list: Pick<SessionList, 'status' | 'rows' | 'running'>, attached: ReadonlyMap<SessionId, SessionContent>): Sidebar {
  return {
    status: list.status,
    rows: list.rows.map(row => {
      const session = attached.get(row.id)
      if (session === undefined) return { ...row, badge: list.running.has(row.id) ? 'running' : 'none' }
      return { ...row, title: session.title || row.title, badge: BADGES[activityOf(session).kind] }
    })
  }
}
