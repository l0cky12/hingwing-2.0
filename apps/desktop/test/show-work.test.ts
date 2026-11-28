import type { ThreadEnd, ThreadNode, ThreadView, TurnView } from '@highwing/thread'
import { describe, expect, it } from 'vitest'
import type { ShowWork } from '../src/ipc-contract'
import { shownWork } from '../src/renderer/chat/show-work'

const KINDS = ['prose', 'prompt', 'notice', 'closed', 'status', 'steer', 'step', 'group', 'helper', 'plan', 'moa', 'reasoning'] as const satisfies readonly ThreadNode['kind'][]
const node = (kind: ThreadNode['kind']) => ({ kind, key: `n-${kind}` }) as unknown as ThreadNode
const DONE: ThreadEnd = { kind: 'done', words: 'Done' }
const turn = (key: string, kinds: readonly ThreadNode['kind'][], end: ThreadEnd = DONE): TurnView =>
  ({ key, time: null, request: 'Hello', handed: false, attachments: [], rowId: 1, tokens: null, reactions: null, pages: [], nodes: kinds.map(node), end })
const view = (...turns: TurnView[]): ThreadView => ({ state: 'ready', turns, pending: [], asks: [], earlier: 'none', changesAt: null })
const kindsOf = (shown: ThreadView) => shown.turns.flatMap(({ nodes }) => nodes.map(({ kind }) => kind))
const live = (nodeKey: string): ThreadEnd => ({ kind: 'at', nodeKey, tone: 'live', elapsed: '3 min' })

describe('shownWork', () => {
  it.each([
    ['replies', ['prose', 'prompt', 'notice', 'closed', 'status', 'steer']],
    ['actions', ['prose', 'prompt', 'notice', 'closed', 'status', 'steer', 'step', 'group', 'helper', 'plan', 'moa']],
    ['all', KINDS]
  ] as const)('under %s keeps only %j', (pick: ShowWork, kept) => {
    expect(kindsOf(shownWork(view(turn('t1', KINDS)), pick))).toEqual(kept)
  })

  it('returns the very view under all', () => {
    const shown = view(turn('t1', KINDS, live('n-reasoning')))
    expect(shownWork(shown, 'all')).toBe(shown)
  })

  it.each(['replies', 'actions'] as const)('turns a live end on hidden thinking into a Thinking tip with the same elapsed time under %s', pick => {
    const [shown] = shownWork(view(turn('t1', ['prose', 'reasoning'], live('n-reasoning'))), pick).turns
    expect(shown?.end).toEqual({ kind: 'tip', words: [{ t: 'text', v: 'Thinking' }], elapsed: '3 min' })
  })

  it.each(['step', 'group', 'helper'] as const)('turns a live end on a hidden %s into a Working tip', kind => {
    const [shown] = shownWork(view(turn('t1', ['prose', kind], live(`n-${kind}`))), 'replies').turns
    expect(shown?.end).toEqual({ kind: 'tip', words: [{ t: 'text', v: 'Working' }], elapsed: '3 min' })
  })

  it('keeps a live end on a step that actions shows', () => {
    const [shown] = shownWork(view(turn('t1', ['reasoning', 'step'], live('n-step'))), 'actions').turns
    expect(shown?.end).toEqual(live('n-step'))
  })

  it('keeps a live end that names no node', () => {
    const [shown] = shownWork(view(turn('t1', ['reasoning', 'prose'], live('gone'))), 'replies').turns
    expect(shown?.end).toEqual(live('gone'))
  })

  it('keeps a turn with nothing hidden, and the view when no turn has anything hidden', () => {
    const plain = view(turn('t1', ['prose', 'prompt', 'notice']), turn('t2', ['steer', 'prose']))
    expect(shownWork(plain, 'replies')).toBe(plain)
    const mixed = view(plain.turns[0]!, turn('t3', ['reasoning', 'prose']))
    expect(shownWork(mixed, 'replies').turns[0]).toBe(plain.turns[0])
  })

  it('gives back the same turns when asked twice about the same turns', () => {
    const settled = turn('t1', ['reasoning', 'step', 'prose'])
    const first = shownWork(view(settled, turn('t2', ['reasoning'])), 'replies')
    const second = shownWork(view(settled, turn('t2', ['reasoning', 'prose'])), 'replies')
    expect(second.turns[0]).toBe(first.turns[0])
    expect(second.turns[1]).not.toBe(first.turns[1])
  })
})
