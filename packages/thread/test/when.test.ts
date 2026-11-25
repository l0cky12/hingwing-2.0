import { describe, expect, it } from 'vitest'
import type { Began, Generation, Item, Session, SettledTurn, Sync, ToolItem, TurnId } from '../../hermes/src/domain/session'
import { checkThread, outline, threadView } from '../src/thread-view'
import type { ViewClock } from '../src/when'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const NOW = Date.UTC(2026, 10, 21, 15, 0, 0)
const UTC = (now = NOW): ViewClock => ({ now, timeZone: 'UTC' })
const at = (iso: string) => Date.parse(iso)
const client = (ms: number): Began => ({ at: ms, clock: 'client' })

const settled = (id: string, began: Began | null): SettledTurn => ({
  id: id as TurnId, request: { text: `Request ${id}`, inputId: null, rowId: null, attachments: [] }, began, items: [{ kind: 'text', markdown: `Answer ${id}`, sealed: true }],
  outcome: { kind: 'complete' }, rows: [], tokens: null
})

const session = (history: readonly SettledTurn[], over: Partial<Session> = {}): Session => ({
  id: 's1' as Session['id'], title: '', cwd: null, history, earlier: 'none', run: { state: 'idle' }, interlude: [], requests: [], queue: [], outbox: [],
  model: { current: null, next: null, ask: null }, usage: { totals: null, context: null }, tuning: { reasoning: null, busy: null, effort: null, fast: null, yolo: null }, sides: [], sync: { state: 'live' }, ...over
})

const running = (began: Began | null, items: readonly Item[] = [], history: readonly SettledTurn[] = [], sync: Sync = { state: 'live' }): Session =>
  session(history, {
    sync,
    run: { state: 'running', generation: 1 as Generation, stop: 'none', turn: { id: 't9' as TurnId, request: { text: 'Run the tests', inputId: null, rowId: null, attachments: [] }, began, items, announced: null } }
  })

const tool = (id: string, command: string): ToolItem => ({ kind: 'tool', id: id as ToolItem['id'], name: 'terminal', args: { command }, status: { s: 'running', note: null } })
const lines = (s: Session, clock: ViewClock) => outline(threadView(s, clock)).split('\n')

describe('the time line above a turn', () => {
  it('shows one above a turn two hours old and one 20 minutes after it, and none a minute after that', () => {
    const first = NOW - 2 * HOUR
    const history = [settled('t1', client(first)), settled('t2', client(first + 20 * MINUTE)), settled('t3', client(first + 21 * MINUTE))]
    expect(lines(session(history), UTC())).toEqual([
      '@ Today 13:00',
      '> Request t1',
      '| Answer t1',
      '✓ Done',
      '',
      '@ Today 13:20',
      '> Request t2',
      '| Answer t2',
      '✓ Done',
      '',
      '> Request t3',
      '| Answer t3',
      '✓ Done'
    ])
  })

  it('shows none above a first turn that began under 15 minutes ago', () => {
    expect(lines(session([settled('t1', client(NOW - 14 * MINUTE))]), UTC())[0]).toBe('> Request t1')
    expect(lines(session([settled('t1', client(NOW - 15 * MINUTE))]), UTC())[0]).toBe('@ Today 14:45')
  })

  it('says Yesterday for the day before, in the viewer\'s zone', () => {
    expect(lines(session([settled('t1', client(at('2026-11-20T09:30:00Z')))]), UTC())[0]).toBe('@ Yesterday 09:30')
    const tokyo: ViewClock = { now: NOW, timeZone: 'Asia/Tokyo' }
    expect(lines(session([settled('t1', client(at('2026-11-21T14:00:00Z')))]), tokyo)[0]).toBe('@ Yesterday 23:00')
  })

  it('dates an older turn in the same year without the year', () => {
    expect(lines(session([settled('t1', client(at('2026-11-03T16:12:00Z')))]), UTC())[0]).toBe('@ Tue 3 Nov 16:12')
  })

  it('adds the year for another year, and for a day after today', () => {
    expect(lines(session([settled('t1', client(at('2025-11-03T16:12:00Z')))]), UTC())[0]).toBe('@ Mon 3 Nov 2025 16:12')
    expect(lines(session([settled('t1', client(at('2026-11-02T08:05:00Z'))), settled('t2', client(at('2026-11-23T09:00:00Z')))]), UTC())
      .filter(line => line.startsWith('@'))).toEqual(['@ Mon 2 Nov 08:05', '@ Mon 23 Nov 2026 09:00'])
  })

  it('shows one when the day changes even if the turns are under 15 minutes apart', () => {
    const history = [settled('t1', client(at('2026-11-20T23:55:00Z'))), settled('t2', client(at('2026-11-21T00:05:00Z')))]
    expect(lines(session(history), UTC()).filter(line => line.startsWith('@'))).toEqual(['@ Yesterday 23:55', '@ Today 00:05'])
  })

  it('compares a turn with the nearest earlier turn that has a known start, and draws nothing for an untimed one', () => {
    const first = NOW - 2 * HOUR
    const close = [settled('t1', client(first)), settled('t2', null), settled('t3', client(first + 5 * MINUTE))]
    expect(lines(session(close), UTC()).filter(line => line.startsWith('@'))).toEqual(['@ Today 13:00'])
    const apart = [settled('t1', client(first)), settled('t2', null), settled('t3', client(first + 20 * MINUTE))]
    expect(lines(session(apart), UTC()).filter(line => line.startsWith('@'))).toEqual(['@ Today 13:00', '@ Today 13:20'])
  })

  it('draws no line and no error for a turn read from history with no time', () => {
    const view = threadView(session([settled('t1', null)]), UTC())
    expect(view.turns[0]!.time).toBeNull()
    expect(outline(view)).toBe(['> Request t1', '| Answer t1', '✓ Done'].join('\n'))
    expect(checkThread(view)).toEqual([])
  })

  it('draws nothing for a start ahead of now', () => {
    expect(lines(session([settled('t1', client(NOW + 5 * MINUTE))]), UTC())[0]).toBe('> Request t1')
  })

  it('reports an empty time line as a broken view', () => {
    const view = threadView(session([settled('t1', client(NOW - HOUR))]), UTC())
    expect(checkThread({ ...view, turns: [{ ...view.turns[0]!, time: '' }] })).toEqual(['turn t1: the time line is an empty string'])
  })
})

