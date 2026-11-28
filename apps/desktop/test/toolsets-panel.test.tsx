import type { Toolset } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/renderer/store', () => ({ Epoch: {}, run: async () => ({ ok: true, value: undefined }), useTopic: () => undefined }))

const { ToolsetList } = await import('../src/renderer/apps/Connectors')

const WEB: Toolset = { name: 'web', label: 'Web Search & Scraping', place: null, description: 'Search the web and read pages.', tools: ['web_search', 'web_extract'], toolCount: 2, enabled: true }
const DISCORD: Toolset = { name: 'discord', label: 'Discord', place: 'Discord', description: 'Post to Discord.', tools: ['discord'], toolCount: 1, enabled: false }

const list = (toolsets: readonly Toolset[], locked: string | null, disabled = false) =>
  renderToStaticMarkup(<ToolsetList name="Rae" toolsets={toolsets} locked={locked} of={toolset => ({ checked: toolset.enabled, disabled, onChange: () => {} })} />)
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const switches = (html: string) => Array.from(html.matchAll(/<input[^>]*role="switch"[^>]*>/g), ([input]) => ({
  label: /aria-label="([^"]*)"/.exec(input)?.[1]?.replace(/&amp;/g, '&'), on: input.includes('checked=""'), off: input.includes('disabled=""')
}))

describe('the Tools tab of a Hermes that can switch toolsets', () => {
  it("says when a change reaches a bot's chats, and gives each toolset a switch named by Hermes's label", () => {
    const html = list([WEB, DISCORD], null)
    expect(text(html)).toContain("Changes reach each of Rae's chats from its next message. Group chats keep the tools they started with.")
    expect(switches(html)).toEqual([
      { label: 'Use Web Search & Scraping', on: true, off: false },
      { label: 'Use Discord', on: false, off: false }
    ])
  })

  it('names the platform of a toolset that is not for the chat, and draws no tool names or count', () => {
    const html = text(list([WEB, DISCORD], null))
    expect(html).toContain('Discord Discord Post to Discord.')
    expect(html).toContain('Web Search & Scraping Search the web and read pages.')
    expect(html).not.toContain('web_search')
    expect(html).not.toContain('2 tools')
  })

  it('holds every switch while one change is on its way', () => {
    expect(switches(list([WEB, DISCORD], null, true)).map(({ off }) => off)).toEqual([true, true])
  })
})

describe('the Tools tab of a Hermes that cannot', () => {
  const html = list([WEB, DISCORD], "This Hermes can't switch toolsets from Highwing.")

  it('says why, and draws no switch', () => {
    expect(text(html)).toContain("This Hermes can't switch toolsets from Highwing.")
    expect(switches(html)).toEqual([])
    expect(text(html)).not.toContain('Changes reach')
  })

  it('keeps the read-only cards: the tool names, whether the chat has it on, and how many tools it has', () => {
    expect(text(html)).toContain('web Search the web and read pages. web_search, web_extract On · 2 tools')
    expect(text(html)).toContain('discord Post to Discord. discord Off')
  })
})

describe('the Tools tab of a Hermes with no toolsets', () => {
  it('says so, with no list', () => {
    expect(list([], null)).not.toContain('hub-grid')
    expect(text(list([], null))).toContain('Hermes has no toolsets.')
  })
})
