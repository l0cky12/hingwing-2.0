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
const dayOf = (digit: string) => WEEK[(Number(digit) + 6) % 7]!

const every = (count: number, unit: string) => (count === 1 ? `Every ${unit}` : `Every ${count} ${unit}s`)

/** `schedule_display` for an interval is always in minutes (cron/jobs.py:784-853). */
function everyMinutes(minutes: number): string {
  if (minutes === 1) return 'Every minute'
  if (minutes % 1440 === 0) return every(minutes / 1440, 'day')
  if (minutes % 60 === 0) return every(minutes / 60, 'hour')
  return `Every ${minutes} minutes`
}

const timeOf = (minute: string, hour: string): string | null =>
  Number(hour) < 24 && Number(minute) < 60 ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}` : null

function onDays(days: string, at: string): string | null {
  if (days === '*') return `Every day at ${at}`
  if (days === '1-5') return `Weekdays at ${at}`
  if (days === '0,6' || days === '6,0') return `Weekends at ${at}`
  if (!/^[0-7](,[0-7])*$/.test(days)) return null
  const named = [...new Set(days.split(',').map(dayOf))].sort((a, b) => WEEK.indexOf(a) - WEEK.indexOf(b))
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`
  return `Every ${list} at ${at}`
}

/** A rule answers null when its shape fits but a number is out of range, so the text is shown as written. */
const RULES: readonly (readonly [RegExp, (match: RegExpMatchArray) => string | null])[] = [
  [/^every ([1-9]\d*)m$/i, ([, minutes]) => everyMinutes(Number(minutes))],
  [/^(\d{1,2}) (\d{1,2}) \* \* (\S+)$/, ([, minute, hour, days]) => {
    const at = timeOf(minute!, hour!)
    return at === null ? null : onDays(days!, at)
  }],
  [/^0 \* \* \* \*$/, () => 'Every hour'],
  [/^(\d{1,2}) \* \* \* \*$/, ([, minute]) => (Number(minute) < 60 ? `Every hour at :${minute!.padStart(2, '0')}` : null)],
  [/^\*\/([1-9]\d*) \* \* \* \*$/, ([, minutes]) => every(Number(minutes), 'minute')],
  [/^0 \*\/([1-9]\d*) \* \* \*$/, ([, hours]) => every(Number(hours), 'hour')],
  [/^once at (.+)$/i, ([, when]) => `Once, at ${when}`],
  [/^once in\b/i, () => 'Once']
]

/** Hermes's `schedule_display`: an interval, a phrase the user typed, a raw cron expression, or a one-off. Text that fits no rule is shown as written. */
export function scheduleInWords(display: string): string {
  const text = display.trim()
  if (text === '') return 'No schedule'
  for (const [pattern, words] of RULES) {
    const match = pattern.exec(text)
    const said = match === null ? null : words(match)
    if (said !== null) return said
  }
  return text.charAt(0).toUpperCase() + text.slice(1)
}
