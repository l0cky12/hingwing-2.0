import type { CatalogPlugin, Plugin } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { catalogKind, installedKind, installedWords } from '../src/renderer/apps/plugins-view'

vi.mock('../src/renderer/store', () => ({ Epoch: {}, run: async () => ({ ok: true, value: undefined }), useTopic: () => undefined }))

const { OfferCard } = await import('../src/renderer/apps/Connectors')

const offered = (fields: Partial<CatalogPlugin> = {}): CatalogPlugin => ({
  name: 'mem0', description: 'Mem0 memory provider.', tier: 'community', category: 'memory', maintainer: 'mem0ai', version: '1.3.0', platforms: [], stars: 3, featured: null, repo: 'https://github.com/mem0ai/mem0', ...fields
})
const card = (plugin: CatalogPlugin, installing: Parameters<typeof OfferCard>[0]['installing']) =>
  renderToStaticMarkup(<OfferCard plugin={plugin} installing={installing} onAsk={() => {}} onInstall={() => {}} onCancel={() => {}} />)
const buttons = (html: string) => Array.from(html.matchAll(/<button[^>]*aria-label="([^"]*)"([^>]*)>/g), ([, label, rest]) => (rest!.includes('disabled') ? `${label} (disabled)` : label))
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')

describe('a catalog plugin’s card', () => {
  it('offers Install, and holds it while another plugin installs', () => {
    expect(buttons(card(offered(), null))).toEqual(['Install mem0'])
    expect(buttons(card(offered(), { name: 'spotify', at: 'confirming' }))).toEqual(['Install mem0'])
    expect(buttons(card(offered(), { name: 'spotify', at: 'installing' }))).toEqual(['Install mem0 (disabled)'])
  })

  it('asks before an install, naming the repository and where it runs, and warns that a community plugin is unreviewed', () => {
    const confirming = card(offered(), { name: 'mem0', at: 'confirming' })
    expect(buttons(confirming)).toEqual(['Cancel installing mem0', 'Install mem0'])
    expect(text(confirming)).toContain("https://github.com/mem0ai/mem0 It runs on Hermes's computer. Community plugins come from independent developers.")
    const official = text(card(offered({ tier: 'official' }), { name: 'mem0', at: 'confirming' }))
    expect(official).toContain("It runs on Hermes's computer.")
    expect(official).not.toContain('reviewed')
    expect(text(card(offered(), null))).not.toContain("Hermes's computer")
  })

  it('says Installing… with no button while its install runs', () => {
    const html = card(offered(), { name: 'mem0', at: 'installing' })
    expect(buttons(html)).toEqual([])
    expect(html).toContain('Installing…')
  })
})

describe('what a plugin card says', () => {
  it('names the tier, the category and any platforms a catalog plugin is limited to', () => {
    expect(catalogKind(offered())).toBe('Community · memory')
    expect(catalogKind(offered({ tier: 'verified', category: 'notes', platforms: ['macos'] }))).toBe('Verified · notes · macOS')
    expect(catalogKind(offered({ tier: 'official', category: '', platforms: ['linux', 'macos', 'windows', 'bsd'] }))).toBe('Official · Linux, macOS, Windows, bsd')
  })

  it('names an installed plugin’s version and where Hermes found it', () => {
    const plugin: Plugin = { name: 'kanban', key: 'kanban', version: '1.2.0', description: '', source: 'bundled', enabled: true, catalogName: null }
    expect(installedKind(plugin)).toBe('v1.2.0 · Bundled')
    expect(installedKind({ ...plugin, version: '' })).toBe('Bundled')
  })

  it('says what is left to do after an install', () => {
    const done = { name: 'spotify', enabled: true, restartRequired: false, missingEnv: [], warnings: [] }
    expect(installedWords(done)).toBe('Installed spotify.')
    expect(installedWords({ ...done, restartRequired: true })).toBe('Installed spotify. Restart Hermes to finish.')
    expect(installedWords({ ...done, missingEnv: ['SPOTIFY_CLIENT_ID'] })).toBe("Installed spotify. It needs SPOTIFY_CLIENT_ID set on Hermes's computer before it works.")
    expect(installedWords({ ...done, restartRequired: true, missingEnv: ['A', 'B', 'C'] })).toBe("Installed spotify. Restart Hermes to finish. It needs A, B and C set on Hermes's computer before it works.")
  })
})