describe('the elapsed time on the live end', () => {
  const began = client(NOW)
  const step = [tool('a', './run-tests.sh')]

  it('reads the bare words at 59 seconds and adds 1 min at 60 seconds, on a live step', () => {
    const live = (afterMs: number) => lines(running(began, step), UTC(NOW + afterMs)).at(-1)
    expect(live(59_000)).toBe('◉ Running `./run-tests.sh`')
    expect(live(60_000)).toBe('◉ Running `./run-tests.sh`, 1 min')
  })

  it('does the same on a tip', () => {
    const tip = (afterMs: number) => lines(running(began), UTC(NOW + afterMs)).at(-1)
    expect(tip(59_000)).toBe('◉ Thinking')
    expect(tip(60_000)).toBe('◉ Thinking, 1 min')
  })

  it('puts it after the count on a live group, before the meta', () => {
    const group = [{ ...tool('a', 'ls'), status: { s: 'done', durationS: 1.5, diffs: [], result: { kind: 'none' }, image: null } } as ToolItem, tool('b', './run-tests.sh')]
    expect(lines(running(began, group), UTC(NOW + 3 * MINUTE)).at(-3)).toBe('◉ Running `./run-tests.sh` · 2 steps, 3 min')
  })

  it('keeps it out of the words and off a prompt that waits for the user', () => {
    const view = threadView(running(began), UTC(NOW + 5 * MINUTE))
    expect(view.turns[0]!.end).toEqual({ kind: 'tip', words: [{ t: 'text', v: 'Thinking' }], elapsed: '5 min' })
    const asking: Item = { kind: 'prompt', id: 'p1' as never, generation: 1 as Generation, ask: { kind: 'approval', command: 'rm x', reason: null, choices: ['once'] }, state: { s: 'waiting', error: null }, deadline: null }
    expect(threadView(running(began, [asking]), UTC(NOW + 5 * MINUTE)).turns[0]!.end).toEqual({ kind: 'at', nodeKey: 't9/0', tone: 'asking' })
  })

  it('is absent when the link is not live', () => {
    expect(threadView(running(began, [], [], { state: 'offline' }), UTC(NOW + 5 * MINUTE)).turns[0]!.end.kind).toBe('paused')
  })

  it('reads hours and minutes after the first hour', () => {
    const tip = (afterMs: number) => lines(running(began), UTC(NOW + afterMs)).at(-1)
    expect(tip(59 * MINUTE + 59_000)).toBe('◉ Thinking, 59 min')
    expect(tip(HOUR)).toBe('◉ Thinking, 1 h')
    expect(tip(HOUR + 5 * MINUTE + 30_000)).toBe('◉ Thinking, 1 h 5 min')
    expect(tip(26 * HOUR + 3 * MINUTE)).toBe('◉ Thinking, 26 h 3 min')
  })

  it('is absent when the start is unknown, and counts a start ahead of now as zero', () => {
    expect(lines(running(null), UTC(NOW + HOUR)).at(-1)).toBe('◉ Thinking')
    expect(lines(running(client(NOW + 5 * MINUTE)), UTC()).at(-1)).toBe('◉ Thinking')
  })
})

