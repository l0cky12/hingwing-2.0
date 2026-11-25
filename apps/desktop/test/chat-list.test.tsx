import type { BotId, OpenChat, SessionId, Sidebar, SidebarRow } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { agoOf, botNameOf, chatsOf, offersOf, openChatName } from '../src/renderer/chats/chat-list'
import { menuStep } from '../src/renderer/chat/menu'
import { ChatsPanel } from '../src/renderer/chats/Chats'
import { APPROVED } from './support/bots'

const NOW = Date.UTC(2026, 10, 24, 12)
const RESEARCH = 'research' as BotId
const row = (id: string, title: string, more: Partial<SidebarRow> = {}): SidebarRow =>
  ({ id: id as SessionId, title, preview: null, lastActiveAt: NOW, pinned: false, botChat: false, badge: 'none', ...more })
const ROWS = [
  row('s1', 'Send invoice reminder', { badge: 'asking', preview: 'I drafted the reminder.' }),
  row('s2', 'Sort the invoices', { lastActiveAt: NOW - 5 * 60_000 }),
  row('s3', '  ', { badge: 'running' }),
  row('s4', 'Clean up Downloads', { lastActiveAt: NOW - 2 * 86_400_000 })
]
const listing = (bot: BotId | null, rows: readonly SidebarRow[] = ROWS, status: Sidebar['status'] = 'ready'): Sidebar => ({ bot, status, rows, complete: true })
const NO_DRAFTS: ReadonlySet<SessionId> = new Set()
const showing = (bot: BotId | null, sessionId: string | null = 's2'): OpenChat =>
  ({ shown: { kind: 'chat', bot, sessionId: sessionId as SessionId }, opening: null, missing: null })

const LEAVES = ['rename', 'pin', 'export-md', 'export-json', 'export-html', 'link', 'archive', 'remove']

describe('what a row offers', () => {
  it('is every action for a chat, Pin after Rename, and Archive and Remove last', () => {
    expect(offersOf({ botChat: false, pinned: false })).toEqual(LEAVES)
  })

  it('offers Unpin in place of Pin on a pinned chat', () => {
    expect(offersOf({ botChat: false, pinned: true })).toEqual(['rename', 'unpin', 'export-md', 'export-json', 'export-html', 'link', 'archive', 'remove'])
  })

  it("leaves Pin, Archive and Remove off the bot's own chat, pinned or not, whatever it is titled", () => {
    const kept = ['rename', 'export-md', 'export-json', 'export-html', 'link']
    expect([offersOf({ botChat: true, pinned: true }), offersOf({ botChat: true, pinned: false })]).toEqual([kept, kept])
    expect(chatsOf(listing(RESEARCH, [row('s1', 'Bot Chat', { botChat: true }), row('s2', 'Bot Chat')]), showing(RESEARCH), NOW, NO_DRAFTS))
      .toMatchObject({ sessions: [{ offers: kept }, { offers: LEAVES }] })
  })
})

describe('the groups of the chat list', () => {
  const ids = (view: ReturnType<typeof chatsOf>) => (view.show === 'rows' ? [view.pinned.map(held => held.id), view.sessions.map(held => held.id)] : null)

  it('puts the chats the user pinned first, each group newest first as Hermes listed them', () => {
    const rows = [row('s1', 'a'), row('s2', 'b', { pinned: true }), row('s3', 'c'), row('s4', 'd', { pinned: true })]
    expect(ids(chatsOf(listing(RESEARCH, rows), showing(RESEARCH), NOW, NO_DRAFTS))).toEqual([['s2', 's4'], ['s1', 's3']])
  })

  it("keeps the bot's own chat with the sessions though Hermes pinned it", () => {
    const rows = [row('s1', 'Bot Chat', { pinned: true, botChat: true }), row('s2', 'b')]
    expect(ids(chatsOf(listing(RESEARCH, rows), showing(RESEARCH), NOW, NO_DRAFTS))).toEqual([[], ['s1', 's2']])
  })
})

