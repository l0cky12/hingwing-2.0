/**
 * The session list. Private to `@highwing/hermes`; the hub publishes its result as `Hermes.sidebar`.
 * The rows come from the gateway. What an attached session knows better (its title, whether it is
 * asking) is merged in when the sidebar is published and is never written back into the rows.
 */
import type { SessionContent, SessionId, Sidebar, SidebarRow } from './domain/session'
import type { Connection } from './wire/link'

type ListRow = Omit<SidebarRow, 'badge'>

export interface SessionList {
  readonly status: Sidebar['status']
  /** From `session.list {scope: 'stored', limit: 100}`. */
  readonly rows: readonly ListRow[]
  /**
   * From `session.list {scope: 'live'}`: the sessions whose turn is running now. The stored list
   * cannot say, because its `running` field is always false (gateway/session_listing.py:70).
   * The hub keeps every one of these attached.
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

export function sessionList(conn: Connection, changed: () => void): SessionList {
  throw new Error('not implemented')
}

/**
 * Pure. Order is the gateway's (most recently active first). For a session in `attached`:
 * title from the session, badge 'asking' or 'running' from `activityOf`. Otherwise 'running' when
 * `list.running` has it, else 'none'.
 */
export function deriveSidebar(list: Pick<SessionList, 'status' | 'rows' | 'running'>, attached: ReadonlyMap<SessionId, SessionContent>): Sidebar {
  throw new Error('not implemented')
}
