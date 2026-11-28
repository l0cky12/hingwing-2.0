import { BOARD_PATH, parseTaskBoard, taskPath } from '../domain/tasks'
import type { ReadHermes, WriteHermes } from '../wire/link'
import type { CronScript } from './fixture'

export interface Kanban {
  readonly board: unknown
  readonly tasks: { readonly [id: string]: unknown }
}

export const isKanban = (value: unknown): value is Kanban => {
  const held = value as { readonly board?: unknown; readonly tasks?: unknown } | null
  return typeof held === 'object' && held !== null && parseTaskBoard(held.board) !== null && typeof held.tasks === 'object' && held.tasks !== null && !Array.isArray(held.tasks)
}

const MISSING = { status: 404, body: { detail: 'Not Found' } } as const

const RUNS_PATH = /^\/api\/cron\/jobs\/([^/?]+)\/runs(?:\?|$)/

/** The job a `/api/cron/jobs/<id>/runs` path names, or null for any other path. */
function runsJobOf(path: string): string | null {
  const named = RUNS_PATH.exec(path)?.[1]
  try {
    return named === undefined ? null : decodeURIComponent(named)
  } catch {
    return null
  }
}

/** The REST routes of the fixture's Hermes. What the header gives answers, and every other path is a 404, as it is on a Hermes without that route. */
export function fixtureRead({ kanban, cron }: { readonly kanban?: Kanban | undefined; readonly cron?: CronScript | undefined }): ReadHermes {
  return async path => {
    if (kanban !== undefined) {
      if (path === BOARD_PATH) return { status: 200, body: kanban.board }
      const task = Object.keys(kanban.tasks).find(held => taskPath(held) === path)
      if (task !== undefined) return { status: 200, body: kanban.tasks[task] }
    }
    const job = runsJobOf(path)
    const history = cron?.history
    return job !== null && history !== undefined && Object.hasOwn(history, job) ? { status: 200, body: history[job] } : MISSING
  }
}

/** The fixture's Hermes takes no write yet: every path is a 404, as it is on a Hermes without that route. */
export function fixtureWrite(): WriteHermes {
  return async () => MISSING
}
