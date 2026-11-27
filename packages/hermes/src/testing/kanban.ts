import { BOARD_PATH, parseTaskBoard, taskPath } from '../domain/tasks'
import type { ReadHermes } from '../wire/link'

/** Hermes's kanban replies as it sends them, so the app's own readers run on them: the board, and each card's detail by task id. */
export interface Kanban {
  readonly board: unknown
  readonly tasks: { readonly [id: string]: unknown }
}

export const isKanban = (value: unknown): value is Kanban => {
  const held = value as { readonly board?: unknown; readonly tasks?: unknown } | null
  return typeof held === 'object' && held !== null && parseTaskBoard(held.board) !== null && typeof held.tasks === 'object' && held.tasks !== null && !Array.isArray(held.tasks)
}

const MISSING = { status: 404, body: { detail: 'Not Found' } } as const

/** A fixture run reads the header's `kanban` and never the network. With none, every path is missing, as on a Hermes without the kanban plugin. */
export function fixtureRead(kanban: Kanban | undefined): ReadHermes {
  return async path => {
    if (kanban === undefined) return MISSING
    if (path === BOARD_PATH) return { status: 200, body: kanban.board }
    const id = Object.keys(kanban.tasks).find(held => taskPath(held) === path)
    return id === undefined ? MISSING : { status: 200, body: kanban.tasks[id] }
  }
}
