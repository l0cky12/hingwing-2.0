import type { ThreadView, TurnView } from '@highwing/thread'
import { describe, expect, it } from 'vitest'
import { FOLLOWING, placeAfter, progressOf } from '../src/renderer/chat/place'

const turn = (key: string, nodes: number, end: TurnView['end']['kind'] = 'done') =>
  ({ key, request: null, nodes: Array.from({ length: nodes }, (_, index) => ({ kind: 'notice', key: `n${index}`, tone: 'info', text: '' })), end: { kind: end, words: '' } }) as unknown as TurnView
const view = (turns: TurnView[], pending = 0) =>
  ({ state: 'ready', turns, pending: Array.from({ length: pending }, (_, index) => ({ key: `p${index}`, text: '', status: 'sending', detail: null })), earlier: null }) as unknown as ThreadView

describe('placeAfter', () => {
  it('keeps the held place when nothing changed', () => {
    expect(placeAfter(FOLLOWING, 0, 'a')).toBe(FOLLOWING)
    const reading = placeAfter(FOLLOWING, 200, 'a')
    expect(placeAfter(reading, 300, 'b')).toBe(reading)
  })
  it('follows within 60px and reads from 60px', () => {
    expect(placeAfter(FOLLOWING, 59, 'a')).toBe(FOLLOWING)
    expect(placeAfter(FOLLOWING, 60, 'a')).toEqual({ kind: 'reading', since: 'a', far: false })
  })
  it('shows the control only beyond 80px and keeps the marker from when you left', () => {
    const near = placeAfter(FOLLOWING, 70, 'a')
    expect(placeAfter(near, 80, 'b')).toBe(near)
    expect(placeAfter(near, 81, 'b')).toEqual({ kind: 'reading', since: 'a', far: true })
  })
  it('returns to following at the bottom', () => {
    expect(placeAfter(placeAfter(FOLLOWING, 200, 'a'), 0, 'b')).toBe(FOLLOWING)
  })
})

describe('progressOf', () => {
  it('changes when the last turn gains a node, changes its end, or a message is pending', () => {
    const base = progressOf(view([turn('t', 3, 'at')]))
    expect(progressOf(view([turn('t', 4, 'at')]))).not.toBe(base)
    expect(progressOf(view([turn('t', 3, 'done')]))).not.toBe(base)
    expect(progressOf(view([turn('t', 3, 'at')], 1))).not.toBe(base)
  })
  it('changes when a group in the last turn gains a step', () => {
    const grouped = (count: number) => ({ ...turn('t', 0, 'at'), nodes: [{ kind: 'group', key: 'g', count, steps: [] }] }) as unknown as TurnView
    expect(progressOf(view([grouped(3)]))).not.toBe(progressOf(view([grouped(2)])))
  })
  it('ignores earlier turns being prepended and rebuilt views', () => {
    const base = progressOf(view([turn('t', 3)]))
    expect(progressOf(view([turn('old', 9), turn('t', 3)]))).toBe(base)
    expect(progressOf(view([turn('t', 3)]))).toBe(base)
  })
})
