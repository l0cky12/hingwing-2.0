import type { SideId, SideTask } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Sides } from '../src/renderer/chat/Sides'
import { sideCards } from '../src/renderer/chat/sides'

const side = (id: string, state: SideTask['state'], more: Partial<SideTask> = {}): SideTask =>
  ({ id: id as SideId, kind: 'btw', asked: `question ${id}`, state, ...more })
const NONE: ReadonlySet<SideId> = new Set()

describe('sideCards', () => {
  it('waits on a running question, shows an answer, and says when it was missed', () => {
    const cards = sideCards([side('a', { s: 'running' }), side('b', { s: 'done', text: 'It turns on **dry-run**.', after: null }), side('c', { s: 'lost' })], NONE)
    expect(cards.map(card => card.answer)).toEqual([{ s: 'waiting' }, { s: 'answered', markdown: 'It turns on **dry-run**.' }, { s: 'lost' }])
  })

  it('reads Hermes\'s error words as a failure, with the words after them', () => {
    expect(sideCards([side('a', { s: 'done', text: 'error:  the model refused the request', after: null })], NONE)[0]!.answer)
      .toEqual({ s: 'failed', message: 'the model refused the request' })
  })

  it('labels a side question and a background prompt apart, and keeps a question asked elsewhere unnamed', () => {
    const cards = sideCards([side('a', { s: 'running' }), side('b', { s: 'running' }, { kind: 'background', asked: null })], NONE)
    expect(cards.map(card => [card.label, card.asked])).toEqual([['Side question', 'question a'], ['Background prompt', null]])
  })

  it('leaves out closed cards and keeps the rest in the order asked', () => {
    const cards = sideCards([side('a', { s: 'running' }), side('b', { s: 'running' }), side('c', { s: 'running' })], new Set(['b' as SideId]))
    expect(cards.map(card => card.id)).toEqual(['a', 'c'])
  })
})

describe('Sides', () => {
  const markup = (sides: readonly SideTask[]) => renderToStaticMarkup(<Sides cards={sideCards(sides, NONE)} onClose={() => {}} />)

  it('draws each card as a region named by its label, with a close button and the quiet note', () => {
    const html = markup([side('a', { s: 'done', text: 'It turns on **dry-run** mode.', after: null })])
    const [, labelId] = /<section[^>]*aria-labelledby="([^"]+)"/.exec(html) ?? []
    expect(html).toContain(`<h2 id="${labelId}">Side question</h2>`)
    expect(html).toContain('aria-label="Close side question"')
    expect(html).toContain('question a')
    expect(html).toContain('<strong>dry-run</strong>')
    expect(html).toContain('Not part of the chat.')
  })

  it('marks a waiting card busy and says it is waiting', () => {
    const html = markup([side('a', { s: 'running' })])
    expect(html).toMatch(/<section[^>]*aria-busy="true"/)
    expect(html).toContain('Waiting for the answer')
  })

  it('shows a failure as an error, with the question kept', () => {
    const html = markup([side('a', { s: 'done', text: 'error: no model', after: null })])
    expect(html).toContain('<p class="err">no model</p>')
    expect(html).toContain('question a')
  })
})
