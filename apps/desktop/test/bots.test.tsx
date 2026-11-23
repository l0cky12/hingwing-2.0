import { BOT_TONES, type Bots } from '@highwing/hermes/domain'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BotsPanel } from '../src/renderer/bots/Bots'
import { APPROVED, fact, listed } from './support/bots'

const render = (bots: Bots | undefined) => renderToStaticMarkup(<BotsPanel bots={bots} />)
const attr = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1]
const buttons = (markup: string) => markup.match(/<button[^>]*>/g) ?? []
const named = (markup: string, label: string) => buttons(markup).find(tag => attr(tag, 'aria-label') === label)
const idsIn = (markup: string) => Array.from(markup.matchAll(/ id="([^"]*)"/g), ([, id]) => id)

describe('the bots sidebar', () => {
  const markup = render(APPROVED)

  it('is one landmark named Bots, with nothing the chat column looks for by name', () => {
    expect(markup.match(/<aside[^>]*>/g)).toHaveLength(1)
    expect(attr(markup.match(/<aside[^>]*>/)![0], 'aria-label')).toBe('Bots')
    expect(markup).not.toMatch(/<footer|id="scroll"/)
  })

  it('names each row by its bot, and the default bot as the default bot', () => {
    expect(buttons(markup).map(tag => attr(tag, 'aria-label'))).toEqual([
      'Search bots', 'New bot', 'Hermes Agent, default bot', 'Researcher', 'Reviewer', 'Ops', 'Scribe'
    ])
    expect(markup).toMatch(/<h3>Work<\/h3>.*<h3>Unassigned<\/h3>/s)
  })

  it('marks the default bot as the current one at launch, and no other', () => {
    expect(buttons(markup).filter(tag => attr(tag, 'aria-current') !== undefined).map(tag => attr(tag, 'aria-label'))).toEqual(['Hermes Agent, default bot'])
  })

  it('describes each row by its preview, or by having no messages', () => {
    const scribe = attr(named(markup, 'Scribe')!, 'aria-describedby')
    expect(markup).toContain(`id="${scribe}">No messages yet<`)
    const ops = attr(named(markup, 'Ops')!, 'aria-describedby')
    expect(markup).toContain(`id="${ops}">Pruned four worktrees.<`)
  })

  it('shows New bot as unavailable, still reachable, and says why', () => {
    const tag = named(markup, 'New bot')!
    expect(attr(tag, 'aria-disabled')).toBe('true')
    expect(tag).not.toMatch(/ disabled/)
    expect(markup).toContain(`id="${attr(tag, 'aria-describedby')}">Highwing can&#x27;t create bots yet<`)
  })

  it('gives a bot whose profile name holds a space one id to be described by', () => {
    const spaced = render(listed(fact('night shift', 'Night shift', { preview: 'Two alerts overnight.' }), fact('night', 'Night')))
    const described = attr(named(spaced, 'Night shift')!, 'aria-describedby')!
    expect(described).not.toMatch(/\s/)
    expect(spaced).toContain(`id="${described}">Two alerts overnight.<`)
    expect(new Set(idsIn(spaced)).size, 'every id is used once').toBe(idsIn(spaced).length)
  })

  it('is busy with an empty list while loading, and says why when there is no roster', () => {
    for (const bots of [undefined, { state: 'loading' } as const]) {
      expect(render(bots)).toMatch(/<div class="bots-list" aria-busy="true"><\/div>/)
    }
    expect(render({ state: 'unsupported' })).toMatch(/<div class="bots-list"><p[^>]* role="status">This Hermes can&#x27;t list its bots\.<\/p><\/div>/)
  })

  it('has a paint for every tone a bot can carry', () => {
    const css = readFileSync('apps/desktop/src/renderer/styles/app.css', 'utf8')
    for (const tone of ['ink', ...BOT_TONES]) expect(css, tone).toMatch(new RegExp(`\\.tone-${tone} \\{ background: var\\(--`))
  })
})
