import type { BotId, CommandOutcome, Edited, Ran, Routine, RoutineEdit, RoutineId, RoutineRun, RunOutcome, SessionId } from '@highwing/hermes/domain'
import { whenWords, type ViewClock } from '@highwing/thread'

export interface RoutineRow {
  readonly id: RoutineId
  readonly name: string
  readonly when: string
  readonly paused: boolean
  /** Hermes's own words for the schedule, as it stores them. They fill the schedule field, and `when` is these said for a reader. */
  readonly schedule: string
}

export type RoutinesView =
  | { readonly state: 'loading' }
  | { readonly state: 'refused'; readonly message: string }
  | { readonly state: 'empty'; readonly hint: string }
  | { readonly state: 'listed'; readonly rows: readonly RoutineRow[] }

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const UNITS: { readonly [unit: string]: readonly [string, string] } = { m: ['minute', 'minutes'], h: ['hour', 'hours'], d: ['day', 'days'] }

const counted = (n: number, unit: string) => (n === 1 ? `1 ${UNITS[unit]![0]}` : `${n} ${UNITS[unit]![1]}`)
const clock = (hour: string, minute: string) => `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`

function everyMinutes(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? 'Every day' : `Every ${counted(minutes / 1440, 'd')}`
  if (minutes % 60 === 0) return minutes === 60 ? 'Every hour' : `Every ${counted(minutes / 60, 'h')}`
  return minutes === 1 ? 'Every minute' : `Every ${counted(minutes, 'm')}`
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const dayNumber = (raw: string) => (/^[0-7]$/.test(raw) ? Number(raw) % 7 : DAY_NAMES.indexOf(raw.toLowerCase()))

/** A cron day-of-week field as the words that start a phrase, or null for one this table doesn't say. */
function onDays(field: string): string | null {
  if (field === '*') return 'Every day'
  const days = field.split(',').flatMap(part => {
    const range = /^(\w+)-(\w+)$/.exec(part)
    if (range === null) return [dayNumber(part)]
    const [from, to] = [dayNumber(range[1]!), dayNumber(range[2]!)]
    return from < 0 || to < from ? [-1] : Array.from({ length: to - from + 1 }, (_, at) => from + at)
  })
  if (days.includes(-1)) return null
  const set = [...new Set(days)].sort().join(',')
  if (set === '1,2,3,4,5') return 'Weekdays'
  if (set === '0,6') return 'Weekends'
  return days.length === 1 ? `Every ${WEEKDAYS[days[0]!]}` : null
}

/** A cron step restarts each hour or day, so it is a steady interval only when it divides that evenly. A 7-minute step runs at :56 and then :00. */
const evenly = (step: number, cycle: number) => step > 0 && cycle % step === 0

const pastTheHour = (minute: string) => (Number(minute) === 0 ? '' : `, at ${Number(minute)} past`)

/**
 * Hermes's words for a schedule (cron/jobs.py:784-853), as a person would say them: an interval, a one-off, or the common shapes
 * of a cron expression. Anything else, such as a phrase the user typed (`every monday 9am`) or a rarer cron expression, is
 * shown as Hermes has it.
 */
const SHAPES: readonly (readonly [RegExp, (match: RegExpExecArray) => string | null])[] = [
  [/^every (\d+)m$/, ([, minutes]) => everyMinutes(Number(minutes))],
  [/^once at (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/, ([, year, month, day, hour, minute]) => `Once, on ${Number(day)} ${MONTHS[Number(month) - 1]} ${year} at ${hour}:${minute}`],
  [/^once in (\d+)\s*([mhd])$/, ([, n, unit]) => `Once, in ${counted(Number(n), unit!)}`],
  [/^\*\/(\d+) \* \* \* \*$/, ([, minutes]) => (evenly(Number(minutes), 60) ? everyMinutes(Number(minutes)) : null)],
  [/^(\d{1,2}) \* \* \* \*$/, ([, minute]) => `Every hour${pastTheHour(minute!)}`],
  [/^(\d{1,2}) \*\/(\d+) \* \* \*$/, ([, minute, hours]) => (evenly(Number(hours), 24) ? `${everyMinutes(Number(hours) * 60)}${pastTheHour(minute!)}` : null)],
  [/^(\d{1,2}) (\d{1,2}) (\d{1,2}) \* \*$/, ([, minute, hour, day]) => `Every month on day ${Number(day)} at ${clock(hour!, minute!)}`],
  [/^(\d{1,2}) (\d{1,2}) \* \* ([\w,*-]+)$/, ([, minute, hour, days]) => {
    const on = onDays(days!)
    return on === null ? null : `${on} at ${clock(hour!, minute!)}`
  }]
]

export function scheduleWords(schedule: string): string {
  const said = schedule.trim()
  for (const [shape, words] of SHAPES) {
    const match = shape.exec(said)
    const phrase = match === null ? null : words(match)
    if (phrase !== null) return phrase
  }
  return said === '' ? 'No schedule' : said[0]!.toUpperCase() + said.slice(1)
}

export const emptyHint = (bot: string) =>
  `${bot} has no routines yet. To make one, ask ${bot} in a chat, for example "Every weekday at 9am, sum up my unread email."`

export function routinesViewOf(listed: CommandOutcome<readonly Routine[]> | null, bot: string): RoutinesView {
  if (listed === null) return { state: 'loading' }
  if (!listed.ok) return { state: 'refused', message: listed.refusal.message }
  if (listed.value.length === 0) return { state: 'empty', hint: emptyHint(bot) }
  return { state: 'listed', rows: listed.value.map(routine => ({ id: routine.id, name: routine.name, when: routine.paused ? 'Paused' : scheduleWords(routine.schedule), paused: routine.paused, schedule: routine.schedule })) }
}

/**
 * The list after Hermes answered a control of routine `id`: the routine as Hermes now holds it, or gone after a delete. A Hermes
 * that cannot change routines takes the list away with its reason, and any other refusal leaves the list and says why.
 */
export function afterControl(
  listed: CommandOutcome<readonly Routine[]>, id: RoutineId, answered: CommandOutcome<Routine | null>
): { readonly listed: CommandOutcome<readonly Routine[]>; readonly said: string | null } {
  if (!answered.ok) return answered.refusal.kind === 'unsupported' ? { listed: answered, said: null } : { listed, said: answered.refusal.message }
  if (!listed.ok) return { listed, said: null }
  const now = answered.value
  return { listed: { ok: true, value: now === null ? listed.value.filter(held => held.id !== id) : listed.value.map(held => (held.id === id ? now : held)) }, said: null }
}

export const NO_RUNS = 'No runs yet.'

/** How long an open list waits before it asks Hermes again. */
export const REREAD_MS = 15_000

/**
 * When an open list reads the runs again, or null for never. Hermes sends `cron.changed` only for the gateway's own profile
 * (tui_gateway/change_watcher.py), so another bot's runs start and end with no word from Hermes. A Hermes without the route
 * is not asked again.
 */
export const rereadAfter = (listed: CommandOutcome<readonly RoutineRun[]> | null): number | null =>
  listed !== null && !listed.ok && listed.refusal.kind === 'unsupported' ? null : REREAD_MS

/** The list after another read: a failed read keeps the runs already shown, so a moment offline doesn't take them away. */
export const afterReread = (
  held: CommandOutcome<readonly RoutineRun[]> | null, answered: CommandOutcome<readonly RoutineRun[]>
): CommandOutcome<readonly RoutineRun[]> => (!answered.ok && held?.ok === true ? held : answered)

/** How a run went, in words, because a colour alone says nothing to everyone. */
export const OUTCOME_WORDS: { readonly [S in RunOutcome['is']]: string } = {
  running: 'Running', succeeded: 'Succeeded', failed: 'Failed', cancelled: 'Cancelled', missed: 'Missed', unknown: 'No result'
}

/** A run's length as `took 42 s`, `took 3 min` or `took 1 h 5 min`. */
export function tookWords(seconds: number): string {
  const whole = Math.round(seconds)
  if (whole === 0) return 'took under 1 s'
  if (whole < 60) return `took ${whole} s`
  const minutes = Math.round(whole / 60)
  if (minutes < 60) return `took ${minutes} min`
  return minutes % 60 === 0 ? `took ${minutes / 60} h` : `took ${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

const reasonOf = (outcome: RunOutcome): string | null => ('why' in outcome ? outcome.why : null)

export interface RunRow {
  readonly key: string
  readonly outcome: RunOutcome['is']
  readonly state: string
  readonly when: string
  readonly took: string | null
  readonly why: string | null
  /** The chat that opens it, and the bot whose profile holds it. null: Hermes kept none. */
  readonly chat: { readonly sessionId: SessionId; readonly bot: BotId } | null
}

export type RunsView =
  | { readonly state: 'loading' }
  | { readonly state: 'refused'; readonly message: string }
  | { readonly state: 'empty'; readonly hint: string }
  | { readonly state: 'listed'; readonly rows: readonly RunRow[] }

/** `bot`: the routine's bot, whose profile holds a run's chat when Hermes doesn't name another. */
export function runsViewOf(listed: CommandOutcome<readonly RoutineRun[]> | null, clock: ViewClock, bot: BotId): RunsView {
  if (listed === null) return { state: 'loading' }
  if (!listed.ok) return { state: 'refused', message: listed.refusal.message }
  if (listed.value.length === 0) return { state: 'empty', hint: NO_RUNS }
  return {
    state: 'listed',
    rows: listed.value.map(run => ({
      key: run.key, outcome: run.outcome.is, state: OUTCOME_WORDS[run.outcome.is], when: whenWords(run.at, clock),
      took: run.seconds === null ? null : tookWords(run.seconds), why: reasonOf(run.outcome), chat: run.chat === null ? null : { sessionId: run.chat, bot: run.owner ?? bot }
    }))
  }
}

/** What this Hermes serves, as far as the tab knows. `offered` is the answer of the probe, and `withdrawn` the edits a Hermes later said it cannot do. */
export interface EditsKnown { readonly offered: boolean; readonly withdrawn: readonly RoutineEdit['do'][] }
export interface EditControls { readonly run: boolean; readonly reschedule: boolean }

/** Which controls the tab shows. Neither shows until Hermes has said it serves them, and one a later answer called unsupported goes again. */
export const editControlsOf = (known: EditsKnown | null): EditControls => ({
  run: known?.offered === true && !known.withdrawn.includes('run'),
  reschedule: known?.offered === true && !known.withdrawn.includes('reschedule')
})

/** `answered` is Hermes's reply to `edit`, and a refusal of kind `unsupported` is its word that it cannot do that edit at all. */
export const afterEditKnown = <K extends EditsKnown>(known: K, edit: RoutineEdit, answered: CommandOutcome<Edited>): K =>
  answered.ok || answered.refusal.kind !== 'unsupported' || known.withdrawn.includes(edit.do) ? known : { ...known, withdrawn: [...known.withdrawn, edit.do] }

/** A paused routine has no Run now: Hermes would run it and resume it, which is more than the word says. */
export const canRun = (row: Pick<RoutineRow, 'paused'>, controls: EditControls): boolean => controls.run && !row.paused

export const RUNNING_WORDS = 'Running now…'
const RAN_WORDS: { readonly [R in Ran['is']]: (ran: Extract<Ran, { is: R }>) => string } = {
  succeeded: () => 'It succeeded.',
  failed: ({ why }) => (why === null ? 'It failed, and Hermes gave no reason.' : `It failed: ${why}`),
  undelivered: () => "It ran, but its result didn't reach where it goes.",
  cancelled: () => 'It was stopped before it finished.'
}

/** What Hermes said of the run it just did. Past runs holds the run itself. */
export function ranWords(routine: Routine, ran: Ran | null): string {
  const said = ran === null ? null : (RAN_WORDS[ran.is] as (held: Ran) => string)(ran)
  return said === null ? `Ran ${routine.name}.` : `Ran ${routine.name}. ${said}`
}

/**
 * What Hermes's answer to a new schedule says of the next run, in Hermes's own words: its `next_run_at`, as the time line of a turn says it.
 * Nothing here works out a time from the schedule. A paused routine has none, and an answer with none says so.
 */
export function savedWords(routine: Routine, clock: ViewClock): string {
  if (routine.paused) return "Saved. It's paused, so it has no next run."
  if (routine.nextRunAt === null) return 'Saved. Hermes has no next run for it.'
  const at = Date.parse(routine.nextRunAt)
  return Number.isNaN(at) ? 'Saved.' : `Saved. Hermes runs it next ${whenWords(at, clock)}.`
}

/** The forms Hermes reads for a schedule (cron/jobs.py `parse_schedule`), as one line of help. Highwing reads none of them. */
export const SCHEDULE_HINT = 'Hermes reads forms like every 30m, 0 9 * * 1-5, every monday 9am or in 2h.'

/** The schedule field of one routine. `words`: what Hermes refused with, shown under the field until the next change. */
export interface Editor { readonly text: string; readonly saving: boolean; readonly words: string | null }

export const openEditor = (row: Pick<RoutineRow, 'schedule'>): Editor => ({ text: row.schedule, saving: false, words: null })
export const typedInto = (editor: Editor, text: string): Editor => ({ text, saving: false, words: null })

/** Save asks Hermes, so it takes a schedule that is not blank and not the one the routine has. Comparing the text decides nothing about a schedule. */
export const canSave = (editor: Editor, row: Pick<RoutineRow, 'schedule'>): boolean =>
  !editor.saving && editor.text.trim() !== '' && editor.text.trim() !== row.schedule.trim()

/** A refusal of a save that the open field shows, since the text can be changed and sent again. Any other, `unsupported` or `stale`, means the control or the routine is gone. */
const staysInField = (answered: CommandOutcome<Edited>): boolean => !answered.ok && (answered.refusal.kind === 'rejected' || answered.refusal.kind === 'offline')

/** The editor once Hermes answered the save: closed after Hermes took it, or open with its words after one that `staysInField`. */
export const afterSave = (editor: Editor, answered: CommandOutcome<Edited>): Editor | null =>
  !answered.ok && staysInField(answered) ? { ...editor, saving: false, words: answered.refusal.message } : null

/**
 * The list after Hermes answered an edit of routine `id`: the routine as Hermes now holds it, and `note` saying what was done. A refusal
 * keeps the list. A refusal the schedule field shows, as it stays open with it, is not also said above the list.
 */
export function afterEdit(
  listed: CommandOutcome<readonly Routine[]>, id: RoutineId, edit: RoutineEdit, answered: CommandOutcome<Edited>, clock: ViewClock
): { readonly listed: CommandOutcome<readonly Routine[]>; readonly said: string | null; readonly note: string | null } {
  if (!answered.ok) {
    return { listed, said: edit.do === 'reschedule' && staysInField(answered) ? null : answered.refusal.message, note: null }
  }
  const { routine: now, ran } = answered.value
  const next = listed.ok ? { ok: true, value: listed.value.map(held => (held.id === id ? now : held)) } as const : listed
  return { listed: next, said: null, note: edit.do === 'run' ? ranWords(now, ran) : savedWords(now, clock) }
}

/** A routine Hermes says is not there, so the list is read again. */
export const isGone = (answered: CommandOutcome<Edited>): boolean => !answered.ok && answered.refusal.kind === 'stale'
