import { BOT_TONES, type BotId, type Bots, type GroupId, type Groups, type Link, type MemberId, type OpenChat, type SessionId } from '@highwing/hermes/domain'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BotsPanel } from '../src/renderer/bots/Bots'
import type { LookCalls } from '../src/renderer/bots/LookPicker'
import { APPROVED, fact, listed } from './support/bots'

const AT_LAUNCH: OpenChat = { shown: { kind: 'bot', bot: 'default' as BotId, sessionId: 's1' as SessionId }, opening: null, missing: null }
const ONLINE: Link = { state: 'online' }
const NO_GROUPS: Groups = { state: 'listed', driver: true, seatable: null, rows: [] }
const NO_LOOKS: LookCalls = {
  canGenerate: async () => ({ ok: true, value: false }), generate: async () => ({ ok: true, value: '' }), choose: async () => ({ ok: true, value: 'cancelled' }),
  pets: async () => ({ ok: true, value: [] }), petPicture: async () => ({ ok: true, value: null })
}
const showing = (bots: Bots | undefined, open: OpenChat | undefined, link: Link | undefined = ONLINE, groups: Groups | undefined = NO_GROUPS) =>
  renderToStaticMarkup(
    <BotsPanel
      bots={bots} open={open} link={link} groups={groups} onOpen={async () => ({ ok: true, value: null })} onNewChat={() => {}} onNew={async () => ({ ok: true, value: null })}
      onMark={async () => ({ ok: true, value: { edition: 2 } })}
      onCreate={async () => ({ ok: true, value: { bot: 'rae' as BotId, warnings: [] } })} onCreateGroup={async () => ({ ok: true, value: undefined })} onOpenGroup={() => {}}
      onRenameGroup={async () => ({ ok: true, value: undefined })} onDeleteGroup={async () => ({ ok: true, value: undefined })}
      onModels={async () => ({ ok: true, value: { options: [], fallback: null } })}
      onDescribe={async bot => ({ ok: true, value: { bot, name: 'Rae', description: '', persona: '', revision: 2 } })} onEdit={async () => ({ ok: true, value: undefined })}
      onPickPicture={async () => ({ ok: true, value: 'cancelled' })} onRemovePicture={async () => ({ ok: true, value: undefined })} looks={NO_LOOKS}
    />
  )
const render = (bots: Bots | undefined) => showing(bots, AT_LAUNCH)
const attr = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1]
const buttons = (markup: string) => markup.match(/<button[^>]*>/g) ?? []
const named = (markup: string, label: string) => buttons(markup).find(tag => attr(tag, 'aria-label') === label)
const marked = (html: string, name: string) => buttons(html).filter(tag => attr(tag, name) !== undefined).map(tag => attr(tag, 'aria-label'))
const idsIn = (markup: string) => Array.from(markup.matchAll(/ id="([^"]*)"/g), ([, id]) => id)

