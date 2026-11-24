import { activityOf } from './domain/reduce'
import type { SessionContent, SessionId, Sidebar, SidebarRow } from './domain/session'
import { Offline, RpcRefusal, type Connection } from './wire/link'
import { parseListRows } from './wire/parse'

type ListRow = Omit<SidebarRow, 'badge'>

export interface SessionList {
  readonly status: Sidebar['status']
  readonly rows: readonly ListRow[]
  /**
   * The live rows whose turn is running now. The stored list cannot say, because its `running`
   * field is always false (gateway/session_listing.py:70).
   */
  readonly running: ReadonlySet<SessionId>
  refresh(): void
  retitle(id: SessionId, title: string): void
  drop(id: SessionId): void
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
  idle: 'none', thinking: 'running', preparing: 'running', writing: 'running', working: 'running', reasoning: 'running', helping: 'running',
  stopping: 'running', asking: 'asking'
} as const satisfies Record<ReturnType<typeof activityOf>['kind'], SidebarRow['badge']>

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