describe('what the chat list shows', () => {
  it('names each chat by its title, says when it was last used and what it is doing, and marks the open one', () => {
    expect(chatsOf(listing(RESEARCH), showing(RESEARCH), NOW, NO_DRAFTS)).toEqual({
      show: 'rows',
      pinned: [],
      sessions: [
        { id: 's1', name: 'Send invoice reminder', preview: 'I drafted the reminder.', when: 'now', doing: 'Waiting for your OK', badge: 'asking', current: false, showsDraft: false, offers: LEAVES },
        { id: 's2', name: 'Sort the invoices', preview: null, when: '5m', doing: null, badge: 'none', current: true, showsDraft: false, offers: LEAVES },
        { id: 's3', name: 'Untitled chat', preview: null, when: 'now', doing: 'Working', badge: 'running', current: false, showsDraft: false, offers: LEAVES },
        { id: 's4', name: 'Clean up Downloads', preview: null, when: '2d', doing: null, badge: 'none', current: false, showsDraft: false, offers: LEAVES }
      ]
    })
    expect(chatsOf(listing(RESEARCH, [row('s5', 'Fresh', { lastActiveAt: null })]), showing(RESEARCH), NOW, NO_DRAFTS), 'a chat Hermes gave no time')
      .toMatchObject({ sessions: [{ when: '' }] })
  })

  it('marks each chat that holds a draft, except the open one, whose draft is in the box', () => {
    const drafts = new Set(['s1', 's2', 's4'] as SessionId[])
    expect(chatsOf(listing(RESEARCH), showing(RESEARCH), NOW, drafts)).toMatchObject({
      sessions: [{ id: 's1', showsDraft: true }, { id: 's2', showsDraft: false }, { id: 's3', showsDraft: false }, { id: 's4', showsDraft: true }]
    })
  })

  it('keeps the rows of a list that went stale', () => {
    expect(chatsOf(listing(RESEARCH, ROWS, 'stale'), showing(RESEARCH), NOW, NO_DRAFTS)).toMatchObject({ show: 'rows' })
  })

  it("is busy until it holds the open chat's bot's chats", () => {
    expect(chatsOf(undefined, showing(RESEARCH), NOW, NO_DRAFTS)).toEqual({ show: 'loading' })
    expect(chatsOf(listing(RESEARCH), undefined, NOW, NO_DRAFTS)).toEqual({ show: 'loading' })
    expect(chatsOf(listing(RESEARCH, [], 'loading'), showing(RESEARCH), NOW, NO_DRAFTS)).toEqual({ show: 'loading' })
    expect(chatsOf(listing('default' as BotId), showing(RESEARCH), NOW, NO_DRAFTS), "another bot's chats").toEqual({ show: 'loading' })
    expect(chatsOf(listing(null), showing(RESEARCH), NOW, NO_DRAFTS), "the socket's own chats").toEqual({ show: 'loading' })
  })

  it("lists the socket's own chats when the open chat has no bot", () => {
    expect(chatsOf(listing(null), showing(null), NOW, NO_DRAFTS)).toMatchObject({ show: 'rows' })
    expect(chatsOf(listing(null), { shown: null, opening: null, missing: null }, NOW, NO_DRAFTS)).toMatchObject({ show: 'rows' })
  })

  it('says so when the bot has no chats', () => {
    expect(chatsOf(listing(RESEARCH, []), showing(RESEARCH, null), NOW, NO_DRAFTS)).toEqual({ show: 'note', words: 'No chats yet.' })
  })

  it.each([[0, 'now'], [-5_000, 'now'], [59_999, 'now'], [60_000, '1m'], [3_599_999, '59m'], [3_600_000, '1h'], [86_399_999, '23h'], [86_400_000, '1d'], [40 * 86_400_000, '40d']])(
    'reads %i ms ago as %s', (since, words) => {
      expect(agoOf(NOW - since, NOW)).toBe(words)
    }
  )
})

describe('the names of the open chat', () => {
  it("are the bot's roster name, or none for a bot the roster does not list", () => {
    expect(botNameOf(APPROVED, RESEARCH)).toBe('Research')
    expect(botNameOf(APPROVED, 'default' as BotId)).toBe('Emu')
    expect(botNameOf(APPROVED, 'gone' as BotId)).toBeNull()
    expect(botNameOf(APPROVED, null)).toBeNull()
    expect(botNameOf({ state: 'loading' }, RESEARCH)).toBeNull()
  })

  it('name the bot and the title in the top bar, and the bot alone until the chat has a title', () => {
    expect(openChatName('Research', 'Sort the invoices')).toBe('Research · Sort the invoices')
    expect(openChatName('Research', null)).toBe('Research')
    expect(openChatName('Research', ' ')).toBe('Research')
    expect(openChatName(null, 'Sort the invoices')).toBe('Sort the invoices')
    expect(openChatName(null, null)).toBeNull()
  })
})

