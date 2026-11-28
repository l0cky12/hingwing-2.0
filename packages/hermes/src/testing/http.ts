import { BOARD_PATH, parseTaskBoard, taskPath } from '../domain/tasks'
import { TOOLSETS_PATH, toolsetPath } from '../domain/toolsets'
import type { AskHermes, HttpAnswer, HttpAsk } from '../wire/link'
import type { CronScript } from './fixture'

export interface Kanban {
  readonly board: unknown
  readonly tasks: { readonly [id: string]: unknown }
}

/** One row of `GET /api/tools/toolsets` as Hermes sends it (hermes_cli/web_routers/tools.py:224-271). */
export interface ToolsetRow {
  readonly name: string
  readonly enabled: boolean
  readonly [field: string]: unknown
}

export const isKanban = (value: unknown): value is Kanban => {
  const held = value as { readonly board?: unknown; readonly tasks?: unknown } | null
  return typeof held === 'object' && held !== null && parseTaskBoard(held.board) !== null && typeof held.tasks === 'object' && held.tasks !== null && !Array.isArray(held.tasks)
}

export const isToolsetRows = (value: unknown): value is readonly ToolsetRow[] =>
  Array.isArray(value) && value.every(row => typeof row === 'object' && row !== null && !Array.isArray(row) && typeof row.name === 'string' && row.name !== '' && typeof row.enabled === 'boolean')

/** An `ask` for a Hermes whose HTTP API nothing opens: every request gets no answer. */
export const noAsk: AskHermes = async () => {
  throw new Error('This test gave the Hermes no HTTP route.')
}

const MISSING: HttpAnswer = { status: 404, body: { detail: 'Not Found' } }

const RUNS_PATH = /^\/api\/cron\/jobs\/([^/?]+)\/runs(?:\?|$)/

function runsJobOf(path: string): string | null {
  const named = RUNS_PATH.exec(path)?.[1]
  try {
    return named === undefined ? null : decodeURIComponent(named)
  } catch {
    return null
  }
}

/**
 * The fixture's HTTP API: the kanban board and cards, each routine's runs, and the toolsets each bot has. A header key that is absent is a route this Hermes
 * lacks, and answers 404. Toolsets are kept per bot, each copied from the header on first touch as a profile's own config is, so a switch
 * on one bot leaves another's alone. `onAsked` hears every request as the frame a gateway call would make, with the bot as `profile`.
 */
export function fixtureAsk(
  { kanban, toolsets, cron }: { readonly kanban?: Kanban | undefined; readonly toolsets?: readonly ToolsetRow[] | undefined; readonly cron?: CronScript | undefined },
  onAsked: (frame: unknown) => void = () => {}
): AskHermes {
  const held = new Map<string | null, ToolsetRow[]>()
  const rowsOf = (bot: string | null) => {
    if (!held.has(bot)) held.set(bot, (toolsets ?? []).map(row => ({ ...row })))
    return held.get(bot) as ToolsetRow[]
  }

  const answer = (ask: HttpAsk): HttpAnswer => {
    if (ask.method === 'GET' && ask.path === TOOLSETS_PATH) return toolsets === undefined ? MISSING : { status: 200, body: rowsOf(ask.bot) }
    if (ask.path.startsWith(`${TOOLSETS_PATH}/`)) {
      if (toolsets === undefined || ask.method !== 'PUT') return MISSING
      const row = rowsOf(ask.bot).find(held => toolsetPath(held.name) === ask.path)
      if (row === undefined) return { status: 400, body: { detail: `Unknown toolset: ${decodeURIComponent(ask.path.slice(TOOLSETS_PATH.length + 1))}` } }
      const enabled = typeof ask.json === 'object' && ask.json !== null && 'enabled' in ask.json && ask.json.enabled === true
      Object.assign(row, { enabled })
      return { status: 200, body: { ok: true, name: row.name, platform: row.platform ?? 'cli', enabled, post_setup_started: null } }
    }
    if (ask.method !== 'GET') return MISSING
    if (kanban !== undefined) {
      if (ask.path === BOARD_PATH) return { status: 200, body: kanban.board }
      const task = Object.keys(kanban.tasks).find(held => taskPath(held) === ask.path)
      if (task !== undefined) return { status: 200, body: kanban.tasks[task] }
    }
    const job = runsJobOf(ask.path)
    const history = cron?.history
    return job !== null && history !== undefined && Object.hasOwn(history, job) ? { status: 200, body: history[job] } : MISSING
  }

  return async ask => {
    onAsked({ jsonrpc: '2.0', method: `${ask.method} ${ask.path}`, params: { profile: ask.bot, ...(ask.method === 'PUT' && typeof ask.json === 'object' && ask.json !== null ? ask.json : {}) } })
    return answer(ask)
  }
}
