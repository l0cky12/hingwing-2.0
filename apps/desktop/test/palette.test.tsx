import type { BotId, CommandOutcome, GroupId, Link, OpenChat, Session, SessionId, SidebarRow, Target } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NOT_NOW, OTHER_CONNECTION } from '../src/ipc-contract'
import { ACTIONS, type ActionRow, type Scene } from '../src/renderer/palette/actions'
import { Results } from '../src/renderer/palette/Palette'
import { activeIn, comebackOf, GRADE, paletteOf, rank, step, type PaletteItem, type PaletteView } from '../src/renderer/palette/palette-view'
import { APPROVED, fact, listed as listedBots } from './support/bots'

const NOW = Date.UTC(2026, 10, 24, 12)
const DAY = 86_400_000
const RESEARCH = 'research' as BotId
const OPEN = 'open-chat' as SessionId
const row = (id: string, title: string, more: Partial<SidebarRow> = {}): SidebarRow =>
  ({ id: id as SessionId, title, preview: null, lastActiveAt: NOW, pinned: false, botChat: false, badge: 'none', ...more })
const showing = (sessionId: SessionId | null): OpenChat => ({ shown: sessionId === null ? { kind: 'bot', bot: RESEARCH, sessionId: null } : { kind: 'chat', bot: RESEARCH, sessionId }, opening: null, missing: null })
const sceneOf = (rows: readonly SidebarRow[], more: Partial<Scene> = {}): Scene => ({
  sidebar: { bot: RESEARCH, status: 'ready', rows, complete: true }, bots: APPROVED, open: showing(OPEN), link: { state: 'online' },
  openSession: undefined, target: null, settingsOpen: false, draftId: 'draft-1', ...more
})
const chatItem = (title: string, lastActiveAt: number | null, preview: string | null = null): PaletteItem =>
  ({ kind: 'chat', key: `chat:${title}`, title, command: { do: 'open', ref: { kind: 'chat', sessionId: title as SessionId } }, preview, doing: null, badge: 'none', lastActiveAt })

const listed = (view: PaletteView) => (view.show === 'note' ? view : view.sections.map(({ heading, rows }) => [heading, rows.map(({ item }) => item.title)]))
const keysIn = (view: PaletteView) => (view.show === 'note' ? [] : view.sections.flatMap(section => section.rows.map(({ item }) => item.key)))
const offered = (id: string, scene: Scene) => (ACTIONS.find(action => action.id === id) as ActionRow).offer(scene)

const SORT = row('s2', 'Sort the invoices', { preview: 'Sorted fourteen invoices by due date; the oldest is due Friday.', lastActiveAt: NOW - 5 * 60_000 })

