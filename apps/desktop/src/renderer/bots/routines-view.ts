import type { CommandOutcome, Routine, RoutineId, RoutineRun, RunOutcome, SessionId } from '@highwing/hermes/domain'
import { whenWords, type ViewClock } from '@highwing/thread'

export interface RoutineRow { readonly id: RoutineId; readonly name: string; readonly when: string; readonly paused: boolean }

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
  return { state: 'listed', rows: listed.value.map(routine => ({ id: routine.id, name: routine.name, when: routine.paused ? 'Paused' : scheduleWords(routine.schedule), paused: routine.paused })) }
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
  /** The chat that opens it. null: Hermes kept none. */
  readonly chat: SessionId | null
}

export type RunsView =
  | { readonly state: 'loading' }
  | { readonly state: 'refused'; readonly message: string }
  | { readonly state: 'empty'; readonly hint: string }
  | { readonly state: 'listed'; readonly rows: readonly RunRow[] }

export function runsViewOf(listed: CommandOutcome<readonly RoutineRun[]> | null, clock: ViewClock): RunsView {
  if (listed === null) return { state: 'loading' }
  if (!listed.ok) return { state: 'refused', message: listed.refusal.message }
  if (listed.value.length === 0) return { state: 'empty', hint: NO_RUNS }
  return {
    state: 'listed',
    rows: listed.value.map(run => ({
      key: run.key, outcome: run.outcome.is, state: OUTCOME_WORDS[run.outcome.is], when: whenWords(run.at, clock),
      took: run.seconds === null ? null : tookWords(run.seconds), why: reasonOf(run.outcome), chat: run.chat
    }))
  }
}
