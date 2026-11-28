import { BOARD_PATH, parseTaskBoard, taskPath } from '../domain/tasks'
import type { HermesAsk, HttpAnswer } from '../wire/link'

export interface Kanban {
  readonly board: unknown
  readonly tasks: { readonly [id: string]: unknown }
}

export const isKanban = (value: unknown): value is Kanban => {
  const held = value as { readonly board?: unknown; readonly tasks?: unknown } | null
  return typeof held === 'object' && held !== null && parseTaskBoard(held.board) !== null && typeof held.tasks === 'object' && held.tasks !== null && !Array.isArray(held.tasks)
}

export const MISSING = { status: 404, body: { detail: 'Not Found' } } as const

/** The kanban routes a fixture answers. null: not one of them. */
export function kanbanCall(kanban: Kanban | undefined, { path }: HermesAsk): HttpAnswer | null {
  if (path === BOARD_PATH) return kanban === undefined ? MISSING : { status: 200, body: kanban.board }
  const id = kanban === undefined ? undefined : Object.keys(kanban.tasks).find(held => taskPath(held) === path)
  return id === undefined ? null : { status: 200, body: kanban?.tasks[id] }
}
