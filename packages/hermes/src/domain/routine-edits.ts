/**
 * What a person can do to a routine through Hermes's cron REST routes (hermes_cli/web_routers/cron.py): run it now, or
 * give it another schedule. Hermes does both, and Highwing only asks. Plain JSON data only, like `session.ts`, because
 * these values cross Electron IPC.
 */
import type { BotId } from './bots'
import type { RoutineId } from './routines'

/** `run`: `POST .../trigger`, which runs the whole job inside the request. `reschedule`: `PUT` of the schedule alone, which keeps the job's id, skills, model, delivery and history. */
export type RoutineEdit = { readonly do: 'run' } | { readonly do: 'reschedule'; readonly schedule: string }

/** Hermes answers a trigger only once the job has run, and its own desktop app waits up to a day for it (apps/desktop/src/api/cron.ts:20-24). */
export const RUN_NOW_MS = 24 * 60 * 60 * 1000
export const EDIT_MS = 30_000
/** What the schedule field takes. Hermes's own forms are far shorter, and the cap only keeps a paste from crossing IPC. */
export const SCHEDULE_MAX = 200

const jobAt = (routine: RoutineId) => `/api/cron/jobs/${encodeURIComponent(routine)}`
const scope = (bot: BotId) => `?profile=${encodeURIComponent(bot)}`

export const jobPath = (routine: RoutineId, bot: BotId): string => `${jobAt(routine)}${scope(bot)}`
export const triggerPath = (routine: RoutineId, bot: BotId): string => `${jobAt(routine)}/trigger${scope(bot)}`

/**
 * The body of the one PUT Highwing sends. Hermes merges `updates` over the stored job, so a body with the schedule alone
 * leaves every other field of the job as it is. Hermes reads the text itself, and nothing here knows a schedule's forms.
 */
export const rescheduleBody = (schedule: string): { readonly updates: { readonly schedule: string } } => ({ updates: { schedule } })

/** The request that carries `edit`. Shaped as the transport's `HermesRequest`, which the domain doesn't import. */
export function requestOf(edit: RoutineEdit, routine: RoutineId, bot: BotId): { readonly method: 'POST' | 'PUT'; readonly path: string; readonly json?: unknown; readonly ms: number } {
  return edit.do === 'run'
    ? { method: 'POST', path: triggerPath(routine, bot), ms: RUN_NOW_MS }
    : { method: 'PUT', path: jobPath(routine, bot), json: rescheduleBody(edit.schedule), ms: EDIT_MS }
}