describe('changesAt', () => {
  it('is the next whole minute of the live turn', () => {
    expect(threadView(running(client(NOW - 20_000)), UTC()).changesAt).toBe(NOW + 40_000)
    expect(threadView(running(client(NOW - 20_000)), UTC(NOW + 40_000)).changesAt).toBe(NOW + 100_000)
    expect(threadView(running(client(NOW + 5 * MINUTE)), UTC()).changesAt).toBe(NOW + 6 * MINUTE)
  })

  it('is the 15-minute mark of the first timed turn while it has no line', () => {
    const view = threadView(session([settled('t1', null), settled('t2', client(NOW - 5 * MINUTE))]), UTC())
    expect(view.changesAt).toBe(NOW + 10 * MINUTE)
  })

  it('is the next midnight in the zone while a time line shows', () => {
    const history = [settled('t1', client(NOW - 2 * HOUR))]
    expect(threadView(session(history), UTC()).changesAt).toBe(at('2026-11-22T00:00:00Z'))
    expect(threadView(session(history), { now: NOW, timeZone: 'Asia/Tokyo' }).changesAt).toBe(at('2026-11-22T15:00:00Z'))
  })

  it('moves on to the following midnight once the clock reaches one', () => {
    const history = [settled('t1', client(NOW - 2 * HOUR))]
    const kolkata = (now: number): ViewClock => ({ now, timeZone: 'Asia/Kolkata' })
    const midnight = at('2026-11-21T18:30:00Z')
    expect(threadView(session(history), kolkata(midnight - MINUTE)).changesAt).toBe(midnight)
    expect(threadView(session(history), kolkata(midnight)).changesAt).toBe(midnight + 24 * HOUR)
    expect(threadView(session(history), kolkata(midnight - 1)).changesAt).toBe(midnight)
  })

  it('finds midnight on a day that is 25 hours long', () => {
    const history = [settled('t1', client(at('2026-10-30T12:00:00Z')))]
    const view = threadView(session(history), { now: at('2026-11-01T04:30:00Z'), timeZone: 'America/New_York' })
    expect(view.changesAt).toBe(at('2026-11-02T05:00:00Z'))
  })

  it('is the earliest of them', () => {
    const view = threadView(running(client(NOW - 30_000), [], [settled('t1', client(NOW - 2 * HOUR))]), UTC())
    expect(view.changesAt).toBe(NOW + 30_000)
  })

  it('is null when nothing on screen can change', () => {
    expect(threadView(session([settled('t1', null)]), UTC()).changesAt).toBeNull()
    expect(threadView(session([]), UTC()).changesAt).toBeNull()
    expect(threadView(running(null), UTC()).changesAt).toBeNull()
  })
})

describe('the identity of a settled TurnView across a tick', () => {
  const history = [settled('t1', client(NOW - 2 * HOUR)), settled('t2', client(NOW - 100 * MINUTE)), settled('t3', client(NOW - 99 * MINUTE))]

  it('is kept when the tick changes nothing visible', () => {
    const before = threadView(session(history), UTC())
    const after = threadView(session(history), UTC(NOW + 5 * MINUTE))
    expect(after.turns).toHaveLength(3)
    after.turns.forEach((turn, index) => expect(turn).toBe(before.turns[index]))
  })

  it('changes only the turn whose line changed, and shares the rest of it', () => {
    const before = threadView(session(history), UTC())
    const after = threadView(session(history), UTC(at('2026-11-22T00:01:00Z')))
    expect(after.turns[0]!.time).toBe('Yesterday 13:00')
    expect(after.turns[0]).not.toBe(before.turns[0])
    expect(after.turns[0]!.nodes).toBe(before.turns[0]!.nodes)
    expect(after.turns[0]!.end).toBe(before.turns[0]!.end)
    expect(after.turns[2]).toBe(before.turns[2])
  })

  it('shows the line when the first timed turn reaches 15 minutes, without rebuilding its nodes', () => {
    const young = [settled('t1', client(NOW - 14 * MINUTE))]
    const before = threadView(session(young), UTC())
    const after = threadView(session(young), UTC(NOW + MINUTE))
    expect(before.turns[0]!.time).toBeNull()
    expect(after.turns[0]!.time).toBe('Today 14:46')
    expect(after.turns[0]!.nodes).toBe(before.turns[0]!.nodes)
  })
})
