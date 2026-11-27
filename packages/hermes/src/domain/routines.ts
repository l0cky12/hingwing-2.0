/** A bot's scheduled jobs, which Hermes runs on its own machine and Highwing only shows. Plain JSON data, because `Routines` crosses Electron IPC. */
import type { BotId } from './bots'

declare const brand: unique symbol

/** Hermes's `job_id`. */
export type RoutineId = string & { readonly [brand]: 'RoutineId' }

export interface Routine {
  readonly id: RoutineId
  readonly name: string
  /** When it runs, in plain words, such as "Every day at 09:00". */
  readonly schedule: string
  readonly paused: boolean
}

export type RoutineList =
  | { readonly state: 'reading' }
  | { readonly state: 'listed'; readonly routines: readonly Routine[] }
  | { readonly state: 'refused'; readonly message: string }

/** The bot whose routines a window shows, and what Hermes said of them. null while no window shows any. */
export type Routines = { readonly bot: BotId; readonly list: RoutineList } | null

/** Cron counts Sunday as 0 and as 7, so the week is listed from Monday. */
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
const dayOf = (digit: number) => WEEK[(digit + 6) % 7]!
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

const every = (count: number, unit: string) => (count === 1 ? `Every ${unit}` : `Every ${count} ${unit}s`)
const inList = (items: readonly string[]) => (items.length === 1 ? items[0]! : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

/** `schedule_display` for an interval is always in minutes (cron/jobs.py:784-853). */
function everyMinutes(minutes: number): string {
  if (minutes === 1) return 'Every minute'
  if (minutes % 1440 === 0) return every(minutes / 1440, 'day')
  if (minutes % 60 === 0) return every(minutes / 60, 'hour')
  return `Every ${minutes} minutes`
}

const timeOf = (minute: string, hour: string): string | null =>
  Number(hour) < 24 && Number(minute) < 60 ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}` : null

/** A day-of-week field of digits or names, single or in ranges, as the days it names; null for anything else. */
function daysIn(field: string): readonly number[] | null {
  const digits = field.toUpperCase().replace(/[A-Z]{3}/g, name => String(DAY_NAMES.indexOf(name)))
  if (!/^[0-7](-[0-7])?(,[0-7](-[0-7])?)*$/.test(digits)) return null
  const days = new Set<number>()
  for (const part of digits.split(',')) {
    const [from, to = from] = part.split('-').map(Number) as [number, number?]
    if (to < from) return null
    for (let day = from; day <= to; day++) days.add(day % 7)
  }
  return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
}

function onDays(field: string, at: string): string | null {
  if (field === '*') return `Every day at ${at}`
  const days = daysIn(field)
  if (days === null) return null
  const key = days.join(',')
  if (key === '1,2,3,4,5') return `Weekdays at ${at}`
  if (key === '6,0') return `Weekends at ${at}`
  return `Every ${inList(days.map(dayOf))} at ${at}`
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`
/** Hermes's `next_run_at`, an ISO time in its own zone, as the same wall-clock date and time `once at` shows. */
const wallClockOf = (iso: string | null) => (iso === null ? null : /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso)?.slice(1).join(' ') ?? null)

type Rule = readonly [RegExp, (match: RegExpMatchArray, nextRunAt: string | null) => string | null]

/**
 * A rule answers null when its shape fits but a number is out of range, so the text is shown as written. A step is put in
 * words only when it divides the hour or the day, since cron starts it again at each one.
 */
const RULES: readonly Rule[] = [
  [/^every ([1-9]\d*)m$/i, ([, minutes]) => everyMinutes(Number(minutes))],
  [/^(\d{1,2}) (\d{1,2}) \* \* (\S+)$/, ([, minute, hour, days]) => {
    const at = timeOf(minute!, hour!)
    return at === null ? null : onDays(days!, at)
  }],
  [/^(\d{1,2}) (\d{1,2}) ([1-9]|[12]\d|3[01]) \* \*$/, ([, minute, hour, day]) => {
    const at = timeOf(minute!, hour!)
    return at === null ? null : `Monthly on the ${ordinal(Number(day))} at ${at}`
  }],
  [/^0 \* \* \* \*$/, () => 'Every hour'],
  [/^(\d{1,2}) \* \* \* \*$/, ([, minute]) => (Number(minute) < 60 ? `Every hour at :${minute!.padStart(2, '0')}` : null)],
  [/^\*\/([1-9]\d*) \* \* \* \*$/, ([, minutes]) => (60 % Number(minutes) === 0 ? every(Number(minutes), 'minute') : null)],
  [/^0 \*\/([1-9]\d*) \* \* \*$/, ([, hours]) => (24 % Number(hours) === 0 ? every(Number(hours), 'hour') : null)],
  [/^once at (.+)$/i, ([, when]) => `Once, at ${when}`],
  [/^once in\b/i, (_, nextRunAt) => {
    const when = wallClockOf(nextRunAt)
    return when === null ? 'Once' : `Once, at ${when}`
  }]
]

/**
 * Hermes's `schedule_display`: an interval, a phrase the user typed, a raw cron expression, or a one-off. `nextRunAt` dates a
 * one-off set as a delay. Text that fits no rule is shown as written.
 */
export function scheduleInWords(display: string, nextRunAt: string | null = null): string {
  const text = display.trim()
  if (text === '') return 'No schedule'
  for (const [pattern, words] of RULES) {
    const match = pattern.exec(text)
    const said = match === null ? null : words(match, nextRunAt)
    if (said !== null) return said
  }
  return text.charAt(0).toUpperCase() + text.slice(1)
}