describe('the bots sidebar', () => {
  const markup = render(APPROVED)

  it('is one landmark named Bots, with nothing the chat column looks for by name', () => {
    expect(markup.match(/<aside[^>]*>/g)).toHaveLength(1)
    expect(attr(markup.match(/<aside[^>]*>/)![0], 'aria-label')).toBe('Bots')
    expect(markup).not.toMatch(/<footer|id="scroll"/)
  })

  it("names each row by its bot, and the default bot as the default bot, each followed by its More button", () => {
    expect(buttons(markup).map(tag => attr(tag, 'aria-label'))).toEqual([
      'Search bots', 'New', 'Emu, default bot', 'More for Emu', 'dr eggbot', 'More for dr eggbot', 'Research', 'More for Research',
      'Timothy · CEO', 'More for Timothy · CEO', 'Hermes', 'More for Hermes', 'highwing', 'More for highwing'
    ])
    expect(markup).toMatch(/<h3>New section<\/h3>.*<h3>Unassigned<\/h3>/s)
  })

  it('keeps each More button beside its row, never inside it, as a closed menu button', () => {
    expect(markup).not.toMatch(/<button(?:(?!<\/button>)[\s\S])*<button/)
    const more = buttons(markup).filter(tag => attr(tag, 'class') === 'bot-more')
    expect(more).toHaveLength(6)
    expect(more.every(tag => attr(tag, 'aria-haspopup') === 'menu' && attr(tag, 'aria-expanded') === 'false')).toBe(true)
    expect(markup, 'no menu is drawn until one is opened').not.toContain('role="menu"')
  })

  it('keeps an empty live region in the page, so a screen reader hears it fill', () => {
    expect(markup).toContain('<p class="bots-note bots-said" role="status"></p>')
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

  it('has one plus, a closed menu button named New, whatever the link says, and draws no dialog until a row is picked', () => {
    for (const [bots, link] of [[APPROVED, ONLINE], [undefined, undefined], [{ state: 'offline' }, { state: 'connecting', attempt: 2 }]] as [Bots | undefined, Link | undefined][]) {
      const tag = named(showing(bots, AT_LAUNCH, link), 'New')!
      expect([attr(tag, 'aria-haspopup'), attr(tag, 'aria-expanded'), attr(tag, 'aria-disabled')]).toEqual(['menu', 'false', undefined])
    }
    expect(markup).not.toMatch(/<dialog|role="menu"/)
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

  const seat = (bot: string, handle = bot) => ({ id: bot as MemberId, bot: bot as BotId, handle, name: handle })
  const groups = (...rows: [string, string, ...ReturnType<typeof seat>[]][]): Groups =>
    ({ state: 'listed', driver: true, seatable: null, rows: rows.map(([id, name, ...members]) => ({ id: id as GroupId, name, members, answering: [] })) })
  const section = (html: string) => /<section><h3>Group chats<\/h3>(.*?)<\/section>/s.exec(html)?.[1] ?? null
  const rowsIn = (html: string) => Array.from((section(html) ?? '').matchAll(/<div class="bot-row">(.*?)<\/div>/gs), ([, row]) => row!)
  const textOf = (row: string) => Array.from(row.matchAll(/<span class="bot-(?:name|preview)(?: live)?"[^>]*>([^<]*)</g), ([, text]) => text)
  const IN_PLAN: OpenChat = { shown: { kind: 'group', group: 'plan' as GroupId, over: 'default' as BotId }, opening: null, missing: null }

  it("lists the group chats between the default bot and the sections, each named and followed by its members' names", () => {
    const html = showing(APPROVED, AT_LAUNCH, ONLINE, groups(['plan', 'Launch plan', seat('default', 'emu'), seat('research'), seat('timothy')], ['ops', 'Ops', seat('highwing'), seat('hermes-dev')]))
    expect(html).toMatch(/class="bot-row bot-row-feature".*<h3>Group chats<\/h3>.*<h3>New section<\/h3>/s)
    expect(rowsIn(html).map(textOf)).toEqual([['Launch plan', 'Emu, Research and Timothy · CEO'], ['Ops', 'highwing and Hermes']])
  })

  it('makes each group a button named for the group and its members, described by its second line', () => {
    const html = showing(APPROVED, AT_LAUNCH, ONLINE, groups(['plan', 'Launch plan', seat('default', 'emu'), seat('research'), seat('timothy')]))
    const [tag] = buttons(section(html) ?? '')
    expect(attr(tag!, 'aria-label')).toBe('Launch plan, group chat with Emu, Research and Timothy · CEO')
    expect(html).toContain(`id="${attr(tag!, 'aria-describedby')}">Emu, Research and Timothy · CEO<`)
    expect(attr(tag!, 'aria-current')).toBeUndefined()
  })

  it('follows each group with its own More button, beside the row and never inside it, as a closed menu button', () => {
    const html = showing(APPROVED, AT_LAUNCH, ONLINE, groups(['plan', 'Launch plan', seat('default', 'emu'), seat('research')], ['ops', 'Ops', seat('highwing'), seat('hermes-dev')]))
    const inGroups = buttons(section(html) ?? '')
    expect(inGroups.map(tag => attr(tag, 'aria-label'))).toEqual(['Launch plan, group chat with Emu and Research', 'More for Launch plan', 'Ops, group chat with highwing and Hermes', 'More for Ops'])
    expect(section(html)).not.toMatch(/<button(?:(?!<\/button>)[\s\S])*<button/)
    const more = inGroups.filter(tag => attr(tag, 'class') === 'bot-more')
    expect(more.every(tag => attr(tag, 'aria-haspopup') === 'menu' && attr(tag, 'aria-expanded') === 'false')).toBe(true)
    expect(more.map(tag => attr(tag, 'data-group-more')), 'kept apart from the bots\' More buttons').toEqual(['plan', 'ops'])
  })

  it("marks the open group's row as the current one, and no bot's, and says in the signal colour who is answering", () => {
    const answering: Groups = { state: 'listed', driver: true, seatable: null, rows: [{ id: 'plan' as GroupId, name: 'Launch plan', members: [seat('default'), seat('research')], answering: [{ member: 'research' as MemberId, doing: 'thinking', tool: null }] }] }
    const html = showing(APPROVED, IN_PLAN, ONLINE, answering)
    const [tag] = buttons(section(html) ?? '')
    expect(attr(tag!, 'aria-current')).toBe('true')
    expect(buttons(html).filter(button => attr(button, 'aria-current') !== undefined)).toEqual([tag])
    expect(section(html)).toMatch(/<span class="bot-preview live" id="[^"]*">Research is thinking<\/span>/)
  })

  const facesIn = (row: string) => Array.from(row.matchAll(/<span class="avatar tone-(\w+)"[^>]*>(\w)<|<span class="stack-more">([^<]*)</g), ([, tone, letter, more]) => (more ?? `${letter} ${tone}`))

  it("draws a member's avatar as the roster draws that bot, and a seat the roster no longer lists by its own name", () => {
    const [row] = rowsIn(showing(APPROVED, AT_LAUNCH, ONLINE, groups(['trio', 'Trio', seat('default'), seat('research'), seat('gone', 'zed')])))
    expect(facesIn(row!)).toEqual(['E ink', 'R umber', 'Z slate'])
    expect(row).toMatch(/<span class="stack" aria-hidden="true">/)
    expect(textOf(row!)).toEqual(['Trio', 'Emu, Research and zed'])
  })

  it('keeps the stack to three places, the third saying how many more, and names every member under the name', () => {
    const [row] = rowsIn(showing(APPROVED, AT_LAUNCH, ONLINE, groups(['big', 'Everyone', seat('default'), seat('research'), seat('gone', 'zed'), seat('timothy'), seat('highwing')])))
    expect(facesIn(row!)).toEqual(['E ink', 'R umber', '+3'])
    expect(textOf(row!)).toEqual(['Everyone', 'Emu, Research, zed, Timothy · CEO and highwing'])
  })

  it.each([
    ['Hermes has made none', NO_GROUPS], ['this Hermes has no group chats', { state: 'unsupported' }], ['Hermes has not said yet', { state: 'loading' }], ['nothing has been pushed yet', undefined]
  ] as [string, Groups | undefined][])('draws no Group chats section when %s', (_, held) => {
    expect(section(showing(APPROVED, AT_LAUNCH, ONLINE, held))).toBeNull()
  })

  it('has a paint for every tone a bot can carry', () => {
    const css = readFileSync('apps/desktop/src/renderer/styles/app.css', 'utf8')
    for (const tone of ['ink', ...BOT_TONES]) expect(css, tone).toMatch(new RegExp(`\\.tone-${tone} \\{ background: var\\(--`))
  })
})

describe('pinned and hidden bots in the sidebar', () => {
  const MARKED = listed(
    fact('default', 'Hermes', { isDefault: true }),
    fact('editor', 'Editor', { section: 'Writing' }),
    fact('researcher', 'Researcher', { section: 'Research', pinned: true }),
    fact('old', 'Old Helper', { hidden: true }),
    fact('test', 'Test Bot', { hidden: true })
  )
  const toggleOf = (html: string) => buttons(html).find(tag => tag.includes('data-hidden-toggle'))
  const rowsOf = (html: string) => buttons(html).filter(tag => /class="bot(-feature)?"/.test(tag)).map(tag => attr(tag, 'aria-label'))
  const headingsOf = (html: string) => Array.from(html.matchAll(/<h3>(?:<button[^>]*>)?(?:<svg.*?<\/svg>)?([^<]*)/g), ([, words]) => words)

  it('draws Pinned under the card, then the sections, then a collapsed Hidden (N) with no hidden rows', () => {
    const html = render(MARKED)
    expect(headingsOf(html)).toEqual(['Pinned', 'Writing', 'Hidden (2)'])
    expect(rowsOf(html)).toEqual(['Hermes, default bot', 'Researcher', 'Editor'])
    expect(attr(toggleOf(html)!, 'aria-expanded')).toBe('false')
  })

  it('draws no card for a hidden default bot', () => {
    const html = showing(listed(fact('default', 'Hermes', { isDefault: true, hidden: true }), fact('editor', 'Editor')), undefined)
    expect(rowsOf(html)).toEqual(['Editor'])
    expect(headingsOf(html)).toEqual(['Unassigned', 'Hidden (1)'])
  })

  it('opens Hidden at once, at lower emphasis, when every bot is hidden', () => {
    const html = render(listed(fact('old', 'Old Helper', { hidden: true }), fact('test', 'Test Bot', { hidden: true })))
    expect(attr(toggleOf(html)!, 'aria-expanded')).toBe('true')
    expect(rowsOf(html)).toEqual(['Old Helper', 'Test Bot'])
    expect(html.match(/<div class="bot-row" data-place="hidden">/g)).toHaveLength(2)
  })

  it('opens Hidden at once when the open chat is a hidden bot', () => {
    const html = showing(MARKED, { shown: { kind: 'bot', bot: 'old' as BotId, sessionId: null }, opening: null, missing: null })
    expect(attr(toggleOf(html)!, 'aria-expanded')).toBe('true')
    expect(marked(html, 'aria-current')).toEqual(['Old Helper'])
  })
})
