import { describe, expect, it } from 'vitest'
import { sessionOf } from '../../hermes/src/domain/reduce'
import type { Link } from '../../hermes/src/domain/session'
import { delegate, errand, fold, type Moment } from '../../hermes/test/support/story'
import { fieldId, findInThread, leafText, outline, parseMarkdown, proseLeaves, threadView, type Beside, type StepView, type ThreadView } from '../src/thread-view'

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
    const failed: ThreadView = { ...view, turns: [{ ...turn, end: { kind: 'failed', words: 'HTTP 401 from provider', remedy: null } }] }
    expect(findInThread(failed, 'http 401')).toEqual([{ field: fieldId(turn.key, 'end'), start: 0, end: 8, opens: [] }])
  })

  it('finds the error on an approval card', () => {
    const card = { kind: 'prompt', key: 'run:1/9', card: {
      state: 'asking', promptId: 'p1', heading: 'Run this command?', command: 'rm -rf scratch', why: null,
      pick: { kind: 'one', buttons: [], freeText: false }, busy: false, error: 'Approval receipt timed out'
    } } as const
    const asking = { ...view, turns: [{ ...turn, nodes: [...turn.nodes, card] }] } as ThreadView
    expect(findInThread(asking, 'timed out').map(match => match.field)).toEqual([fieldId('run:1/9', 'error')])
  })

  it('finds words the user steered into the turn', () => {
    const steered = { ...view, turns: [{ ...turn, nodes: [...turn.nodes, { kind: 'steer', key: 'run:1/8', text: 'Use ISO dates.' } as const] }] }
    expect(findInThread(steered, 'iso dates')).toEqual([{ field: fieldId('run:1/8', 'text'), start: 4, end: 13, opens: [] }])
  })

  it('does not search the Done words, which only screen readers hear', () => {
    expect(findInThread(view, 'done').every(match => match.field !== fieldId(turn.key, 'end'))).toBe(true)
  })
})

describe('rows drawn beside the turns', () => {
  const [turn] = view.turns
  if (turn === undefined) throw new Error('the errand has no turn')
  const bare = (key: string, request: string) => ({ ...turn, key, request, nodes: [] })
  const ask = { kind: 'secret', key: 'ask:1', requestId: 'r1', heading: 'A zebra key?', waits: null, busy: null, error: null, command: null, why: null, name: null, fields: [], send: 'Send', skip: 'Skip' }
  const drawn = { ...view, turns: [bare('t1', 'First zebra'), bare('t2', 'Second zebra')], asks: [ask] } as unknown as ThreadView
  const beside: Beside = {
    first: [{ key: 'relay-a', asked: 'Ask @Rae about the zebra', reply: null }],
    after: new Map([['t1', [
      { key: 'relay-b', asked: 'Zebra again', reply: { kind: 'markdown', markdown: 'One **zebra**.\n\nTwo zebra.' } },
      { key: 'side:s1', asked: null, reply: { kind: 'error', words: 'No zebra here' } }
    ]]]),
    last: [{ key: 'side:s2', asked: 'Why zebra?', reply: { kind: 'markdown', markdown: 'Because zebra.' } }]
  }

  it('finds their questions, replies and errors where they are drawn: before, between and after the turns, and before the asks', () => {
    expect(findInThread(drawn, 'zebra', undefined, beside).map(match => match.field)).toEqual([
      fieldId('relay-a', 'request'),
      fieldId('t1', 'request'),
      fieldId('relay-b', 'request'),
      fieldId('relay-b', 'block 0'),
      fieldId('relay-b', 'block 1'),
      fieldId('side:s1', 'error'),
      fieldId('t2', 'request'),
      fieldId('side:s2', 'request'),
      fieldId('side:s2', 'block 0'),
      fieldId('ask:1', 'heading')
    ])
  })

  it('counts a reply in the words a reader sees, without its markdown', () => {
    expect(findInThread(drawn, 'one zebra.', undefined, beside)).toEqual([{ field: fieldId('relay-b', 'block 0'), start: 0, end: 10, opens: [] }])
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

describe('finding text in the delegating errand', () => {
  const moments: Moment[] = []
  fold(delegate(), moment => moments.push(moment))
  const settled = threadView(sessionOf(fold(delegate()), ONLINE, null), CLOCK)
  const [first] = settled.turns
  const node = (kind: string) => first?.nodes.find(candidate => candidate.kind === kind)
  const helper = node('helper')
  const reasoning = node('reasoning')
  if (helper?.kind !== 'helper' || reasoning === undefined) throw new Error('the delegating errand lost its helper or its reasoning')

  it('finds words inside a closed reasoning block and opens it', () => {
    expect(findInThread(settled, 'Batch: tool_describe')).toEqual([expect.objectContaining({ field: fieldId(reasoning.key, 'text'), opens: [reasoning.key] })])
  })

  it('finds the helper by its goal, and its steps and summary by opening it', () => {
    expect(findInThread(settled, 'In the folder').map(match => match.field)).toContain(fieldId(helper.key, 'title'))
    const [step] = helper.helper.steps
    expect(findInThread(settled, '+ 1 command')).toEqual([expect.objectContaining({ field: fieldId(step!.key, 'title'), opens: [helper.key] })])
    expect(findInThread(settled, 'Disk is not the cause')).toEqual([expect.objectContaining({ field: fieldId(helper.key, 'detail'), opens: [helper.key] })])
  })

  it('opens the plan for an entry, settled or running, so a plan the reader closed opens too', () => {
    const plans = settled.turns.flatMap(turn => turn.nodes.filter(candidate => candidate.kind === 'plan'))
    expect(findInThread(settled, 'Correlate findings').map(match => match.opens)).toEqual(plans.map(candidate => [candidate.key]))
    const running = moments
      .map(({ state }) => threadView(sessionOf(state, ONLINE, null), CLOCK))
      .find(view => view.turns.length === 1 && view.turns[0]?.nodes.some(candidate => candidate.kind === 'plan'))
    const plan = running?.turns[0]?.nodes.find(candidate => candidate.kind === 'plan')
    if (running === undefined || plan === undefined) throw new Error('the first turn never ran with its plan')
    expect(findInThread(running, 'Correlate findings').map(match => match.opens)).toEqual([[plan.key]])
  })
})
