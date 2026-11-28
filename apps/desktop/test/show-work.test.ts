import type { ThreadEnd, ThreadNode, ThreadView, TurnView } from '@highwing/thread'
import { describe, expect, it } from 'vitest'
import type { ShowWork } from '../src/ipc-contract'
import { shownWork } from '../src/renderer/chat/show-work'

const KINDS = ['prompt', 'notice', 'closed', 'status', 'steer', 'step', 'group', 'helper', 'plan', 'moa', 'reasoning', 'prose'] as const satisfies readonly ThreadNode['kind'][]
const node = (kind: ThreadNode['kind']) => ({ kind, key: `n-${kind}` }) as unknown as ThreadNode
const DONE: ThreadEnd = { kind: 'done', words: 'Done' }
const turn = (key: string, kinds: readonly ThreadNode['kind'][], end: ThreadEnd = DONE): TurnView =>
  ({ key, time: null, request: 'Hello', handed: false, attachments: [], rowId: 1, tokens: null, reactions: null, pages: [], nodes: kinds.map(node), end })
const view = (...turns: TurnView[]): ThreadView => ({ state: 'ready', turns, pending: [], asks: [], earlier: 'none', changesAt: null })
const kindsOf = (shown: ThreadView) => shown.turns.flatMap(({ nodes }) => nodes.map(({ kind }) => kind))
const live = (nodeKey: string): ThreadEnd => ({ kind: 'at', nodeKey, tone: 'live', elapsed: '3 min' })
const said = (markdown: string) => ({ kind: 'prose', key: markdown, markdown, streaming: false }) as ThreadNode
const story = (end: ThreadEnd): TurnView => ({
  ...turn('t1', []),
  nodes: [said('I will read the file.'), node('step'), said('Read it, now the edit.'), node('reasoning'), node('group'), node('prompt'), said('Done, the file is fixed.'), node('notice')],
  end
})
const shownSaid = (shown: ThreadView) => shown.turns.flatMap(({ nodes }) => nodes.flatMap(n => (n.kind === 'prose' ? [n.markdown] : [])))

describe('shownWork', () => {
  it.each([
    ['replies', ['prompt', 'notice', 'closed', 'status', 'steer', 'prose']],
    ['actions', ['prompt', 'notice', 'closed', 'status', 'steer', 'step', 'group', 'helper', 'plan', 'moa', 'prose']],
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

  it.each([DONE, { kind: 'stopped', words: 'Stopped' }, { kind: 'failed', words: 'It broke', remedy: null }] as const)('under replies keeps only the prose after the last hidden row of a turn that ends %j', end => {
    const shown = shownWork(view(story(end)), 'replies')
    expect(shownSaid(shown)).toEqual(['Done, the file is fixed.'])
    expect(kindsOf(shown)).toEqual(['prompt', 'prose', 'notice'])
  })

  it.each([live('n-step'), { kind: 'tip', words: [{ t: 'text', v: 'Writing' }], elapsed: null }, { kind: 'at', nodeKey: 'n-prompt', tone: 'asking' }, { kind: 'paused', words: 'Reconnecting' }] as const)('under replies draws no prose while a turn ends %j', end => {
    const shown = shownWork(view(story(end)), 'replies')
    expect(kindsOf(shown)).toEqual(['prompt', 'notice'])
  })

  it('under actions keeps the prose between the steps', () => {
    expect(shownSaid(shownWork(view(story(live('n-step'))), 'actions'))).toEqual(['I will read the file.', 'Read it, now the edit.', 'Done, the file is fixed.'])
  })

  it('gives back the same turns when asked twice about the same turns', () => {
    const settled = turn('t1', ['reasoning', 'step', 'prose'])
    const first = shownWork(view(settled, turn('t2', ['reasoning'])), 'replies')
    const second = shownWork(view(settled, turn('t2', ['reasoning', 'prose'])), 'replies')
    expect(second.turns[0]).toBe(first.turns[0])
    expect(second.turns[1]).not.toBe(first.turns[1])
  })
})
