export interface ViewClock { readonly now: number; readonly timeZone: string }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const GAP = 15 * MINUTE
const PAST_THE_LONGEST_DAY = 26 * HOUR

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

interface Wall { readonly year: number; readonly month: number; readonly day: number; readonly hour: number; readonly minute: number }

interface Zone {
  readonly format: Intl.DateTimeFormat
  readonly starts: Map<number, Wall>
  midnight: { readonly from: number; readonly at: number } | null
}

const zones = new Map<string, Zone>()
const STARTS_KEPT = 4096

function zoneOf(timeZone: string): Zone {
  let zone = zones.get(timeZone)
  if (zone === undefined) {
    const format = new Intl.DateTimeFormat('en-GB', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
    })
    zone = { format, starts: new Map(), midnight: null }
    zones.set(timeZone, zone)
  }
  return zone
}

function wallClock(ms: number, zone: Zone): Wall {
  const parts = zone.format.formatToParts(ms)
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value)
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute') }
}

/** The view is rebuilt on every delta and a turn's start never moves, so each start is formatted once. */
function startWall(at: number, zone: Zone): Wall {
  let wall = zone.starts.get(at)
  if (wall === undefined) {
    if (zone.starts.size >= STARTS_KEPT) zone.starts.clear()
    wall = wallClock(at, zone)
    zone.starts.set(at, wall)
  }
  return wall
}

const dayOf = (wall: Wall) => Date.UTC(wall.year, wall.month - 1, wall.day) / (24 * HOUR)
const two = (n: number) => String(n).padStart(2, '0')

function timeWords(wall: Wall, today: Wall): string {
  const clockTime = `${two(wall.hour)}:${two(wall.minute)}`
  const daysAgo = dayOf(today) - dayOf(wall)
  if (daysAgo === 0) return `Today ${clockTime}`
  if (daysAgo === 1) return `Yesterday ${clockTime}`
  const weekday = WEEKDAYS[new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay()]
  const year = wall.year === today.year && daysAgo > 0 ? '' : ` ${wall.year}`
  return `${weekday} ${wall.day} ${MONTHS[wall.month - 1]}${year} ${clockTime}`
}

export function timeOfDay(at: number, timeZone: string): string {
  const { hour, minute } = wallClock(at, zoneOf(timeZone))
  return `${two(hour)}:${two(minute)}`
}

export function timeLines(starts: readonly (number | null)[], clock: ViewClock): readonly (string | null)[] {
  const zone = zoneOf(clock.timeZone)
  const today = wallClock(clock.now, zone)
  let previous: number | null = null
  return starts.map(at => {
    if (at === null) return null
    const shown = previous === null
      ? clock.now - at >= GAP
      : at - previous >= GAP || dayOf(startWall(at, zone)) !== dayOf(startWall(previous, zone))
    previous = at
    return shown ? timeWords(startWall(at, zone), today) : null
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
  if (lines.some(line => line !== null)) due.push(nextMidnight(now, zoneOf(clock.timeZone)))
  const first = starts.findIndex(at => at !== null)
  const firstAt = starts[first] ?? null
  if (firstAt !== null && lines[first] === null) due.push(firstAt + GAP)
  return due.length === 0 ? null : Math.min(...due)
}

function nextMidnight(now: number, zone: Zone): number {
  const known = zone.midnight
  if (known !== null && known.from <= now && now < known.at) return known.at
  const today = dayOf(wallClock(now, zone))
  let before = now
  let after = now + PAST_THE_LONGEST_DAY
  while (after - before > 1) {
    const middle = before + Math.floor((after - before) / 2)
    if (dayOf(wallClock(middle, zone)) === today) before = middle
    else after = middle
  }
  zone.midnight = { from: now, at: after }
  return after
}