describe('the chat list', () => {
  const render = (sidebar: Sidebar | undefined, open: OpenChat | undefined, drafts = NO_DRAFTS, live = true) =>
    renderToStaticMarkup(
      <ChatsPanel
        head={<h2>Chats</h2>} sidebar={sidebar} open={open} now={NOW} drafts={drafts} live={live} onOpen={() => {}}
        onRename={async () => ({ ok: true, value: undefined })} onExport={async () => ({ ok: true, value: null })}
        onPin={async () => ({ ok: true, value: undefined })} onArchive={async () => ({ ok: true, value: undefined })} onRemove={async () => ({ ok: true, value: undefined })}
      />
    )
  const attr = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1]
  const buttons = (markup: string) => (markup.match(/<button[^>]*>/g) ?? []).filter(tag => tag.includes('class="chat-row"'))
  const mores = (markup: string) => (markup.match(/<button[^>]*>/g) ?? []).filter(tag => attr(tag, 'aria-haspopup') === 'menu')

  it('is a landmark named Chats, with one button per chat named by its title', () => {
    const markup = render(listing(RESEARCH), showing(RESEARCH))
    expect(attr(markup.match(/<nav[^>]*>/)![0], 'aria-label')).toBe('Chats')
    expect(buttons(markup).map(tag => attr(tag, 'aria-label'))).toEqual(['Send invoice reminder', 'Sort the invoices', 'Untitled chat', 'Clean up Downloads'])
    expect(buttons(markup).filter(tag => attr(tag, 'aria-current') !== undefined).map(tag => attr(tag, 'aria-label'))).toEqual(['Sort the invoices'])
  })

  it('describes each row by what it is doing, when it was last used and its preview, through ids that exist', () => {
    const markup = render(listing(RESEARCH), showing(RESEARCH))
    const [first] = buttons(markup)
    const described = attr(first!, 'aria-describedby')!.split(' ').map(id => new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(markup)?.[1])
    expect(described).toEqual(['Waiting for your OK', 'now', 'I drafted the reminder.'])
  })

  it('says Draft under a chat with unsent text in place of its preview, and what a running chat is doing over its draft', () => {
    const rows = [row('s1', 'Sort the invoices', { preview: 'Sorted fourteen invoices.' }), row('s2', 'Rename the photos', { badge: 'running', preview: 'Renaming.' }), row('s3', 'Open', { preview: 'Here.' })]
    const markup = render(listing(RESEARCH, rows), showing(RESEARCH, 's3'), new Set(['s1', 's2', 's3'] as SessionId[]))
    const shown = (markup.match(/<button[^>]*class="chat-row".*?<\/button>/gs) ?? []).map(button =>
      [...button.matchAll(/class="chat-(doing|preview)"([^>]*)>([^<]*)</g)].filter(([, , attrs]) => !attrs!.includes('hidden')).map(([, , , words]) => words).filter(Boolean))
    expect(shown).toEqual([['Draft'], ['Working'], ['Here.']])
  })

  it('says when there are no chats, and is busy while it loads', () => {
    expect(render(listing(null, []), showing(null))).toContain('No chats yet.')
    expect(render(undefined, showing(RESEARCH))).toMatch(/aria-busy="true"/)
    expect(buttons(render(listing(null), showing(RESEARCH)))).toEqual([])
  })

  it('gives each chat a More button beside its row, named for the chat, that opens a menu', () => {
    const more = mores(render(listing(RESEARCH), showing(RESEARCH)))
    expect(more.map(tag => attr(tag, 'aria-label'))).toEqual(['More for Send invoice reminder', 'More for Sort the invoices', 'More for Untitled chat', 'More for Clean up Downloads'])
    expect(more.every(tag => attr(tag, 'aria-expanded') === 'false' && !tag.includes('disabled'))).toBe(true)
  })

  it('turns every More button off while the connection is not online, and leaves the rows to open', () => {
    const markup = render(listing(RESEARCH), showing(RESEARCH), NO_DRAFTS, false)
    expect(mores(markup).every(tag => tag.includes(' disabled'))).toBe(true)
    expect(buttons(markup).some(tag => tag.includes('disabled'))).toBe(false)
  })

  it('heads the pinned chats and the rest only while a chat is pinned, and keeps one button per chat in that order', () => {
    const headings = (markup: string) => Array.from(markup.matchAll(/<h3 class="chats-group">([^<]*)<\/h3>/g), ([, words]) => words)
    expect(headings(render(listing(RESEARCH), showing(RESEARCH)))).toEqual([])
    const pinned = render(listing(RESEARCH, [...ROWS.slice(0, 3), row('s4', 'Clean up Downloads', { pinned: true })]), showing(RESEARCH))
    expect(headings(pinned)).toEqual(['Pinned', 'Sessions'])
    expect(buttons(pinned).map(tag => attr(tag, 'aria-label'))).toEqual(['Clean up Downloads', 'Send invoice reminder', 'Sort the invoices', 'Untitled chat'])
    expect(pinned.indexOf('>Pinned<')).toBeLessThan(pinned.indexOf('aria-label="Clean up Downloads"'))
    expect(pinned.indexOf('>Sessions<')).toBeLessThan(pinned.indexOf('aria-label="Send invoice reminder"'))
  })

  it('keeps an empty status line under the list for the name of a saved chat', () => {
    expect(render(listing(RESEARCH), showing(RESEARCH))).toMatch(/<p class="chats-note chats-saved" role="status"><\/p><\/nav>$/)
  })
})

describe('the keys of a small menu', () => {
  it('move down and up a step, wrapping at either end, and to the first or last item', () => {
    expect([menuStep('ArrowDown', 0, 4), menuStep('ArrowDown', 3, 4), menuStep('ArrowUp', 0, 4), menuStep('ArrowUp', 2, 4)]).toEqual([1, 0, 3, 1])
    expect([menuStep('Home', 2, 4), menuStep('End', 0, 4)]).toEqual([0, 3])
  })

  it('leave every other key to the item', () => {
    expect([menuStep('Enter', 1, 4), menuStep('a', 1, 4), menuStep('Tab', 1, 4)]).toEqual([null, null, null])
  })
})
