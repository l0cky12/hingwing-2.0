import type { SideId } from '@highwing/hermes/domain'
import type { ThreadView, TurnView } from '@highwing/thread'
import { describe, expect, it } from 'vitest'
import { FOLLOWING, jumpWords, placeAfter, progressOf } from '../src/renderer/chat/place'
import type { SideRow } from '../src/renderer/chat/sides'

const turn = (key: string, nodes: number, end: TurnView['end']['kind'] = 'done') =>
  ({ key, request: null, nodes: Array.from({ length: nodes }, (_, index) => ({ kind: 'notice', key: `n${index}`, tone: 'info', text: '' })), end: { kind: end, words: '' } }) as unknown as TurnView
const NO_SIDES: readonly SideRow[] = []
const side: SideRow = { id: 'btw_1' as SideId, after: null, asked: 'why?', answer: { s: 'answered', markdown: 'Because.' } }
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
    const base = progressOf(view([turn('t', 3, 'at')]), NO_SIDES)
    expect(progressOf(view([turn('t', 4, 'at')]), NO_SIDES)).not.toBe(base)
    expect(progressOf(view([turn('t', 3, 'done')]), NO_SIDES)).not.toBe(base)
    expect(progressOf(view([turn('t', 3, 'at')], 1), NO_SIDES)).not.toBe(base)
  })
  it('changes when an answered side question is drawn, wherever it sits', () => {
    expect(progressOf(view([turn('t', 3)]), [side])).not.toBe(progressOf(view([turn('t', 3)]), NO_SIDES))
  })
  it('changes when a group in the last turn gains a step', () => {
    const grouped = (count: number) => ({ ...turn('t', 0, 'at'), nodes: [{ kind: 'group', key: 'g', count, steps: [] }] }) as unknown as TurnView
    expect(progressOf(view([grouped(3)]), NO_SIDES)).not.toBe(progressOf(view([grouped(2)]), NO_SIDES))
  })
  it('ignores earlier turns being prepended and rebuilt views', () => {
    const base = progressOf(view([turn('t', 3)]), NO_SIDES)
    expect(progressOf(view([turn('old', 9), turn('t', 3)]), NO_SIDES)).toBe(base)
    expect(progressOf(view([turn('t', 3)]), NO_SIDES)).toBe(base)
  })
})

describe('jumpWords', () => {
  const reading = placeAfter(FOLLOWING, 200, 'a')
  it('says nothing while following', () => {
    expect(jumpWords(FOLLOWING, 'answering', 'b')).toBe('')
  })
  it('waits for your OK on a prompt, and for your answer on a request Hermes waits on, before new steps', () => {
    expect(jumpWords(reading, 'asking', 'b')).toBe('Waiting for your OK')
    expect(jumpWords(reading, 'answering', 'b')).toBe('Waiting for your answer')
    expect(jumpWords(reading, 'working', 'b')).toBe('New steps below')
    expect(jumpWords(reading, null, 'a')).toBe('')
  })
})
