/**
 * The kanban board of the Hermes home, as the Tasks view draws it. Plain JSON data, because it crosses
 * Electron IPC. Hermes serves it over its HTTP API, not the socket, and these readers are the one place its
 * JSON is trusted (hermes-agent plugins/kanban/dashboard/plugin_api.py).
 */
import { canonicalBotId, type BotId } from './bots'
import type { SessionId } from './session'

/** One card. `assignee` is the profile Hermes assigned it to, and `summary` the preview of its latest run's summary. */
export interface TaskCard {
  readonly id: string
  readonly title: string
  readonly assignee: string | null
  readonly summary: string | null
}
/** In the order Hermes sends them: triage, todo, scheduled, ready, running, blocked, review, done. */
export interface TaskColumn { readonly name: string; readonly cards: readonly TaskCard[] }
export interface TaskBoard { readonly columns: readonly TaskColumn[] }
/** The chat working on a card: the session its newest `owner_admitted` event names, in the bot whose profile that run used. */
export interface TaskChat { readonly bot: BotId; readonly sessionId: SessionId }

export const BOARD_PATH = '/api/plugins/kanban/board'
export const taskPath = (id: string): string => `/api/plugins/kanban/tasks/${encodeURIComponent(id)}`

type Obj = Readonly<Record<string, unknown>>
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)
const filled = (value: unknown): value is string => typeof value === 'string' && value !== ''
const orNull = (value: unknown): string | null => (filled(value) ? value : null)

/** What Hermes calls a task: `t_` and a few hex digits. The window names one, so main checks it before it goes into a path. */
export const isTaskId = (raw: unknown): raw is string => typeof raw === 'string' && /^[\w-]{1,64}$/.test(raw)

function cardOf(raw: unknown): TaskCard | null {
  if (!isObject(raw) || !isTaskId(raw.id) || typeof raw.title !== 'string') return null
  return { id: raw.id, title: raw.title, assignee: orNull(raw.assignee), summary: orNull(raw.latest_summary) }
}

/** null: the reply is not Hermes's board. */
export function parseTaskBoard(raw: unknown): TaskBoard | null {
  if (!isObject(raw) || !Array.isArray(raw.columns)) return null
  const columns: TaskColumn[] = []
  for (const column of raw.columns) {
    if (!isObject(column) || !filled(column.name) || !Array.isArray(column.tasks)) return null
    const cards = column.tasks.map(cardOf)
    if (cards.includes(null)) return null
    columns.push({ name: column.name, cards: cards as TaskCard[] })
  }
  return { columns }
}

/**
 * The chat of a card from its detail reply. null: it has none Highwing can open, because it never ran or its
 * run names no profile. `'invalid'`: the reply is not Hermes's.
 */
export function parseTaskChat(raw: unknown): TaskChat | null | 'invalid' {
  if (!isObject(raw) || !Array.isArray(raw.events) || !Array.isArray(raw.runs)) return 'invalid'
  const admitted = raw.events.filter((event): event is Obj => isObject(event) && event.kind === 'owner_admitted')
  const newest = admitted.reduce<Obj | null>((held, event) => (held === null || Number(event.id) >= Number(held.id) ? event : held), null)
  const sessionId = isObject(newest?.payload) ? newest.payload.session_id : null
  const run = raw.runs.find((held): held is Obj => isObject(held) && held.id === newest?.run_id)
  return filled(sessionId) && filled(run?.profile) ? { bot: canonicalBotId(run.profile), sessionId: sessionId as SessionId } : null
}
