import { guarded, type Reasons, type Wire } from './bot-admin'
import type { BotId } from './domain/bots'
import type { Outcome } from './domain/command'
import type { Routine } from './domain/routines'
import { METHOD_NOT_FOUND } from './wire/link'
import { parseRoutines } from './wire/parse'

const ROUTINE_REASONS: Reasons = {
  [METHOD_NOT_FOUND]: () => ({ kind: 'unsupported', message: "This Hermes can't show routines to Highwing." })
}

/** Paused jobs are left out of a list unless asked for (tui_gateway/methods_tools.py:1317-1319). */
export const listRoutines = (conn: Wire, bot: BotId): Promise<Outcome<readonly Routine[]>> =>
  guarded(ROUTINE_REASONS, async () => parseRoutines(await conn.as(bot).call('cron.manage', { action: 'list', include_disabled: true }), bot))
