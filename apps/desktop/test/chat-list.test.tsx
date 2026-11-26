import type { BotId, OpenChat, SessionId, Sidebar, SidebarRow } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ACTION_LABELS, agoOf, botNameOf, chatsOf, nextWakeOf, openChatName, sectionsOf, snoozeChoices, untilWords, type ChatsView } from '../src/renderer/chats/chat-list'
import type { Snoozes } from '../src/ipc-contract'
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

const NO_SNOOZES: Snoozes = {}
const listOf = (rows: readonly SidebarRow[], snoozes: Snoozes = NO_SNOOZES, now = NOW) => chatsOf(listing(RESEARCH, rows), showing(RESEARCH), now, NO_DRAFTS, snoozes)
const rowsOf = (view: ChatsView) => (view.show === 'rows' ? [...view.pinned, ...view.sessions, ...view.snoozed] : [])
const words = (view: ChatsView) => rowsOf(view).map(held => held.menu.map(group => group.map(action => ACTION_LABELS[action])))
const CHAT_MENU = [['pin', 'snooze'], ['rename', 'retitle'], ['export-md', 'export-json', 'export-html', 'link'], ['archive', 'delete']]
const HOUR = 3_600_000

describe('what a row offers', () => {
  it('is Pin and Snooze, then the two renames, then the exports and the link, then Archive and Delete…', () => {
    expect(words(listOf([row('s1', 'a')]))).toEqual([[
      ['Pin', 'Snooze'], ['Rename…', 'Rename with AI'], ['Export as Markdown', 'Export as JSON', 'Export as HTML', 'Copy link'], ['Archive', 'Delete…']
    ]])
  })

  it('offers Unpin on a pinned chat and Wake on a snoozed one', () => {
    const rows = [row('s1', 'a', { pinned: true }), row('s2', 'b'), row('s3', 'c', { pinned: true })]
    const view = listOf(rows, { ['s2' as SessionId]: NOW + HOUR, ['s3' as SessionId]: NOW + HOUR })
    expect(rowsOf(view).map(held => [held.id, held.menu[0]])).toEqual([['s1', ['unpin', 'snooze']], ['s2', ['pin', 'wake']], ['s3', ['unpin', 'wake']]])
    expect(rowsOf(view).every(held => JSON.stringify(held.menu.slice(1)) === JSON.stringify(CHAT_MENU.slice(1)))).toBe(true)
  })

  it("leaves Pin, Snooze, Archive and Delete… off the bot's own chat, pinned or snoozed or not, whatever it is titled", () => {
    const kept = [['rename', 'retitle'], ['export-md', 'export-json', 'export-html', 'link']]
    const rows = [row('s1', 'Bot Chat', { botChat: true, pinned: true }), row('s2', 'Bot Chat', { botChat: true }), row('s3', 'Bot Chat')]
    expect(rowsOf(listOf(rows, { ['s1' as SessionId]: NOW + HOUR })).map(held => held.menu)).toEqual([kept, kept, CHAT_MENU])
  })
})

