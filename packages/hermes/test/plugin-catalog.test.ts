import { describe, expect, it } from 'vitest'
import { parsePluginCatalog, pluginsView, type CatalogPlugin, type Plugin } from '../src/domain/plugins'

const offered = (name: string, fields: Partial<CatalogPlugin> = {}): CatalogPlugin => ({
  name, description: '', tier: 'community', category: 'tools', maintainer: 'someone', version: '1.0.0', platforms: [], stars: null, featured: null, repo: `https://github.com/someone/${name}`, ...fields
})
const installed = (name: string, catalogName: string | null = null, description = ''): Plugin => ({ name, key: name, version: '1.0.0', description, source: 'user', enabled: true, catalogName })
const names = (plugins: readonly { readonly name: string }[]) => plugins.map(plugin => plugin.name)

describe('parsePluginCatalog', () => {
  it('reads a public catalog row into what a card shows', () => {
    expect(parsePluginCatalog([{
      name: 'mem0', description: ' Mem0 memory provider. ', repo: 'https://github.com/mem0ai/mem0', sha: '43849c6', tier: 'community', category: 'memory', maintainer: 'mem0ai',
      platforms: ['linux', 'macos'], capabilities: { providesTools: [] }, version: '1.3.0', readme: '# Mem0', stars: 69507, featured: 2
    }])).toEqual([{
      name: 'mem0', description: 'Mem0 memory provider.', tier: 'community', category: 'memory', maintainer: 'mem0ai', version: '1.3.0',
      platforms: ['linux', 'macos'], stars: 69507, featured: 2, repo: 'https://github.com/mem0ai/mem0'
    }])
  })

  it('drops a row with no name or a tier it does not know, keeps the first row of a name, and fills what a row leaves out', () => {
    expect(parsePluginCatalog([
      { name: ' ', tier: 'official' }, { tier: 'official' }, { name: 'odd', tier: 'experimental' }, 'stray', null,
      { name: 'kept', tier: 'verified', stars: -3, featured: 1.5, platforms: ['macos', 7, ''] },
      { name: 'kept', tier: 'official', description: 'a second row' }
    ])).toEqual([{ name: 'kept', description: '', tier: 'verified', category: '', maintainer: '', version: '', platforms: ['macos'], stars: null, featured: null, repo: '' }])
  })

  it('answers null for a reply that is not a list', () => {
    expect(parsePluginCatalog({ plugins: [] })).toBeNull()
    expect(parsePluginCatalog(null)).toBeNull()
    expect(parsePluginCatalog([])).toEqual([])
  })
})

describe('pluginsView', () => {
  const CATALOG = [
    offered('zeta', { stars: 10 }),
    offered('alpha', { stars: 10 }),
    offered('popular', { stars: 900 }),
    offered('ranked', { featured: 2, stars: 1 }),
    offered('first', { featured: 1 }),
    offered('checked', { tier: 'verified', stars: 5 }),
    offered('nous', { tier: 'official' }),
    offered('unstarred')
  ]

  it('offers official, then verified, then community, ranked first, then by stars, then by name', () => {
    expect(names(pluginsView([], CATALOG, { text: '', filter: 'all' }).available)).toEqual(['nous', 'checked', 'first', 'ranked', 'popular', 'alpha', 'zeta', 'unstarred'])
  })

  it('leaves out a catalog plugin the bot has, by its catalog name or its own name', () => {
    const view = pluginsView([installed('mem0-plugin', 'ranked'), installed('nous')], CATALOG, { text: '', filter: 'all' })
    expect(names(view.added)).toEqual(['mem0-plugin', 'nous'])
    expect(names(view.available)).not.toContain('ranked')
    expect(names(view.available)).not.toContain('nous')
    expect(view).toMatchObject({ total: 8, counts: { all: 8, added: 2, available: 6 } })
  })

  it('matches a name, description, category or maintainer whatever the case, and counts only the matches', () => {
    const catalog = [offered('a', { description: 'Reads your CALENDAR' }), offered('b', { category: 'calendar' }), offered('c', { maintainer: 'CalCo' }), offered('d')]
    const view = pluginsView([installed('cal-sync'), installed('notes', null, 'Calendar notes')], catalog, { text: ' cal ', filter: 'all' })
    expect(names(view.added)).toEqual(['cal-sync', 'notes'])
    expect(names(view.available)).toEqual(['a', 'b', 'c'])
    expect(view).toMatchObject({ total: 6, counts: { all: 5, added: 2, available: 3 } })
  })

  it('shows one list for its filter and keeps every count', () => {
    const bot = [installed('kanban')]
    const added = pluginsView(bot, CATALOG, { text: '', filter: 'added' })
    expect([names(added.added), added.available]).toEqual([['kanban'], []])
    const available = pluginsView(bot, CATALOG, { text: '', filter: 'available' })
    expect(available.added).toEqual([])
    expect(available.available).toHaveLength(8)
    expect(available.counts).toEqual({ all: 9, added: 1, available: 8 })
  })
})
