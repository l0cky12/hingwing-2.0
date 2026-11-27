/** The largest unit that divides a span of minutes, as Hermes stores intervals in minutes (cron/jobs.py:788). */
const UNITS: readonly (readonly [minutes: number, unit: string])[] = [[1440, 'day'], [60, 'hour'], [1, 'minute']]
const SHORT_UNITS: { readonly [letter: string]: number } = { m: 1, h: 60, d: 1440 }
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAY_SETS: { readonly [field: string]: string } = { '*': 'Every day', '1-5': 'Weekdays', '0,6': 'Weekends', '6,0': 'Weekends' }
const DATE = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric' })

function sized(minutes: number): { readonly count: number; readonly unit: string } {
  const [size, unit] = UNITS.find(([size]) => minutes % size === 0)!
  return { count: minutes / size, unit }
}

const span = (minutes: number) => {
  const { count, unit } = sized(minutes)
  return count === 1 ? `1 ${unit}` : `${count} ${unit}s`
}

const every = (minutes: number) => {
  const { count, unit } = sized(minutes)
  return count === 1 ? `Every ${unit}` : `Every ${count} ${unit}s`
}

const clock = (hour: number, minute: number) => `${hour}:${String(minute).padStart(2, '0')}`

const whole = (field: string, below: number): number | null => (/^\d+$/.test(field) && Number(field) < below ? Number(field) : null)

function daysOf(field: string): string | null {
  if (Object.hasOwn(DAY_SETS, field)) return DAY_SETS[field]!
  const days = field.split(',').map(day => whole(day, 8))
  if (days.some(day => day === null)) return null
  const names = days.map(day => `${DAYS[day!]}s`)
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** The common five-field cron expressions, or null for any other. */
function cronWords(expression: string): string | null {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minute, hour, date, month, weekday] = fields as [string, string, string, string, string]
  if (date !== '*' || month !== '*') return null
  const step = /^\*\/(\d+)$/.exec(minute)
  if (step !== null && hour === '*' && weekday === '*') return Number(step[1]) > 0 ? every(Number(step[1])) : null
  const atMinute = whole(minute, 60)
  if (atMinute === null) return null
  if (hour === '*' && weekday === '*') return atMinute === 0 ? 'Every hour' : `Every hour at ${atMinute} past`
  const atHour = whole(hour, 24)
  const days = daysOf(weekday)
  return atHour === null || days === null ? null : `${days} at ${clock(atHour, atMinute)}`
}

function onceWords(schedule: string): string | null {
  const at = /^once at (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(schedule)
  if (at !== null) {
    const [, year, month, day, hour, minute] = at.map(Number) as [number, number, number, number, number, number]
    return `Once, on ${DATE.format(new Date(year, month - 1, day))} at ${clock(hour, minute)}`
  }
  const inSpan = /^once in (.+)$/.exec(schedule)
  if (inSpan === null) return null
  const short = /^(\d+)([mhd])$/.exec(inSpan[1]!)
  return `Once, in ${short === null || Number(short[1]) === 0 ? inSpan[1] : span(Number(short[1]) * SHORT_UNITS[short[2]!]!)}`
}

/** Hermes's words for when a job runs (cron/jobs.py:784-853), in plain words where Highwing knows the form, else as Hermes wrote them. */
export function scheduleWords(schedule: string): string {
  const interval = /^every (\d+)m$/.exec(schedule)
  if (interval !== null && Number(interval[1]) > 0) return every(Number(interval[1]))
  return onceWords(schedule) ?? cronWords(schedule) ?? schedule
}
