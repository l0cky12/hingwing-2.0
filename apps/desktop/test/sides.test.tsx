import type { SideId, SideTask, TurnId } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Sides, SideTurn } from '../src/renderer/chat/Sides'
import { sortSides, type SideRow } from '../src/renderer/chat/sides'

const side = (id: string, state: SideTask['state'], more: Partial<SideTask> = {}): SideTask =>
  ({ id: id as SideId, kind: 'btw', asked: `question ${id}`, state, ...more })
const done = (text: string, after: string | null = 't1'): SideTask['state'] => ({ s: 'done', text, after: after as TurnId | null })
const RUNNING: SideTask['state'] = { s: 'running' }
const LOST: SideTask['state'] = { s: 'lost' }
const NONE: ReadonlySet<SideId> = new Set()

describe('sortSides', () => {
  it('puts an answered side question in the thread after its turn, and keeps a waiting or missed one and every background prompt as a card', () => {
    const { cards, rows } = sortSides([
      side('a', RUNNING), side('b', done('It turns on **dry-run**.')), side('c', LOST),
      side('d', RUNNING, { kind: 'background' }), side('e', done('Tidied.'), { kind: 'background' })
    ], NONE)
    expect(rows).toEqual([{ id: 'b', after: 't1', asked: 'question b', answer: { s: 'answered', markdown: 'It turns on **dry-run**.' } }])
    expect(cards.map(card => [card.id, card.label, card.answer])).toEqual([
      ['a', 'Side question', { s: 'waiting' }],
      ['c', 'Side question', { s: 'lost' }],
      ['d', 'Background prompt', { s: 'waiting' }],
      ['e', 'Background prompt', { s: 'answered', markdown: 'Tidied.' }]
    ])
  })

  it('says only a waiting side question will show in the chat', () => {
    const { cards } = sortSides([side('a', RUNNING), side('b', LOST), side('c', RUNNING, { kind: 'background' }), side('d', done('Tidied.'), { kind: 'background' })], NONE)
    expect(cards.map(card => card.note)).toEqual(['The answer will show in the chat.', 'Not part of the chat.', 'Not part of the chat.', 'Not part of the chat.'])
  })

  it("reads Hermes's error words as a failure, with the words after them, in the thread and on a card", () => {
    const { cards, rows } = sortSides([side('a', done('error:  the model refused the request')), side('b', done('error: no model'), { kind: 'background' })], NONE)
    expect(rows.map(row => row.answer)).toEqual([{ s: 'failed', message: 'the model refused the request' }])
    expect(cards.map(card => card.answer)).toEqual([{ s: 'failed', message: 'no model' }])
  })

  it('keeps a question asked in another client unnamed, and one drawn before every turn first', () => {
    const { cards, rows } = sortSides([side('a', done('main.', null), { asked: null }), side('b', RUNNING, { kind: 'background', asked: null })], NONE)
    expect(rows).toEqual([{ id: 'a', after: null, asked: null, answer: { s: 'answered', markdown: 'main.' } }])
    expect(cards.map(card => card.asked)).toEqual([null])
  })

  it('leaves out a closed side, so a card closed while waiting never enters the thread, and keeps the rest in order', () => {
    const { cards, rows } = sortSides([side('a', done('notes.md')), side('b', RUNNING), side('c', done('main.')), side('d', RUNNING)], new Set(['a', 'b'] as SideId[]))
    expect(rows.map(row => row.id)).toEqual(['c'])
    expect(cards.map(card => card.id)).toEqual(['d'])
  })
})

describe('Sides', () => {
  const markup = (sides: readonly SideTask[]) => renderToStaticMarkup(<Sides cards={sortSides(sides, NONE).cards} onClose={() => {}} returnFocus={() => {}} />)

  it('draws each card as a region named by its label, with a close button and its note', () => {
    const html = markup([side('a', RUNNING)])
    const [, labelId] = /<section[^>]*aria-labelledby="([^"]+)"/.exec(html) ?? []
    expect(html).toContain(`<h2 id="${labelId}">Side question</h2>`)
    expect(html).toContain('aria-label="Close side question"')
    expect(html).toContain('question a')
    expect(html).toContain('The answer will show in the chat.')
  })

  it('marks a waiting card busy and says it is waiting', () => {
    const html = markup([side('a', RUNNING)])
    expect(html).toMatch(/<section[^>]*aria-busy="true"/)
    expect(html).toContain('Waiting for the answer')
  })

  it("draws a background prompt's answer in Markdown on its card", () => {
    const html = markup([side('a', done('Drafted **three** lines.'), { kind: 'background' })])
    expect(html).toContain('Background prompt</h2>')
    expect(html).toContain('<strong>three</strong>')
    expect(html).toContain('Not part of the chat.')
  })
})

describe('an answered side question, in the thread', () => {
  const row = (more: Partial<SideRow> = {}): SideRow =>
    ({ id: 'btw_1' as SideId, after: 't1' as TurnId, asked: 'what does this flag do?', answer: { s: 'answered', markdown: 'It turns on **dry-run** mode.' }, ...more })
  const render = (more: Partial<SideRow> = {}) => renderToStaticMarkup(<SideTurn row={row(more)} />)

  it('is an article named by its label, with the question, the answer in Markdown with its Copy, and the quiet note', () => {
    const html = render()
    const [, labelId] = /^<article[^>]*aria-labelledby="([^"]+)"/.exec(html) ?? []
    expect(html).toContain(`<h2 id="${labelId}">Side question</h2>`)
    expect(html).toContain('<p class="side-asked">what does this flag do?</p>')
    expect(html).toContain('<strong>dry-run</strong>')
    expect(html).toContain('aria-label="Copy reply"')
    expect(html).toContain('Not saved with the chat. Later replies won&#x27;t see it.')
  })

  it('has no close button: its only button copies the answer', () => {
    expect([...render().matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map(([, name]) => name)).toEqual(['Copy reply'])
  })

  it('shows a failure in the error color, with the question kept', () => {
    const html = render({ answer: { s: 'failed', message: 'no model' } })
    expect(html).toContain('<p class="err">no model</p>')
    expect(html).toContain('what does this flag do?')
    expect(html).not.toContain('Copy reply')
  })

  it('says a question asked in another client came from another window', () => {
    expect(render({ asked: null })).toContain('<p class="side-asked">Asked in another window</p>')
  })
})
