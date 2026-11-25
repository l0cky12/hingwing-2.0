import { BOT_TONES, type BotId, type Bots, type Link, type OpenChat, type SessionId } from '@highwing/hermes/domain'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BotsPanel } from '../src/renderer/bots/Bots'
import { APPROVED, fact, listed } from './support/bots'

const AT_LAUNCH: OpenChat = { shown: { kind: 'bot', bot: 'default' as BotId, sessionId: 's1' as SessionId }, opening: null, missing: null }
const ONLINE: Link = { state: 'online' }
const showing = (bots: Bots | undefined, open: OpenChat | undefined, link: Link | undefined = ONLINE) =>
  renderToStaticMarkup(
    <BotsPanel
      bots={bots} open={open} link={link} onOpen={async () => ({ ok: true, value: null })}
      onCreate={async () => ({ ok: true, value: { bot: 'rae' as BotId, warnings: [] } })} onModels={async () => ({ ok: true, value: { options: [], fallback: null } })}
      onDescribe={async bot => ({ ok: true, value: { bot, name: 'Rae', description: '', persona: '', revision: 2 } })} onEdit={async () => ({ ok: true, value: undefined })}
      onPickPicture={async () => ({ ok: true, value: 'cancelled' })} onRemovePicture={async () => ({ ok: true, value: undefined })}
    />
  )
const render = (bots: Bots | undefined) => showing(bots, AT_LAUNCH)
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

  it("names each row by its bot, and the default bot as the default bot, each followed by its details button", () => {
    expect(buttons(markup).map(tag => attr(tag, 'aria-label'))).toEqual([
      'Search bots', 'New bot', 'Emu, default bot', 'Details for Emu', 'dr eggbot', 'Details for dr eggbot', 'Research', 'Details for Research',
      'Timothy · CEO', 'Details for Timothy · CEO', 'Hermes', 'Details for Hermes', 'highwing', 'Details for highwing'
    ])
    expect(markup).toMatch(/<h3>New section<\/h3>.*<h3>Unassigned<\/h3>/s)
  })

  const marked = (html: string, name: string) => buttons(html).filter(tag => attr(tag, name) !== undefined).map(tag => attr(tag, 'aria-label'))

  it('keeps each details button beside its row, never inside it, so each is its own control', () => {
    expect(markup).not.toMatch(/<button(?:(?!<\/button>)[\s\S])*<button/)
    const details = buttons(markup).filter(tag => attr(tag, 'class') === 'bot-details')
    expect(details).toHaveLength(6)
    expect(details.every(tag => attr(tag, 'aria-haspopup') === 'dialog')).toBe(true)
  })

  it("draws a bot's letter while its picture has not loaded", () => {
    const pictured = render(listed(fact('rae', 'Rae', { picture: true })))
    expect(pictured).toMatch(/<span class="avatar tone-slate"[^>]*>R<\/span>/)
    expect(pictured).not.toContain('<img')
  })

  it('marks the bot of the open chat as the current one, and no other', () => {
    expect(marked(markup, 'aria-current')).toEqual(['Emu, default bot'])
    const research: OpenChat = { shown: { kind: 'bot', bot: 'research' as BotId, sessionId: null }, opening: null, missing: null }
    expect(marked(showing(APPROVED, research), 'aria-current')).toEqual(['Research'])
    expect(marked(showing(APPROVED, { shown: { kind: 'chat', bot: null, sessionId: 's1' as SessionId }, opening: null, missing: null }), 'aria-current')).toEqual([])
    expect(marked(showing(APPROVED, undefined), 'aria-current')).toEqual([])
  })

  it('marks the bot a click is waiting on as busy, and keeps the open chat current meanwhile', () => {
    const waiting = showing(APPROVED, { ...AT_LAUNCH, opening: { kind: 'bot', bot: 'timothy' as BotId } })
    expect(marked(waiting, 'aria-busy')).toEqual(['Timothy · CEO'])
    expect(marked(waiting, 'aria-current')).toEqual(['Emu, default bot'])
    expect(markup, 'no refusal is shown before one happens').not.toMatch(/role="alert"/)
  })

  it('describes each row by its preview, or by having no messages', () => {
    const timothy = attr(named(markup, 'Timothy · CEO')!, 'aria-describedby')
    expect(markup).toContain(`id="${timothy}">Should I start building Launch<`)
    const fresh = render(listed(fact('fresh', 'Fresh')))
    expect(fresh).toContain(`id="${attr(named(fresh, 'Fresh')!, 'aria-describedby')}">No messages yet<`)
  })

  it('offers New bot while the link is online and Hermes has listed its bots', () => {
    const tag = named(markup, 'New bot')!
    expect(tag).not.toMatch(/aria-disabled|aria-describedby/)
    expect(attr(tag, 'aria-haspopup')).toBe('dialog')
    expect(markup, 'the dialog is not drawn until the button is pressed').not.toContain('<dialog')
  })

  it.each([
    ['Hermes has not listed its bots yet', { state: 'loading' }, ONLINE, "Highwing is still reading this Hermes&#x27;s bots."],
    ['Hermes cannot list its bots', { state: 'unsupported' }, ONLINE, 'This Hermes can&#x27;t create bots.'],
    ['Hermes would not list its bots', { state: 'refused' }, ONLINE, 'Highwing can&#x27;t check names until Hermes lists its bots.'],
    ['the first dial failed', { state: 'offline' }, { state: 'waiting', attempt: 1, retryAt: 0, why: 'not-running', message: '' }, 'Highwing isn&#x27;t connected to Hermes right now.'],
    ['the link dropped after the bots were listed', APPROVED, { state: 'connecting', attempt: 2 }, 'Highwing isn&#x27;t connected to Hermes right now.'],
    ['nothing has been pushed yet', undefined, undefined, 'Highwing is still reading this Hermes&#x27;s bots.']
  ] as [string, Bots | undefined, Link | undefined, string][])('shows New bot as unavailable, still reachable, and says why when %s', (_, bots, link, why) => {
    const html = showing(bots, AT_LAUNCH, link)
    const tag = named(html, 'New bot')!
    expect(attr(tag, 'aria-disabled')).toBe('true')
    expect(tag).not.toMatch(/ disabled/)
    expect(attr(tag, 'title')).toBe(why)
    expect(html).toContain(`id="${attr(tag, 'aria-describedby')}">${why}<`)
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
