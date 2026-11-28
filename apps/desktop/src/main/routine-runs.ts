import type { ReadHermes } from '@highwing/hermes'
import { parseRoutineRuns, runsPath, type BotId, type CommandOutcome, type Refusal, type RoutineId, type RoutineRun } from '@highwing/hermes/domain'

const refused = (kind: Refusal['kind'], message: string) => ({ ok: false, refusal: { kind, message } }) as const
const NO_RUNS = refused('unsupported', "This Hermes can't show a routine's past runs to Highwing.")
const UNREACHABLE = refused('offline', "Highwing couldn't reach Hermes for this routine's runs.")
const UNREADABLE = refused('unsupported', "Hermes answered with runs Highwing can't read.")

export async function readRoutineRuns(read: ReadHermes, bot: BotId, routine: RoutineId): Promise<CommandOutcome<readonly RoutineRun[]>> {
  const answer = await read(runsPath(routine, bot)).catch(() => null)
  if (answer?.status === 404) return NO_RUNS
  if (answer?.status !== 200) return UNREACHABLE
  const runs = parseRoutineRuns(answer.body)
  return runs === null ? UNREADABLE : { ok: true, value: runs }
}
