import type { Bot, BotDetails, BotId, OpenChat, Refusal } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DETAILS_TABS, loadOf } from '../src/renderer/bots/details'
import { botIn } from '../src/renderer/bots/roster-view'
import { fact, listed } from './support/bots'

const topics = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))

vi.mock('react', async original => ({
  ...(await original<typeof import('react')>()),
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read()
}))
vi.mock('../src/renderer/store', () => ({
  Epoch: {},
  run: async () => ({ ok: true, value: undefined }),
  pickBotPicture: async () => ({ ok: true, value: 'cancelled' }),
  useTopic: (topic: string | null) => (topic === null ? undefined : topics.values[topic])
}))

const { BotDetailsPanel } = await import('../src/renderer/bots/BotDetailsPanel')
const { Bar, TopBar } = await import('../src/renderer/chrome/Chrome')

const BOTS = listed(fact('rae', 'Rae'))
const RAE_BOT = botIn(BOTS, 'rae' as BotId) as Bot
const RAE: BotDetails = { bot: 'rae' as BotId, name: 'Rae', description: 'Writes the weekly report', persona: 'Plain.', revision: 2 }
const REFUSED: Refusal = { kind: 'unsupported', message: "This Hermes can't edit bots from Highwing." }
const never = () => new Promise<never>(() => {})
const CALLS = { onDescribe: never, onEdit: never, onPickPicture: never, onRemovePicture: never }
const DETAILS = { open: false, panel: 'details', pill: { current: null }, toggle: () => {} }

const drawn = (tabs = DETAILS_TABS) =>
  renderToStaticMarkup(<BotDetailsPanel id="details" bot={RAE_BOT} calls={CALLS} onClose={() => {}} tabs={tabs} />)

const bar = (open: OpenChat) => {
  topics.values = { ...topics.values, open }
  return renderToStaticMarkup(<TopBar target={null} settingsButton={{ current: null }} details={DETAILS} />)
}

beforeEach(() => {
  topics.values = { bots: BOTS }
})

describe('the details panel', () => {
  it('shows the details Hermes describes, or its refusal in its own words', () => {
    expect(loadOf({ ok: true, value: RAE })).toEqual({ at: 'shown', details: RAE })
    expect(loadOf({ ok: false, refusal: REFUSED })).toEqual({ at: 'refused', words: "This Hermes can't edit bots from Highwing." })
  })

  it('is named for its bot and says it is loading until Hermes answers', () => {
    const markup = drawn()
    expect(markup).toContain('aria-label="Rae details"')
    expect(markup).toContain('<h2>Rae</h2>')
    expect(markup).toMatch(/role="status"[^>]*>Loading</)
    expect(markup).toContain('aria-label="Close details"')
  })

  it('draws no tab row while Details is its only section', () => {
    expect(DETAILS_TABS.map(tab => tab.id)).toEqual(['details'])
    expect(drawn()).not.toContain('role="tablist"')
  })

  it('draws the tab row once a second section joins', () => {
    const markup = drawn([...DETAILS_TABS, { id: 'memory', label: 'Memory' }])
    expect(markup).toContain('role="tablist"')
    expect(markup).toMatch(/role="tab" aria-selected="true">Details</)
    expect(markup).toMatch(/role="tab" aria-selected="false">Memory</)
  })
})

describe('the top bar', () => {
  it("draws a bot chat's bot as a pill that opens its details, and keeps the heading's words", () => {
    const markup = bar({ shown: { kind: 'bot', bot: 'rae' as BotId, sessionId: null }, opening: null, missing: null })
    expect(markup).toContain('<h1 aria-label="Hermes Rae">')
    expect(markup).toMatch(/<button type="button" class="bot-pill" aria-label="Rae details" aria-expanded="false" aria-keyshortcuts="Control\+Alt\+B"/)
    expect(markup).toMatch(/class="avatar tone-[a-z]+"[^>]*>R<\/span>Rae<\/button>/)
  })

  it('draws no pill for a chat whose bot is not listed', () => {
    const markup = bar({ shown: { kind: 'bot', bot: 'gone' as BotId, sessionId: null }, opening: null, missing: null })
    expect(markup).not.toContain('bot-pill')
    expect(markup).toContain('<h1><span class="brand">Hermes</span></h1>')
  })

  it('takes the heading from its text when nothing draws part of it', () => {
    expect(renderToStaticMarkup(<Bar where="Settings" />)).toContain('<h1><span class="brand">Hermes</span> Settings</h1>')
  })
})