describe('ranking what the palette lists', () => {
  it('puts a match at the start of a word above one inside a word, and breaks ties by the newest', () => {
    const items = [chatItem('Reinvoice the audit', NOW), chatItem('Invoices for March', NOW - DAY), chatItem('Send invoice reminder', NOW - 60_000)]
    expect(rank('inv', items).map(({ item, grade }) => [item.title, grade])).toEqual([
      ['Send invoice reminder', GRADE.wordStart],
      ['Invoices for March', GRADE.wordStart],
      ['Reinvoice the audit', GRADE.inside]
    ])
  })

  it('ranks a word start in a preview with one in a title, so the newer chat comes first', () => {
    const items = [chatItem('Invoices for March', NOW - DAY), chatItem('Tidy the scans', NOW, 'Filed the invoices.')]
    expect(rank('invoice', items).map(({ item }) => item.title)).toEqual(['Tidy the scans', 'Invoices for March'])
  })

  it('puts New chat first for "new", above a chat titled with it and one whose preview says it', () => {
    const scene = sceneOf([row('s1', 'New pricing page'), row('s2', 'Tidy the scans', { preview: 'Made a new folder for the scans.' })])
    const view = paletteOf(scene, 'new')
    expect(listed(view)).toEqual([['Actions', ['New chat']], ['Chats', ['New pricing page', 'Tidy the scans']]])
    expect(activeIn(view, null)?.item.command).toEqual({ do: 'open', ref: { kind: 'new', bot: RESEARCH, draftId: 'draft-1' } })
  })

  it('lists a chat for a word only its preview holds, with the preview under it', () => {
    const view = paletteOf(sceneOf([SORT, row('s3', 'Clean up Downloads')]), 'fourteen')
    expect(view).toMatchObject({ show: 'rows', sections: [{ heading: 'Chats', rows: [{ item: { title: 'Sort the invoices' }, excerpt: SORT.preview }] }] })
    expect(paletteOf(sceneOf([SORT]), 'sort'), 'the title holds the word').toMatchObject({ sections: [{ rows: [{ excerpt: null }] }] })
  })

  it('says "No matches" when nothing holds the typed words', () => {
    const view = paletteOf(sceneOf([SORT]), 'zzzz')
    expect(view).toEqual({ show: 'note', words: 'No matches' })
    expect(activeIn(view, null)).toBeNull()
    expect(step(view, null, 1)).toBeNull()
  })

  it('lists, with nothing typed, the chats that need you, then the newest without the open one, then the bots, then the actions', () => {
    const rows = [
      row('s1', 'Clean up Downloads', { lastActiveAt: NOW - 2 * DAY }),
      SORT,
      row('s3', 'Send invoice reminder', { badge: 'asking', lastActiveAt: NOW - 3 * DAY }),
      row(OPEN, 'The open chat')
    ]
    expect(listed(paletteOf(sceneOf(rows), ''))).toEqual([
      ['Chats', ['Send invoice reminder', 'Sort the invoices', 'Clean up Downloads']],
      ['Bots', ['Emu', 'dr eggbot', 'Research', 'Timothy · CEO', 'Hermes', 'highwing']],
      ['Actions', ['New chat']]
    ])
    const many = Array.from({ length: 10 }, (_, at) => row(`m${at}`, `Chat ${at}`, { lastActiveAt: NOW - at * DAY }))
    expect(paletteOf(sceneOf(many), '  '), 'at most eight chats').toMatchObject({ sections: [{ heading: 'Chats', rows: { length: 8 } }, {}, {}] })
    expect(paletteOf(sceneOf(many), 'chat'), 'every chat that matches').toMatchObject({ sections: [{ heading: 'Actions' }, { heading: 'Chats', rows: { length: 10 } }] })
  })

  it('leaves hidden bots out of the list with nothing typed, and finds one by name', () => {
    const bots = listedBots(fact('default', 'Emu', { isDefault: true, hidden: true }), fact('old', 'Old Helper', { hidden: true }), fact('research', 'Research'))
    expect(listed(paletteOf(sceneOf([], { bots }), ''))).toEqual([['Bots', ['Research']], ['Actions', ['New chat']]])
    expect(listed(paletteOf(sceneOf([], { bots }), 'old'))).toEqual([['Bots', ['Old Helper']]])
    expect(listed(paletteOf(sceneOf([], { bots }), 'emu'))).toEqual([['Bots', ['Emu']]])
  })

  it('moves the selection down and up, wrapping at both ends', () => {
    const view = paletteOf(sceneOf([SORT]), '')
    const keys = keysIn(view)
    expect(keys[0]).toBe('chat:s2')
    expect(step(view, null, 1)).toBe(keys[1])
    expect(step(view, null, -1), 'up from the first row').toBe('action:new-chat')
    expect(step(view, 'action:new-chat', 1), 'down from the last row').toBe('chat:s2')
    expect(activeIn(view, 'bot:research')?.item.title).toBe('Research')
    expect(activeIn(view, 'chat:gone')?.item.key, 'a pick no longer listed').toBe('chat:s2')
  })
})