describe('the groups of the chat list', () => {
  const ids = (view: ChatsView) => (view.show === 'rows' ? [view.pinned, view.sessions, view.snoozed].map(group => group.map(held => held.id)) : null)
  const headings = (view: ChatsView) => (view.show === 'rows' ? sectionsOf(view).map(section => [section.heading, section.rows.map(held => held.id)]) : null)

  it('puts the chats the user pinned first, each group newest first as Hermes listed them', () => {
    const rows = [row('s1', 'a'), row('s2', 'b', { pinned: true }), row('s3', 'c'), row('s4', 'd', { pinned: true })]
    expect(ids(listOf(rows))).toEqual([['s2', 's4'], ['s1', 's3'], []])
  })

  it("keeps the bot's own chat with the sessions though Hermes pinned it", () => {
    const rows = [row('s1', 'Bot Chat', { pinned: true, botChat: true }), row('s2', 'b')]
    expect(ids(listOf(rows))).toEqual([[], ['s1', 's2'], []])
  })

  it('moves a snoozed chat, pinned or not, under Snoozed until its time, and back after', () => {
    const rows = [row('s1', 'a', { pinned: true }), row('s2', 'b'), row('s3', 'c')]
    const snoozes = { ['s1' as SessionId]: NOW + HOUR, ['s3' as SessionId]: NOW + 2 * HOUR }
    expect(ids(listOf(rows, snoozes))).toEqual([[], ['s2'], ['s1', 's3']])
    expect(ids(listOf(rows, snoozes, NOW + HOUR)), 'the first wakes at its time').toEqual([['s1'], ['s2'], ['s3']])
    expect(ids(listOf(rows, snoozes, NOW + 2 * HOUR))).toEqual([['s1'], ['s2', 's3'], []])
  })

  it('never hides a chat that waits for an OK, and ignores a snooze of a chat Hermes does not list', () => {
    const rows = [row('s1', 'a', { badge: 'asking' }), row('s2', 'b')]
    expect(ids(listOf(rows, { ['s1' as SessionId]: NOW + HOUR, ['gone' as SessionId]: NOW + HOUR }))).toEqual([[], ['s1', 's2'], []])
  })

  it('heads each group that holds a row while Pinned or Snoozed holds one, and none otherwise', () => {
    const rows = [row('s1', 'a', { pinned: true }), row('s2', 'b'), row('s3', 'c')]
    expect(headings(listOf(rows.slice(1)))).toEqual([[null, ['s2', 's3']]])
    expect(headings(listOf(rows))).toEqual([['Pinned', ['s1']], ['Sessions', ['s2', 's3']]])
    expect(headings(listOf(rows.slice(1), { ['s2' as SessionId]: NOW + HOUR }))).toEqual([['Sessions', ['s3']], ['Snoozed', ['s2']]])
    expect(headings(listOf(rows, { ['s2' as SessionId]: NOW + HOUR, ['s3' as SessionId]: NOW + HOUR }))).toEqual([['Pinned', ['s1']], ['Snoozed', ['s2', 's3']]])
  })

  it('wakes the list at the soonest snooze still ahead', () => {
    expect(nextWakeOf({ ['s1' as SessionId]: NOW - 1, ['s2' as SessionId]: NOW + 2 * HOUR, ['s3' as SessionId]: NOW + HOUR }, NOW)).toBe(NOW + HOUR)
    expect(nextWakeOf({ ['s1' as SessionId]: NOW }, NOW)).toBeNull()
    expect(nextWakeOf({}, NOW)).toBeNull()
  })
})

describe('the time a snooze ends', () => {
  const TUE = new Date(2026, 10, 24, 14, 5, 30)
  const at = (days: number, hour: number, minute = 0) => new Date(2026, 10, 24 + days, hour, minute).getTime()

  it('is the time today, Tomorrow and the time, a weekday this week, and a date past it', () => {
    expect(untilWords(at(0, 18), TUE.getTime())).toBe('6:00 PM')
    expect(untilWords(at(0, 15, 5), TUE.getTime())).toBe('3:05 PM')
    expect(untilWords(at(1, 9), TUE.getTime())).toBe('Tomorrow 9:00 AM')
    expect(untilWords(at(1, 9), TUE.getTime(), 'weekday')).toBe('Wed 9:00 AM')
    expect(untilWords(at(6, 0, 30), TUE.getTime())).toBe('Mon 12:30 AM')
    expect(untilWords(at(7, 12), TUE.getTime())).toBe('Dec 1 12:00 PM')
  })

  it('offers an hour, three hours, this evening, tomorrow morning and next Monday morning, soonest first, each with the time it ends', () => {
    expect(snoozeChoices(TUE)).toEqual([
      { id: 'hour', label: 'In 1 hour', when: '3:05 PM', until: at(0, 15, 5) },
      { id: 'hours', label: 'In 3 hours', when: '5:05 PM', until: at(0, 17, 5) },
      { id: 'evening', label: 'This evening', when: '6:00 PM', until: at(0, 18) },
      { id: 'tomorrow', label: 'Tomorrow', when: 'Wed 9:00 AM', until: at(1, 9) },
      { id: 'week', label: 'Next week', when: 'Mon 9:00 AM', until: at(6, 9) }
    ])
  })

  it('puts this evening before three hours from now once it comes sooner, and leaves it out once it has begun', () => {
    expect(snoozeChoices(new Date(2026, 10, 24, 16, 30)).map(choice => choice.id)).toEqual(['hour', 'evening', 'hours', 'tomorrow', 'week'])
    expect(snoozeChoices(new Date(2026, 10, 24, 18, 0)).map(choice => choice.id)).toEqual(['hour', 'hours', 'tomorrow', 'week'])
  })

  it('keeps one choice of any two that end the same minute', () => {
    expect(snoozeChoices(new Date(2026, 10, 24, 15, 0)).map(choice => [choice.id, choice.when])).toEqual([
      ['hour', '4:00 PM'], ['hours', '6:00 PM'], ['tomorrow', 'Wed 9:00 AM'], ['week', 'Mon 9:00 AM']
    ])
    expect(snoozeChoices(new Date(2026, 10, 29, 10, 0)).map(choice => choice.id), 'on a Sunday next Monday is tomorrow').toEqual(['hour', 'hours', 'evening', 'tomorrow'])
  })

  it('snoozes from a Monday to the Monday after', () => {
    expect(snoozeChoices(new Date(2026, 10, 30, 8, 0)).at(-1)).toEqual({ id: 'week', label: 'Next week', when: 'Dec 7 9:00 AM', until: new Date(2026, 11, 7, 9).getTime() })
  })
})

