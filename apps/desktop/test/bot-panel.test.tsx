import type { BotId, GroupId, OpenChat, SshHost, Target } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fact, listed } from './support/bots'

const topics = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))

vi.mock('react', async original => ({
  ...(await original<typeof import('react')>()),
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read()
}))
vi.mock('../src/renderer/store', () => ({
  Epoch: {},
  run: async () => ({ ok: true, value: undefined }),
  useTopic: (topic: string | null) => (topic === null ? undefined : topics.values[topic])
}))

const { TopBar } = await import('../src/renderer/chrome/Chrome')
const { BotPanel, TabRow } = await import('../src/renderer/bots/BotPanel')
const { botIn } = await import('../src/renderer/bots/roster-view')
const { detailsKeys } = await import('../src/renderer/keys')
const { capsOf, SHORTCUTS, shortcutOf } = await import('../src/renderer/shortcuts')

const isDetailsKey = (event: KeyboardEvent, mac: boolean) => shortcutOf(event, mac)?.id === 'details'

const RAE = 'rae' as BotId
const open = (shown: OpenChat['shown']): OpenChat => ({ shown, opening: null, missing: null })
const bar = () => renderToStaticMarkup(<TopBar target={null} />)

beforeEach(() => {
  topics.values = {
    open: open({ kind: 'bot', bot: RAE, sessionId: 's1' as never }),
    bots: listed(fact('rae', 'Rae')),
    'session:s1': { title: 'Bot Chat' }
  }
})

describe("a bot chat's top bar", () => {
  it('draws the bot as a button in the heading, and the heading keeps its name', () => {
    const html = bar()
    expect(html).toMatch(/<h1 aria-label="Hermes Rae · Bot Chat"><span class="brand">Hermes<\/span> <button type="button" class="bot-pill" aria-label="Details for Rae" aria-haspopup="dialog" aria-keyshortcuts="Control\+Alt\+B" title="Bot details \(Ctrl\+Alt\+B\)"><span class="avatar[^>]*>R<\/span><span class="name">Rae<\/span><\/button><span class="where">· Bot Chat<\/span><\/h1>/)
  })

  it('leaves the heading as plain text for a bot the roster does not list', () => {
    topics.values = { ...topics.values, bots: listed(fact('sam', 'Sam')) }
    expect(bar()).toMatch(/<h1><span class="brand">Hermes<\/span> Bot Chat<\/h1>/)
  })

  it('holds only the New chat pencil at its right end', () => {
    const target: Target = { kind: 'remote', host: 'hermes-host.example-tailnet.ts.net' as SshHost }
    topics.values = { ...topics.values, screen: { bot: RAE, screen: { state: 'off' } } }
    const html = renderToStaticMarkup(<TopBar target={target} />)
    expect(html.slice(html.indexOf('</h1>'))).toMatch(/^<\/h1><button type="button" class="pencil" aria-label="New chat" title="New chat \(Ctrl\+N\)" aria-keyshortcuts="Control\+N"><svg[^>]*>.*<\/svg><\/button><\/header>$/)
  })

  it('draws no bot button over a group chat', () => {
    topics.values = { ...topics.values, open: open({ kind: 'group', group: 'plan' as GroupId, over: RAE }), groups: { state: 'listed', driver: true, seatable: null, rows: [] } }
    expect(bar()).not.toContain('bot-pill')
  })
})

describe('the details shortcut', () => {
  const press = (init: Partial<KeyboardEvent>) => ({ key: 'b', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init }) as KeyboardEvent

  it('takes Ctrl+Alt+B, and not Ctrl+B, Ctrl+Shift+B or Ctrl+Alt+Shift+B', () => {
    expect(isDetailsKey(press({ ctrlKey: true, altKey: true }), false)).toBe(true)
    expect(isDetailsKey(press({ ctrlKey: true }), false)).toBe(false)
    expect(isDetailsKey(press({ ctrlKey: true, shiftKey: true }), false)).toBe(false)
    expect(isDetailsKey(press({ ctrlKey: true, altKey: true, shiftKey: true }), false)).toBe(false)
  })

  it('takes Cmd+Shift+I on macOS, and not Cmd+I', () => {
    expect(isDetailsKey(press({ key: 'i', metaKey: true, shiftKey: true }), true)).toBe(true)
    expect(isDetailsKey(press({ key: 'i', metaKey: true }), true)).toBe(false)
    expect(detailsKeys(true).shown).toBe('⌘⇧I')
  })

  it("reads a key that types no Latin letter by its place", () => {
    expect(isDetailsKey(press({ key: 'и', code: 'KeyB', ctrlKey: true, altKey: true }), false)).toBe(true)
  })

  it('is listed in the shortcut table with the keys each platform draws', () => {
    const row = SHORTCUTS.find(shortcut => shortcut.id === 'details')!
    expect(capsOf(row, false)).toEqual(['Ctrl', 'Alt', 'B'])
    expect(capsOf(row, true)).toEqual(['⌘', '⇧', 'I'])
  })
})

describe('the panel tab row', () => {
  it('draws nothing for one tab, and a tab list once there are more, with the chosen tab selected', () => {
    expect(renderToStaticMarkup(<TabRow tabs={[{ id: 'details', label: 'Details' }]} selected="details" onSelect={() => {}} />)).toBe('')
    const html = renderToStaticMarkup(<TabRow tabs={[{ id: 'details', label: 'Details' }, { id: 'routines', label: 'Routines' }]} selected="routines" onSelect={() => {}} />)
    expect(html).toMatch(/role="tablist".*role="tab" aria-selected="false" tabindex="-1">Details<.*role="tab" aria-selected="true" tabindex="0">Routines</)
  })
})

describe('the panel when Hermes refuses to describe the bot', () => {
  it("names the bot and says Hermes's words, with a way to close", () => {
    const bot = botIn(listed(fact('rae', 'Rae')), RAE)!
    const html = renderToStaticMarkup(<BotPanel panel={{ at: 'refused', bot, words: "This Hermes can't edit bots from Highwing." }} current={bot} onClose={() => {}} />)
    expect(html).toMatch(/<dialog class="bot-form bot-panel" aria-label="Rae"><h2>Rae<\/h2>.*<p class="form-refused" role="alert">This Hermes can&#x27;t edit bots from Highwing.<\/p>.*>Close<\/button>/)
  })

  it('draws nothing while closed', () => {
    expect(renderToStaticMarkup(<BotPanel panel={{ at: 'closed' }} current={null} onClose={() => {}} />)).toBe('')
  })
})
