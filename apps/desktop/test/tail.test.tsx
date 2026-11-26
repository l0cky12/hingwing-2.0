import type { BotId, Relay, RelayId, TurnId } from '@highwing/hermes/domain'
import type { ThreadView, TurnView } from '@highwing/thread'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { drawnOf, TAIL, useTail, type Drawn } from '../src/renderer/chat/tail'
import { Thread } from '../src/renderer/chat/Thread'

const turn = (row: number, end: TurnView['end'] = { kind: 'done', words: 'Done' }): TurnView =>
  ({ key: `t${row}`, time: null, request: `Request ${row}`, attachments: [], rowId: row, tokens: null, reactions: null, nodes: [], end })
const chat = (count: number, more: Partial<ThreadView> = {}): ThreadView =>
  ({ state: 'ready', turns: Array.from({ length: count }, (_, index) => turn(index + 1)), pending: [], asks: [], earlier: 'none', changesAt: null, ...more })
const relay = (id: string, after: string | null): Relay =>
  ({ id: id as RelayId, to: 'rae' as BotId, name: 'Rae', tone: 'umber', text: `Relay ${id}`, after: after as TurnId | null, state: { s: 'waiting' } })
const NO_RELAYS: readonly Relay[] = []

const thread = ({ view, relays }: Drawn) => (
  <Thread
    view={view} relays={relays} onAnswer={async () => undefined} onAnswerRequest={async () => false} onLoadEarlier={() => {}} onFindClosed={() => {}} onFindScrolled={() => {}}
    canEdit canRegenerate={false} regenerateTurnKey={null} canBranch onEdit={() => {}} onRegenerate={() => {}} onBranch={() => {}} onNewChat={() => {}}
    versions={[]} onVersion={() => {}} queue={{ canAct: true, pressed: new Map(), onAct: () => {} }} canReact onReact={() => {}} helpers={null}
  />
)
function Opened({ view, relays = NO_RELAYS }: { readonly view: ThreadView; readonly relays?: readonly Relay[] }) {
  const drawn = useTail(view, relays)
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
    const after = renderToStaticMarkup(thread(drawnOf(long, NO_RELAYS, true)))
    expect(rowsIn(after)).toEqual(range(1, 160))
    expect(after).toContain('Show earlier turns')
  })

  it('draws a short chat whole in its first commit', () => {
    const short = chat(TAIL)
    expect(drawnOf(short, NO_RELAYS, false)).toEqual({ view: short, relays: NO_RELAYS, whole: true })
    expect(rowsIn(renderToStaticMarkup(<Opened view={short} />))).toEqual(range(1, TAIL))
  })

  it('keeps the running turn in the tail, with its live end', () => {
    const running = chat(100)
    const live = { ...running, turns: [...running.turns.slice(0, -1), turn(100, { kind: 'tip', words: [{ t: 'text', v: 'Working' }], elapsed: '3s' })] }
    expect(renderToStaticMarkup(<Opened view={live} />)).toContain('data-end="tip"')
  })

  it('shows a handed message only beside a drawn turn, or at the end when its turn is gone', () => {
    const relays = [relay('first', null), relay('early', 't3'), relay('late', 't150'), relay('gone', 't999')]
    const { relays: kept } = drawnOf(chat(160), relays, false)
    expect(kept.map(each => each.id)).toEqual(['late', 'gone'])
  })

  it('stays whole for a chat that grows after it opened, as when a new event arrives while the user reads above', () => {
    const grown = chat(170)
    expect(drawnOf(grown, NO_RELAYS, true).view).toBe(grown)
  })

  it('holds an early row only once it is whole, so a landing waits for it instead of giving up', () => {
    const long = chat(160)
    const tail = drawnOf(long, NO_RELAYS, false)
    expect([tail.whole, renderToStaticMarkup(thread(tail)).includes('data-row="2"')]).toEqual([false, false])
    const whole = drawnOf(long, NO_RELAYS, true)
    expect([whole.whole, renderToStaticMarkup(thread(whole)).includes('data-row="2"')]).toEqual([true, true])
  })
})
