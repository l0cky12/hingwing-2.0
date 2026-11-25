import type { BotId, Bots, Groups, Link, OpenChat, SessionId } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PlusItems } from '../src/renderer/bots/NewMenu'
import { plusMenuOf, seatableIn, type PlusScene } from '../src/renderer/bots/plus-menu'
import { newChatIn } from '../src/renderer/new-chat'
import { APPROVED, fact, listed } from './support/bots'

const ONLINE: Link = { state: 'online' }
const DROPPED: Link = { state: 'waiting', attempt: 1, retryAt: 0, why: 'dropped', message: 'Reconnecting to Hermes.' }
const AT_EMU: OpenChat = { shown: { kind: 'bot', bot: 'default' as BotId, sessionId: 's1' as SessionId }, opening: null, missing: null }
const GROUPS: Groups = { state: 'listed', driver: true, seatable: null, rows: [] }
const scene = (more: Partial<PlusScene> = {}): PlusScene => ({ link: ONLINE, bots: APPROVED, groups: GROUPS, open: AT_EMU, mac: false, ...more })
const rowOf = (id: string, more: Partial<PlusScene> = {}) => plusMenuOf(scene(more)).find(item => item.id === id)!
const decoded = (text: string) => text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const attr = (tag: string, name: string) => {
  const value = new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1]
  return value === undefined ? undefined : decoded(value)
}

describe('the plus menu', () => {
  it('starts a new chat with the open bot, then a group chat, then, under a rule, a bot', () => {
    expect(plusMenuOf(scene()).map(item => [item.label, item.keys?.shown ?? null, item.block, item.ruled])).toEqual([
      ['New chat with Emu', 'Ctrl+N', null, false],
      ['New group chat…', null, null, false],
      ['New bot…', null, null, true]
    ])
    expect(rowOf('new-chat', { mac: true }).keys).toEqual({ shown: '⌘N', aria: 'Meta+N' })
    const research: OpenChat = { ...AT_EMU, shown: { kind: 'chat', bot: 'research' as BotId, sessionId: 's2' as SessionId } }
    expect(rowOf('new-chat', { open: research }).label).toBe('New chat with Research')
    expect(rowOf('new-chat', { open: { ...AT_EMU, shown: { kind: 'chat', bot: null, sessionId: 's3' as SessionId } } }).label, 'a chat with no bot to name').toBe('New chat')
  })

  it('starts the new chat the top bar and the palette start: in the open bot, under the window\'s draft id', () => {
    expect(newChatIn(AT_EMU, 'd1')).toEqual({ do: 'open', ref: { kind: 'new', bot: 'default', draftId: 'd1' } })
    expect(newChatIn(undefined, 'd2')).toEqual({ do: 'open', ref: { kind: 'new', bot: null, draftId: 'd2' } })
  })

  it.each([
    ['nothing has been pushed yet', { link: undefined, groups: undefined }, 'Highwing is still asking this Hermes about group chats.'],
    ['the link is down', { link: DROPPED }, "Highwing isn't connected to Hermes right now."],
    ['Hermes has not answered', { groups: { state: 'loading' } }, 'Highwing is still asking this Hermes about group chats.'],
    ['this Hermes has no group chats', { groups: { state: 'unsupported' } }, 'This Hermes has no group chats. Update Hermes on that machine, then reconnect.'],
    ['Hermes would not answer', { groups: { state: 'refused' } }, "Hermes won't let this connection use group chats."],
    ['the bots are not listed yet', { bots: { state: 'loading' } }, "Highwing is still reading this Hermes's bots."],
    ['Hermes cannot list its bots', { bots: { state: 'unsupported' } }, "This Hermes can't list its bots."],
    ['there is one bot', { bots: listed(fact('default', 'Emu', { isDefault: true })) }, 'A group chat needs at least 2 bots.'],
    ['Hermes would seat only one of them', { groups: { ...GROUPS, seatable: ['default', 'gone'] as BotId[] } }, 'A group chat needs at least 2 bots.']
  ] as [string, Partial<PlusScene>, string][])('blocks New group chat, and says why, when %s', (_, more, why) => {
    expect(rowOf('new-group', more).block).toBe(why)
  })

  it('offers New group chat on a Hermes that is not running group chats now, since Hermes still makes one', () => {
    expect(rowOf('new-group', { groups: { ...GROUPS, driver: false } }).block).toBeNull()
  })

  it.each([
    ['Hermes has not listed its bots yet', { bots: { state: 'loading' } }, "Highwing is still reading this Hermes's bots."],
    ['Hermes cannot list its bots', { bots: { state: 'unsupported' } }, "This Hermes can't create bots."],
    ['the link dropped after the bots were listed', { link: DROPPED }, "Highwing isn't connected to Hermes right now."],
    ['nothing has been pushed yet', { link: undefined, bots: undefined }, "Highwing is still reading this Hermes's bots."]
  ] as [string, Partial<PlusScene>, string][])('blocks New bot, and says why, when %s', (_, more, why) => {
    expect(rowOf('new-bot', more).block).toBe(why)
  })

  it('offers only the bots Hermes would seat, in the roster\'s order, and every bot when Hermes does not say', () => {
    const names = (groups: Groups | undefined) => seatableIn(APPROVED, groups).map(bot => bot.name)
    expect(names({ ...GROUPS, seatable: ['timothy', 'research', 'default'] as BotId[] })).toEqual(['Emu', 'Research', 'Timothy · CEO'])
    expect(names(GROUPS)).toEqual(['Emu', 'dr eggbot', 'Research', 'Timothy · CEO', 'Hermes', 'highwing'])
    expect(names({ state: 'unsupported' })).toEqual([])
    expect(seatableIn({ state: 'loading' } as Bots, GROUPS)).toEqual([])
  })
})