describe('what the chat list shows', () => {
  it('names each chat by its title, says when it was last used and what it is doing, and marks the open one', () => {
    const kept = { pinned: false, group: 'sessions', menu: CHAT_MENU }
    expect(chatsOf(listing(RESEARCH), showing(RESEARCH), NOW, NO_DRAFTS, NO_SNOOZES)).toEqual({
      show: 'rows',
      pinned: [],
      sessions: [
        { id: 's1', name: 'Send invoice reminder', preview: 'I drafted the reminder.', when: 'now', doing: 'Waiting for your OK', badge: 'asking', current: false, showsDraft: false, ...kept },
        { id: 's2', name: 'Sort the invoices', preview: null, when: '5m', doing: null, badge: 'none', current: true, showsDraft: false, ...kept },
        { id: 's3', name: 'Untitled chat', preview: null, when: 'now', doing: 'Working', badge: 'running', current: false, showsDraft: false, ...kept },
        { id: 's4', name: 'Clean up Downloads', preview: null, when: '2d', doing: null, badge: 'none', current: false, showsDraft: false, ...kept }
      ],
      snoozed: []
    })
    expect(chatsOf(listing(RESEARCH, [row('s5', 'Fresh', { lastActiveAt: null })]), showing(RESEARCH), NOW, NO_DRAFTS, NO_SNOOZES), 'a chat Hermes gave no time')
      .toMatchObject({ sessions: [{ when: '' }] })
  })

  it('says until when a snoozed chat sleeps in place of its preview, and what a running one is doing over that', () => {
    const tomorrow = new Date(NOW)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)
    const rows = [row('s1', 'a', { preview: 'Done.' }), row('s2', 'b', { badge: 'running' })]
    expect(rowsOf(listOf(rows, { ['s1' as SessionId]: tomorrow.getTime(), ['s2' as SessionId]: tomorrow.getTime() })).map(held => held.doing))
      .toEqual(['Snoozed until Tomorrow 9:00 AM', 'Working'])
  })

  it('marks each chat that holds a draft, except the open one, whose draft is in the box', () => {
    const drafts = new Set(['s1', 's2', 's4'] as SessionId[])
    expect(chatsOf(listing(RESEARCH), showing(RESEARCH), NOW, drafts, NO_SNOOZES)).toMatchObject({
      sessions: [{ id: 's1', showsDraft: true }, { id: 's2', showsDraft: false }, { id: 's3', showsDraft: false }, { id: 's4', showsDraft: true }]
    })
  })

  it('keeps the rows of a list that went stale', () => {
    expect(chatsOf(listing(RESEARCH, ROWS, 'stale'), showing(RESEARCH), NOW, NO_DRAFTS, NO_SNOOZES)).toMatchObject({ show: 'rows' })
  })

  it("is busy until it holds the open chat's bot's chats", () => {
    expect(chatsOf(undefined, showing(RESEARCH), NOW, NO_DRAFTS, NO_SNOOZES)).toEqual({ show: 'loading' })
    expect(chatsOf(listing(RESEARCH), undefined, NOW, NO_DRAFTS, NO_SNOOZES)).toEqual({ show: 'loading' })
    expect(chatsOf(listing(RESEARCH, [], 'loading'), showing(RESEARCH), NOW, NO_DRAFTS, NO_SNOOZES)).toEqual({ show: 'loading' })
    expect(chatsOf(listing('default' as BotId), showing(RESEARCH), NOW, NO_DRAFTS, NO_SNOOZES), "another bot's chats").toEqual({ show: 'loading' })
    expect(chatsOf(listing(null), showing(RESEARCH), NOW, NO_DRAFTS, NO_SNOOZES), "the socket's own chats").toEqual({ show: 'loading' })
  })

  it("lists the socket's own chats when the open chat has no bot", () => {
    expect(chatsOf(listing(null), showing(null), NOW, NO_DRAFTS, NO_SNOOZES)).toMatchObject({ show: 'rows' })
    expect(chatsOf(listing(null), { shown: null, opening: null, missing: null }, NOW, NO_DRAFTS, NO_SNOOZES)).toMatchObject({ show: 'rows' })
  })

  it('says so when the bot has no chats', () => {
    expect(chatsOf(listing(RESEARCH, []), showing(RESEARCH, null), NOW, NO_DRAFTS, NO_SNOOZES)).toEqual({ show: 'note', words: 'No chats yet.' })
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
  const render = (sidebar: Sidebar | undefined, open: OpenChat | undefined, drafts = NO_DRAFTS, live = true, snoozes = NO_SNOOZES) =>
    renderToStaticMarkup(
      <ChatsPanel
        head={<h2>Chats</h2>} sidebar={sidebar} open={open} now={NOW} drafts={drafts} snoozes={snoozes} live={live} onOpen={() => {}}
        onRename={async () => ({ ok: true, value: undefined })} onRetitle={async () => ({ ok: true, value: 'A title' })} onExport={async () => ({ ok: true, value: null })}
        onPin={async () => ({ ok: true, value: undefined })} onSnooze={async () => ({ ok: true, value: undefined })}
        onArchive={async () => ({ ok: true, value: undefined })} onDelete={async () => ({ ok: true, value: undefined })}
      />
    )
  const attr = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1]
  const buttons = (markup: string) => (markup.match(/<button[^>]*>/g) ?? []).filter(tag => tag.includes('class="chat-row"'))
  const headings = (markup: string) => Array.from(markup.matchAll(/<h3 class="chats-group">([^<]*)<\/h3>/g), ([, words]) => words)
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
    expect(headings(render(listing(RESEARCH), showing(RESEARCH)))).toEqual([])
    const pinned = render(listing(RESEARCH, [...ROWS.slice(0, 3), row('s4', 'Clean up Downloads', { pinned: true })]), showing(RESEARCH))
    expect(headings(pinned)).toEqual(['Pinned', 'Sessions'])
    expect(buttons(pinned).map(tag => attr(tag, 'aria-label'))).toEqual(['Clean up Downloads', 'Send invoice reminder', 'Sort the invoices', 'Untitled chat'])
    expect(pinned.indexOf('>Pinned<')).toBeLessThan(pinned.indexOf('aria-label="Clean up Downloads"'))
    expect(pinned.indexOf('>Sessions<')).toBeLessThan(pinned.indexOf('aria-label="Send invoice reminder"'))
  })

  it('heads the snoozed chats after the rest, and says until when each sleeps', () => {
    const markup = render(listing(RESEARCH), showing(RESEARCH), NO_DRAFTS, true, { ['s4' as SessionId]: NOW + HOUR })
    expect(headings(markup)).toEqual(['Sessions', 'Snoozed'])
    expect(buttons(markup).map(tag => attr(tag, 'aria-label'))).toEqual(['Send invoice reminder', 'Sort the invoices', 'Untitled chat', 'Clean up Downloads'])
    expect(markup.indexOf('>Snoozed<')).toBeLessThan(markup.indexOf('aria-label="Clean up Downloads"'))
    expect(markup).toMatch(/class="chat-doing"[^>]*>Snoozed until \d{1,2}:\d\d [AP]M</)
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
