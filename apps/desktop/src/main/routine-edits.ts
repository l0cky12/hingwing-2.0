import { parseCronJob, type ReadHermes, type WriteHermes } from '@highwing/hermes'
import { parseRoutineRuns, ranOf, requestOf, runsPath, type BotId, type CommandOutcome, type Edited, type Refusal, type RoutineEdit, type RoutineId } from '@highwing/hermes/domain'

const refused = (kind: Refusal['kind'], message: string) => ({ ok: false, refusal: { kind, message } }) as const
const ALREADY_RUNNING = refused('rejected', 'This routine is already running.')
const GONE = refused('stale', "That routine isn't there any more.")
const UNREADABLE = refused('stale', "Hermes answered, but Highwing can't tell how that routine stands now.")
const UNREACHED = (what: string) => refused('offline', `Highwing couldn't reach Hermes to ${what}.`)

const NOT_OFFERED: { readonly [E in RoutineEdit['do']]: ReturnType<typeof refused> } = {
  run: refused('unsupported', "This Hermes can't run a routine now from Highwing."),
  reschedule: refused('unsupported', "This Hermes can't change a routine's schedule from Highwing.")
}
const TRIED: { readonly [E in RoutineEdit['do']]: string } = { run: 'run that routine', reschedule: 'change that routine' }

type Obj = Readonly<Record<string, unknown>>
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)
const detailOf = (body: unknown): string | null => (isObject(body) && typeof body.detail === 'string' && body.detail.trim() !== '' ? body.detail.trim() : null)
const sentence = (words: string) => (/[.!?]$/.test(words) ? words : `${words}.`)

/**
 * Whether this Hermes serves the routes that run a routine and change its schedule. Neither can be asked without doing it: a GET of
 * the trigger route is not answered 405 but 404 `No such API endpoint`, because Hermes's catch-all GET route takes it
 * (hermes_cli/web_server_dashboard.py `serve_spa`). The same router gained the run list after both, on 2026-06-06 against 2026-04-12
 * (git log -S of each path in hermes_cli/web_server.py), so a Hermes that answers the run list has both. The list answers `200`
 * for any job id, so any routine of the bot can be asked about. Anything else, such as no answer, leaves both controls hidden.
 */
export async function routineEditsOffered(read: ReadHermes, bot: BotId, routine: RoutineId): Promise<boolean> {
  const answer = await read(runsPath(routine, bot, 1)).catch(() => null)
  return answer?.status === 200 && parseRoutineRuns(answer.body) !== null
}

/** What a 400 means: Hermes read the schedule and would not take it, in its own words. */
const rejected = (detail: string | null) => refused('rejected', `Hermes couldn't use that schedule: ${sentence(detail ?? 'it gave no reason')}`)

function refusalOf(edit: RoutineEdit, status: number, body: unknown): CommandOutcome<never> {
  const detail = detailOf(body)
  if (status === 409 && edit.do === 'run') return ALREADY_RUNNING
  if (status === 400 && edit.do === 'reschedule') return rejected(detail)
  if (status === 404 && detail === 'Job not found') return GONE
  if (status === 404 || status === 405) return NOT_OFFERED[edit.do]
  return UNREACHED(TRIED[edit.do])
}

/**
 * Asks Hermes to run `routine` now, or to give it another schedule, and answers the routine as Hermes now holds it. A run
 * answers only once the job has run, so it can take as long as the job does.
 */
export async function editRoutine(write: WriteHermes, bot: BotId, routine: RoutineId, edit: RoutineEdit): Promise<CommandOutcome<Edited>> {
  const answer = await write(requestOf(edit, routine, bot)).catch(() => null)
  if (answer === null) return UNREACHED(TRIED[edit.do])
  if (answer.status !== 200) return refusalOf(edit, answer.status, answer.body)
  const now = parseCronJob(answer.body)
  return now === null || now.id !== routine ? UNREADABLE : { ok: true, value: { routine: now, ran: edit.do === 'run' ? ranOf(answer.body) : null } }
}
