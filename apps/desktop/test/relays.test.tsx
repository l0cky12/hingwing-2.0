import type { BotId, Relay, RelayId, RelayState, TurnId } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { placeByTurn } from '../src/renderer/chat/relays'
import { RelayTurn } from '../src/renderer/chat/Thread'

const relay = (id: string, after: string | null, state: RelayState = { s: 'waiting' }): Relay =>
  ({ id: id as RelayId, to: 'rae' as BotId, name: 'Rae', tone: 'umber', text: 'Ask @Rae for the weekly report', after: after as TurnId | null, state })

describe('placeByTurn', () => {
  const ids = (held: readonly Relay[] | undefined) => held?.map(found => found.id)

  it('puts each handed message after the turn it was sent after, in the order sent', () => {
    const placed = placeByTurn([relay('a', 't1'), relay('b', 't2'), relay('c', 't1')], ['t1', 't2'])
    expect(ids(placed.after.get('t1'))).toEqual(['a', 'c'])
    expect(ids(placed.after.get('t2'))).toEqual(['b'])
    expect([placed.first, placed.last]).toEqual([[], []])
  })

  it('puts one sent into an empty chat before the first turn, and one whose turn is gone after the last', () => {
    const placed = placeByTurn([relay('a', null), relay('b', 'gone'), relay('c', 't1')], ['t1'])
    expect(ids(placed.first)).toEqual(['a'])
    expect(ids(placed.last)).toEqual(['b'])
    expect(ids(placed.after.get('t1'))).toEqual(['c'])
  })
})

describe('a message handed to another bot, in the thread', () => {
  const render = (state: RelayState) => renderToStaticMarkup(<RelayTurn relay={relay('a', null, state)} />)

  it('shows what the user sent, then a group named for the bot with its avatar', () => {
    const markup = render({ s: 'waiting' })
    expect(markup).toMatch(/^<article class="turn relay"><p class="request">Ask @Rae for the weekly report<span class="actions"><button[^>]*aria-label="Copy request"/)
    expect(markup).toContain('<div class="relay-reply" role="group" aria-label="Rae">')
    expect(markup).toMatch(/<span class="avatar tone-umber"[^>]*aria-hidden="true">R<\/span><span>Rae<\/span>/)
  })

  it('says it is waiting for the bot until the reply comes', () => {
    expect(render({ s: 'waiting' })).toContain('<p class="notice" role="status">Waiting for Rae</p>')
  })

  it('draws the reply as Markdown, with its own Copy', () => {
    const markup = render({ s: 'answered', reply: 'Drafted. **Three** items need your eye.' })
    expect(markup).toContain('<strong>Three</strong> items need your eye.')
    expect(markup).toContain('aria-label="Copy reply"')
    expect(markup).not.toContain('Waiting for Rae')
  })

  it('says in words why no reply came', () => {
    expect(render({ s: 'failed', words: "Rae is offline, so it didn't get your message." })).toContain('<p class="err">Rae is offline, so it didn&#x27;t get your message.</p>')
  })
})
