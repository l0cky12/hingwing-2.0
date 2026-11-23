import { describe, expect, it } from 'vitest'
import { sessionOf } from '../../hermes/src/domain/reduce'
import type { Link } from '../../hermes/src/domain/session'
import { errand, fold, type Moment } from '../../hermes/test/support/story'
import { fieldId, findInThread, leafText, outline, parseMarkdown, proseLeaves, threadView, type StepView, type ThreadView } from '../src/thread-view'

const ONLINE: Link = { state: 'online' }
const CLOCK = { now: 0, timeZone: 'UTC' }
const view: ThreadView = threadView(sessionOf(fold(errand()), ONLINE, null), CLOCK)

const nodes = view.turns.flatMap(turn => turn.nodes)
const steps: readonly StepView[] = nodes.flatMap(node => (node.kind === 'step' ? [node.step] : node.kind === 'group' ? node.steps : []))
const group = nodes.find(node => node.kind === 'group')
const listing = steps.find(step => step.title.some(piece => piece.v.includes('ls -la')))
const occurrences = (text: string, word: string) => text.toLowerCase().split(word.toLowerCase()).length - 1

if (group === undefined || listing === undefined) throw new Error('the errand view lost its group or its listing step')

describe('finding text in the settled errand', () => {
  it('finds a word that only a closed step holds, and says which step to open', () => {
    expect(findInThread(view, 'old.txt')).toEqual([
      { field: fieldId(listing.key, 'body 0'), start: expect.any(Number), end: expect.any(Number), opens: [listing.key] }
    ])
  })

  it('finds every occurrence in a step output', () => {
    const matches = findInThread(view, 'drwxr')
    expect(matches).toHaveLength(3)
    expect(matches.every(match => match.field === fieldId(listing.key, 'body 0') && match.opens.length === 1 && match.opens[0] === listing.key)).toBe(true)
  })

  it('counts "notes.md" as often as the outline with every row open prints it', () => {
    const everyKey = new Set([...nodes.map(node => node.key), ...steps.map(step => step.key)])
    expect(findInThread(view, 'notes.md')).toHaveLength(occurrences(outline(view, everyKey), 'notes.md'))
  })

  it('opens the step, then its group, for a match inside a grouped diff', () => {
    const inGroup = findInThread(view, 'sketch').filter(match => match.opens.length === 2)
    expect(inGroup.length).toBeGreaterThan(0)
    for (const match of inGroup) {
      expect(match.opens[1]).toBe(group.key)
      expect(group.kind === 'group' && group.steps.map(step => step.key)).toContain(match.opens[0])
    }
  })

  it('opens nothing for text that is always shown', () => {
    const request = findInThread(view, 'make notes.md')
    expect(request).toHaveLength(1)
    expect(request[0]?.opens).toEqual([])
  })

  it('ignores case', () => {
    expect(findInThread(view, 'NOTES.MD')).toEqual(findInThread(view, 'notes.md'))
  })

  it('takes the query literally', () => {
    expect(findInThread(view, '.*')).toEqual([])
    expect(findInThread(view, '(')).toEqual([])
  })

  it('finds nothing for a missing word or an empty query', () => {
    expect(findInThread(view, 'zzzz')).toEqual([])
    expect(findInThread(view, '')).toEqual([])
  })
})

describe('words outside steps', () => {
  const [turn] = view.turns
  if (turn === undefined) throw new Error('the errand has no turn')

  it('finds the sentence a failed turn ends with', () => {
    const failed: ThreadView = { ...view, turns: [{ ...turn, end: { kind: 'failed', words: 'HTTP 401 from provider' } }] }
    expect(findInThread(failed, 'http 401')).toEqual([{ field: fieldId(turn.key, 'end'), start: 0, end: 8, opens: [] }])
  })

  it('finds the error on an approval card', () => {
    const card = { kind: 'prompt', key: 'run:1/9', card: {
      state: 'asking', promptId: 'p1', heading: 'Run this command?', command: 'rm -rf scratch', why: null,
      buttons: [], freeText: false, busy: false, error: 'Approval receipt timed out'
    } } as const
    const asking = { ...view, turns: [{ ...turn, nodes: [...turn.nodes, card] }] } as ThreadView
    expect(findInThread(asking, 'timed out').map(match => match.field)).toEqual([fieldId('run:1/9', 'error')])
  })

  it('does not search the Done words, which only screen readers hear', () => {
    expect(findInThread(view, 'done').every(match => match.field !== fieldId(turn.key, 'end'))).toBe(true)
  })
})

describe('a match while the turn runs', () => {
  it('needs the group once the next step joins its step into one', () => {
    const moments: Moment[] = []
    fold(errand(), moment => moments.push(moment))
    const opensOf = (moment: Moment) => findInThread(threadView(sessionOf(moment.state, ONLINE, null), CLOCK), 'wire the gateway')[0]?.opens ?? []
    const alone = moments.find(moment => opensOf(moment).length === 1)
    const grouped = moments.find(moment => moment.beat > (alone?.beat ?? Infinity) && opensOf(moment).length === 2)
    if (alone === undefined || grouped === undefined) throw new Error('the errand never grouped the first write')
    const group = threadView(sessionOf(grouped.state, ONLINE, null), CLOCK).turns[0]?.nodes.find(node => node.kind === 'group')
    expect(opensOf(grouped)).toEqual([opensOf(alone)[0], group?.key])
  })
})

describe('the prose a reader sees', () => {
  it('has no backticks in the closing paragraph', () => {
    const closing = nodes.findLast(node => node.kind === 'prose')
    if (closing?.kind !== 'prose') throw new Error('the errand ends without prose')
    const text = proseLeaves(parseMarkdown(closing.markdown)).map(leafText).join('\n')
    expect(text).toContain('notes.md')
    expect(text).not.toContain('`')
  })
})
