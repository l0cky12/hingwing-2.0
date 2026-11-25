import type { HelperId, Item, Session, SettledTurn, TurnId } from '@highwing/hermes/domain'
import { threadView } from '@highwing/thread'
import { describe, expect, it } from 'vitest'
import { drawnView } from '../src/renderer/chat/drawn'

const CLOCK = { now: 0, timeZone: 'UTC' }

const turn = (id: string, items: readonly Item<'settled'>[], request: string | null = 'Do it'): SettledTurn => ({
  id: id as TurnId, request: request === null ? null : { text: request, inputId: null, rowId: null, attachments: [] }, began: null, items,
  outcome: request === null ? { kind: 'interlude' } : { kind: 'complete' }, rows: [], tokens: null
})

const session = (history: readonly SettledTurn[]): Session => ({
  id: 's1' as Session['id'], title: '', cwd: null, history, earlier: 'none', run: { state: 'idle' }, interlude: [], requests: [], queue: [], outbox: [],
  model: { current: null, next: null, ask: null }, usage: { totals: null, context: null }, tuning: { reasoning: null, busy: null, effort: null, fast: null, yolo: null }, sync: { state: 'live' }
})

const goal: Item<'settled'> = { kind: 'status', what: 'line', about: 'goal', text: 'Goal met.' }

describe('the view the window draws', () => {
  it('keeps reasoning, helpers and plans, and leaves out only the MoA rounds and status lines nothing draws yet', () => {
    const items: Item<'settled'>[] = [
      { kind: 'moa', progress: null, references: [], phase: { is: 'advising' } },
      { kind: 'reasoning', text: 'Look first.', sealed: true, startedAt: null, endedAt: null },
      goal,
      { kind: 'helper', id: 'sa-1' as HelperId, parentId: null, depth: 0, goal: 'Check', state: { s: 'queued' }, toolCount: null, steps: [] },
      { kind: 'plan', revision: 1, entries: [{ id: '1', text: 'Read', status: 'pending', parentId: null }] },
      { kind: 'text', markdown: 'Done.', sealed: true }
    ]
    const [drawn] = drawnView(threadView(session([turn('t1', items)]), CLOCK)).turns
    expect(drawn?.nodes.map(node => node.kind)).toEqual(['reasoning', 'helper', 'plan', 'prose'])
  })

  it('drops an interlude that holds only lines nothing draws, and keeps the view whole when nothing is left out', () => {
    expect(drawnView(threadView(session([turn('t1', [goal]), turn('i2', [goal], null)]), CLOCK)).turns.map(drawn => drawn.key)).toEqual(['t1'])
    const plain = threadView(session([turn('t1', [{ kind: 'reasoning', text: 'Hmm', sealed: true, startedAt: null, endedAt: null }])]), CLOCK)
    expect(drawnView(plain)).toBe(plain)
  })
})
