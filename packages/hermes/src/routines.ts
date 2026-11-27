import { guarded, type Reasons, type Wire } from './bot-admin'
import type { BotId } from './domain/bots'
import type { Outcome } from './domain/command'
import type { Routine, RoutineAction, RoutineId } from './domain/routines'
import { METHOD_NOT_FOUND } from './wire/link'
import { parseControlled, parseRoutines } from './wire/parse'

const ROUTINE_REASONS: Reasons = {
  [METHOD_NOT_FOUND]: () => ({ kind: 'unsupported', message: "This Hermes can't show routines to Highwing." })
}

/** Paused jobs are left out of a list unless asked for (tui_gateway/methods_tools.py:1317-1319). */
export const listRoutines = (conn: Wire, bot: BotId): Promise<Outcome<readonly Routine[]>> =>
  guarded(ROUTINE_REASONS, async () => parseRoutines(await conn.as(bot).call('cron.manage', { action: 'list', include_disabled: true }), bot))

const WIRE_ACTIONS = { pause: 'pause', resume: 'resume', delete: 'remove' } as const

/** `name` carries the job's id, which Hermes looks up before any name (cron/jobs.py:1936). */
export const controlRoutine = (conn: Wire, bot: BotId, routine: RoutineId, action: RoutineAction): Promise<Outcome<Routine | null>> =>
  guarded(ROUTINE_REASONS, async () => parseControlled(await conn.as(bot).call('cron.manage', { action: WIRE_ACTIONS[action], name: routine }), action))
