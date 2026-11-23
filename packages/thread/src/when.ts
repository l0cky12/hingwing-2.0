export interface ViewClock { readonly now: number; readonly timeZone: string }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const GAP = 15 * MINUTE
const PAST_THE_LONGEST_DAY = 26 * HOUR

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

interface Wall { readonly year: number; readonly month: number; readonly day: number; readonly hour: number; readonly minute: number }

const formats = new Map<string, Intl.DateTimeFormat>()

function wallClock(ms: number, zone: string): Wall {
  let format = formats.get(zone)
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
    })
    formats.set(zone, format)
  }
  const parts = format.formatToParts(ms)
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value)
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute') }
}

const dayOf = (wall: Wall) => Date.UTC(wall.year, wall.month - 1, wall.day) / (24 * HOUR)
const dayKey = (ms: number, zone: string) => dayOf(wallClock(ms, zone))
const two = (n: number) => String(n).padStart(2, '0')

export function timeWords(at: number, clock: ViewClock): string {
  const wall = wallClock(at, clock.timeZone)
  const today = wallClock(clock.now, clock.timeZone)
  const clockTime = `${two(wall.hour)}:${two(wall.minute)}`
  const daysAgo = dayOf(today) - dayOf(wall)
  if (daysAgo === 0) return `Today ${clockTime}`
  if (daysAgo === 1) return `Yesterday ${clockTime}`
  const weekday = WEEKDAYS[new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay()]
  const year = wall.year === today.year && daysAgo > 0 ? '' : ` ${wall.year}`
  return `${weekday} ${wall.day} ${MONTHS[wall.month - 1]}${year} ${clockTime}`
}

export function timeLines(starts: readonly (number | null)[], clock: ViewClock): readonly (string | null)[] {
  let previous: number | null = null
  return starts.map(at => {
    if (at === null) return null
    const shown = previous === null
      ? clock.now - at >= GAP
      : at - previous >= GAP || dayKey(at, clock.timeZone) !== dayKey(previous, clock.timeZone)
    previous = at
    return shown ? timeWords(at, clock) : null
  })
}

export function elapsedWords(began: number | null, now: number): string | null {
  if (began === null) return null
  const minutes = Math.floor(Math.max(0, now - began) / MINUTE)
  if (minutes < 1) return null
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return rest === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${rest} min`
}

export function changesAt(starts: readonly (number | null)[], lines: readonly (string | null)[], liveStart: number | null, clock: ViewClock): number | null {
  const { now } = clock
  const due: number[] = []
  if (liveStart !== null) due.push(liveStart + Math.max(1, Math.floor((now - liveStart) / MINUTE) + 1) * MINUTE)
  if (lines.some(line => line !== null)) due.push(nextMidnight(clock))
  const first = starts.findIndex(at => at !== null)
  const firstAt = starts[first] ?? null
  if (firstAt !== null && lines[first] === null) due.push(firstAt + GAP)
  return due.length === 0 ? null : Math.min(...due)
}

function nextMidnight({ now, timeZone: zone }: ViewClock): number {
  const today = dayKey(now, zone)
  let before = now
  let after = now + PAST_THE_LONGEST_DAY
  while (after - before > 1) {
    const middle = before + Math.floor((after - before) / 2)
    if (dayKey(middle, zone) === today) before = middle
    else after = middle
  }
  return after
}