describe('the plus menu, drawn', () => {
  const blocked = plusMenuOf(scene({ groups: { state: 'unsupported' } }))
  const markup = renderToStaticMarkup(<PlusItems items={blocked} idPrefix="m" onPick={() => {}} />)
  const items = markup.match(/<button[^>]*>.*?<\/button>/gs) ?? []
  const tagOf = (item: string) => /<button[^>]*>/.exec(item)![0]
  const spoken = (item: string) => decoded(item.replace(/<(kbd|span)[^>]*aria-hidden="true"[^>]*>.*?<\/\1>/gs, '').replace(/<[^>]*>/g, ''))

  it('is three menu items named by their words alone, with a rule above New bot', () => {
    expect(items.map(item => [attr(tagOf(item), 'role'), spoken(item)])).toEqual([['menuitem', 'New chat with Emu'], ['menuitem', 'New group chat…'], ['menuitem', 'New bot…']])
    expect(markup).toMatch(/New group chat….*<hr\/>.*New bot…/s)
  })

  it('shows the shortcut and names it to a screen reader', () => {
    expect(items[0]).toContain('<kbd aria-hidden="true">Ctrl+N</kbd>')
    expect(attr(tagOf(items[0]!), 'aria-keyshortcuts')).toBe('Control+N')
  })

  it('keeps a blocked row focusable, marks it, and gives its reason as a description and a title', () => {
    const tag = tagOf(items[1]!)
    expect(attr(tag, 'aria-disabled')).toBe('true')
    expect(tag).not.toMatch(/ disabled/)
    const why = 'This Hermes has no group chats. Update Hermes on that machine, then reconnect.'
    expect(attr(tag, 'title')).toBe(why)
    expect(decoded(markup)).toContain(`id="${attr(tag, 'aria-describedby')}" aria-hidden="true">${why}<`)
    expect(attr(tagOf(items[0]!), 'aria-disabled')).toBeUndefined()
  })
})