describe('the actions', () => {
  const running = (sync: Session['sync']['state']) => ({ run: { state: 'running' }, sync: { state: sync } }) as unknown as Session
  const idle = { run: { state: 'idle' }, sync: { state: 'live' } } as unknown as Session
  const blocked: Link = { state: 'blocked', why: 'refused', message: 'Hermes refused the connection.' }
  const waiting = (why: Extract<Link, { state: 'waiting' }>['why']): Link => ({ state: 'waiting', why, attempt: 1, retryAt: NOW, message: 'Hermes is not running.' })
  const local: Target = { kind: 'local' }

  it('offers New chat in the open bot always', () => {
    expect(offered('new-chat', sceneOf([]))).toEqual({ do: 'open', ref: { kind: 'new', bot: RESEARCH, draftId: 'draft-1' } })
    expect(offered('new-chat', sceneOf([], { open: { shown: null, opening: null, missing: null } }))).toEqual({ do: 'open', ref: { kind: 'new', bot: null, draftId: 'draft-1' } })
  })

  it('offers Stop only while the open chat runs and is live', () => {
    expect(offered('stop', sceneOf([], { openSession: running('live') }))).toEqual({ do: 'stop', sessionId: OPEN })
    expect(offered('stop', sceneOf([], { openSession: running('offline') })), 'offline').toBeNull()
    expect(offered('stop', sceneOf([], { openSession: idle })), 'idle').toBeNull()
    expect(offered('stop', sceneOf([], { openSession: running('live'), open: showing(null) })), 'no chat made yet').toBeNull()
  })

  it('offers no Stop and a new chat with the bot behind a group chat while one is open, and leaves no chat out as the open one', () => {
    const grouped: OpenChat = { shown: { kind: 'group', group: 'launch-plan' as GroupId, over: RESEARCH }, opening: null, missing: null }
    expect(offered('stop', sceneOf([], { open: grouped, openSession: running('live') }))).toBeNull()
    expect(offered('new-chat', sceneOf([], { open: grouped }))).toEqual({ do: 'open', ref: { kind: 'new', bot: RESEARCH, draftId: 'draft-1' } })
    const recent = paletteOf(sceneOf([row(OPEN, 'Open chat'), SORT], { open: grouped }), '')
    expect(keysIn(recent).filter(key => key.startsWith('chat:'))).toHaveLength(2)
  })

  it('offers Open Settings only with a connection to change, and not while Settings is open', () => {
    expect(offered('settings', sceneOf([], { target: local }))).toEqual({ do: 'editTarget' })
    expect(offered('settings', sceneOf([])), 'a fixture run').toBeNull()
    expect(offered('settings', sceneOf([], { target: local, settingsOpen: true })), 'Settings open').toBeNull()
  })

  it('offers Reconnect while the link is blocked, and Start Hermes while it waits on a Hermes that is not running', () => {
    expect(offered('reconnect', sceneOf([], { link: blocked }))).toEqual({ do: 'reconnect', start: false })
    expect(offered('start-hermes', sceneOf([], { link: blocked }))).toBeNull()
    expect(offered('start-hermes', sceneOf([], { link: waiting('not-running') }))).toEqual({ do: 'reconnect', start: true })
    expect(offered('reconnect', sceneOf([], { link: waiting('not-running') }))).toBeNull()
    expect(offered('start-hermes', sceneOf([], { link: waiting('dropped') }))).toBeNull()
    for (const id of ['reconnect', 'start-hermes']) expect(offered(id, sceneOf([])), `${id} while online`).toBeNull()
  })

  it('lists only what is offered, in the order of the table', () => {
    const view = paletteOf(sceneOf([], { link: blocked, openSession: running('live') }), '')
    expect(view.show === 'rows' && view.sections.find(({ heading }) => heading === 'Actions')?.rows.map(({ item }) => item.title)).toEqual(['New chat', 'Stop', 'Reconnect'])
  })
})

describe('the sheet', () => {
  it('is a listbox of named groups and options, the first one selected, or a status that says "No matches"', () => {
    const view = paletteOf(sceneOf([SORT, row('s3', 'Send invoice reminder', { badge: 'asking' })]), 'inv')
    const html = renderToStaticMarkup(<Results view={view} active={activeIn(view, null)} listId="palette" now={NOW} onPick={() => {}} />)
    expect(html).toContain('role="listbox" id="palette" aria-label="Results"')
    expect(html).toContain('role="group" aria-label="Chats"')
    expect(html).toMatch(/role="option" aria-selected="true" aria-label="Send invoice reminder"/)
    expect(html).toMatch(/role="option" aria-selected="false" aria-label="Sort the invoices"/)
    expect(html).toContain('Waiting for your OK')
    const none = paletteOf(sceneOf([SORT]), 'zzzz')
    expect(renderToStaticMarkup(<Results view={none} active={null} listId="palette" now={NOW} onPick={() => {}} />)).toBe('<p class="palette-note" role="status">No matches</p>')
  })
})

describe('a refused pick', () => {
  it("brings the sheet back with main's words for a pick main refused before it sent anything", () => {
    expect(comebackOf(NOT_NOW)).toBe("Highwing can't do that from this screen.")
    expect(comebackOf(OTHER_CONNECTION)).toBe("Highwing switched to another Hermes, so it didn't send that.")
  })

  it('leaves the sheet closed for a pick Hermes refused, whatever its kind, and for one that went through', () => {
    const answers: readonly CommandOutcome<unknown>[] = [
      { ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't switch bots from Highwing yet. Update Hermes on that machine, then reconnect." } },
      { ok: false, refusal: { kind: 'stale', message: 'That turn has already ended.' } },
      { ok: false, refusal: { kind: 'rejected', message: 'Profile name \'root\' is reserved.' } },
      { ok: false, refusal: { kind: 'offline', message: "Highwing isn't connected to Hermes right now." } },
      { ok: true, value: undefined }
    ]
    for (const answer of answers) expect(comebackOf(answer)).toBeNull()
  })
})
