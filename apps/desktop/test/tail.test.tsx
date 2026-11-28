import type { BotId, Relay, RelayId, SideId, TurnId } from '@highwing/hermes/domain'
import type { ThreadView, TurnView } from '@highwing/thread'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SideRow } from '../src/renderer/chat/sides'
import { drawnOf, TAIL, useTail, type Drawn } from '../src/renderer/chat/tail'
import { Thread } from '../src/renderer/chat/Thread'

const turn = (row: number, end: TurnView['end'] = { kind: 'done', words: 'Done' }): TurnView =>
  ({ key: `t${row}`, time: null, request: `Request ${row}`, handed: false, attachments: [], rowId: row, tokens: null, reactions: null, pages: [], nodes: [], end })
const chat = (count: number, more: Partial<ThreadView> = {}): ThreadView =>
  ({ state: 'ready', turns: Array.from({ length: count }, (_, index) => turn(index + 1)), pending: [], asks: [], earlier: 'none', changesAt: null, ...more })
const relay = (id: string, after: string | null): Relay =>
  ({ id: id as RelayId, to: 'rae' as BotId, name: 'Rae', tone: 'umber', text: `Relay ${id}`, after: after as TurnId | null, state: { s: 'waiting' } })
const side = (id: string, after: string | null): SideRow =>
  ({ id: id as SideId, after: after as TurnId | null, asked: `Question ${id}`, answer: { s: 'answered', markdown: `Answer ${id}` } })
const NO_RELAYS: readonly Relay[] = []
const NO_SIDES: readonly SideRow[] = []

const thread = ({ view, relays, sides }: Drawn) => (
  <Thread
    view={view} relays={relays} sides={sides} onAnswer={async () => undefined} onAskAgain={async () => false} onAnswerRequest={async () => false} onLoadEarlier={() => {}} onFindClosed={() => {}} onFindScrolled={() => {}}
    canEdit canRegenerate={false} regenerateTurnKey={null} canBranch onEdit={() => {}} onRegenerate={() => {}} onBranch={() => {}} onNewChat={() => {}}
    versions={[]} onVersion={() => {}} queue={{ canAct: true, pressed: new Map(), onAct: () => {} }} canReact onReact={() => {}} helpers={null} showWork="all"
  />
)
function Opened({ view, relays = NO_RELAYS }: { readonly view: ThreadView; readonly relays?: readonly Relay[] }) {
  const drawn = useTail(view, relays, NO_SIDES)
  return drawn === null ? null : thread(drawn)
}
const rowsIn = (markup: string) => [...markup.matchAll(/data-row="(\d+)"/g)].map(([, row]) => Number(row))
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index)

describe('a chat as it opens', () => {
  it('draws only its newest turns in the first commit when it is long, and every turn once the rest is drawn', () => {
    const long = chat(160, { earlier: 'more' })
    const first = renderToStaticMarkup(<Opened view={long} />)
    expect(rowsIn(first)).toEqual(range(161 - TAIL, 160))
    expect(first, 'the top of the tail is not the top of the chat').not.toContain('Show earlier turns')
    const after = renderToStaticMarkup(thread(drawnOf(long, NO_RELAYS, NO_SIDES, true)))
    expect(rowsIn(after)).toEqual(range(1, 160))
    expect(after).toContain('Show earlier turns')
  })

  it('draws a short chat whole in its first commit', () => {
    const short = chat(TAIL)
    expect(drawnOf(short, NO_RELAYS, NO_SIDES, false)).toEqual({ view: short, relays: NO_RELAYS, sides: NO_SIDES, whole: true })
    expect(rowsIn(renderToStaticMarkup(<Opened view={short} />))).toEqual(range(1, TAIL))
  })

  it('keeps the running turn in the tail, with its live end', () => {
    const running = chat(100)
    const live = { ...running, turns: [...running.turns.slice(0, -1), turn(100, { kind: 'tip', words: [{ t: 'text', v: 'Working' }], elapsed: '3s' })] }
    expect(renderToStaticMarkup(<Opened view={live} />)).toContain('data-end="tip"')
  })

  it('shows a handed message and an answered side question only beside a drawn turn, or at the end when its turn is gone, and all of them once whole', () => {
    const relays = [relay('first', null), relay('early', 't3'), relay('late', 't150'), relay('gone', 't999')]
    const sides = [side('first', null), side('early', 't3'), side('late', 't150'), side('gone', 't999')]
    const tail = drawnOf(chat(160), relays, sides, false)
    expect(tail.relays.map(each => each.id)).toEqual(['late', 'gone'])
    expect(tail.sides.map(each => each.id)).toEqual(['late', 'gone'])
    const whole = drawnOf(chat(160), relays, sides, true)
    expect([whole.relays, whole.sides]).toEqual([relays, sides])
  })

  it('stays whole for a chat that grows after it opened, as when a new event arrives while the user reads above', () => {
    const grown = chat(170)
    expect(drawnOf(grown, NO_RELAYS, NO_SIDES, true).view).toBe(grown)
  })

  it('holds an early row only once it is whole, so a landing waits for it instead of giving up', () => {
    const long = chat(160)
    const tail = drawnOf(long, NO_RELAYS, NO_SIDES, false)
    expect([tail.whole, renderToStaticMarkup(thread(tail)).includes('data-row="2"')]).toEqual([false, false])
    const whole = drawnOf(long, NO_RELAYS, NO_SIDES, true)
    expect([whole.whole, renderToStaticMarkup(thread(whole)).includes('data-row="2"')]).toEqual([true, true])
  })
})

describe('what sits beside the turns', () => {
  it('draws the handed messages, then the answered side questions, before the first turn, after the turn each names, and after the last', () => {
    const relays = [relay('r-gone', 't9'), relay('r2', 't2'), relay('r-first', null), relay('r1', 't1')]
    const sides = [side('s1', 't1'), side('s-first', null), side('s-gone', 't9'), side('s2', 't2'), side('s1b', 't1')]
    const markup = renderToStaticMarkup(thread(drawnOf(chat(2), relays, sides, true)))
    const order = [...markup.matchAll(/data-row="(\d+)"|Relay ([\w-]+)|Answer ([\w-]+)/g)].map(([, row, relayed, answered]) => row ?? relayed ?? answered)
    expect(order).toEqual(['r-first', 's-first', '1', 'r1', 's1', 's1b', '2', 'r2', 's2', 'r-gone', 's-gone'])
  })
})
