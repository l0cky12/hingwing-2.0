import type { ConnectorFilter, ConnectorsQuery } from './connectors'

/**
 * One plugin Hermes lists for a bot. `key`: the canonical name Hermes switches it by, which a bare `name` can share with a plugin of
 * another category. `source`: where Hermes found it, as `bundled`, `user` or `entrypoint`. `version`: empty when the plugin gives none.
 * `catalogName`: the catalog entry it was installed from, or null for a plugin that came from anywhere else.
 */
export interface Plugin {
  readonly name: string
  readonly key: string
  readonly version: string
  readonly description: string
  readonly source: string
  readonly enabled: boolean
  readonly catalogName: string | null
}

export const CATALOG_TIERS = ['official', 'verified', 'community'] as const
export type CatalogTier = typeof CATALOG_TIERS[number]

/**
 * One row of Hermes's public plugin catalog. `platforms` empty: it runs on any. `featured`: Nous's rank for it, 1 first, or null for none.
 * `image`: the card's art, an https URL on a GitHub host, or null.
 */
export interface CatalogPlugin {
  readonly name: string
  readonly description: string
  readonly tier: CatalogTier
  readonly category: string
  readonly maintainer: string
  readonly version: string
  readonly platforms: readonly string[]
  readonly stars: number | null
  readonly featured: number | null
  readonly repo: string
  readonly image: string | null
}

/** What Hermes says after it installed a catalog plugin. `missingEnv`: settings it needs before it works. */
export interface PluginInstalled {
  readonly name: string
  readonly enabled: boolean
  readonly restartRequired: boolean
  readonly missingEnv: readonly string[]
  readonly warnings: readonly string[]
}

type Row = { readonly [key: string]: unknown }
const isRow = (raw: unknown): raw is Row => typeof raw === 'object' && raw !== null && !Array.isArray(raw)
const textOf = (raw: unknown) => (typeof raw === 'string' ? raw.trim() : '')
const rankOf = (raw: unknown) => (Number.isSafeInteger(raw) && (raw as number) >= 0 ? (raw as number) : null)
const tierOf = (raw: unknown) => CATALOG_TIERS.find(tier => tier === raw)

/** Only the hosts Hermes desktop trusts for a card's art. */
function imageOf(raw: unknown): string | null {
  const url = URL.parse(textOf(raw))
  if (url?.protocol !== 'https:') return null
  return url.hostname === 'github.com' || url.hostname.endsWith('.githubusercontent.com') ? url.href : null
}

/**
 * The public catalog Hermes desktop browses (`docs/api/plugins.json`), as a list of rows. null: not a list. A row with no name or
 * a tier this build does not know is dropped, and only the first row of a name is kept.
 */
export function parsePluginCatalog(raw: unknown): readonly CatalogPlugin[] | null {
  if (!Array.isArray(raw)) return null
  const byName = new Map<string, CatalogPlugin>()
  for (const row of raw) {
    if (!isRow(row)) continue
    const name = textOf(row.name)
    const tier = tierOf(row.tier)
    if (name === '' || tier === undefined || byName.has(name)) continue
    byName.set(name, {
      name, description: textOf(row.description), tier, category: textOf(row.category), maintainer: textOf(row.maintainer), version: textOf(row.version),
      platforms: Array.isArray(row.platforms) ? row.platforms.map(textOf).filter(platform => platform !== '') : [],
      stars: rankOf(row.stars), featured: rankOf(row.featured), repo: textOf(row.repo), image: imageOf(row.image)
    })
  }
  return [...byName.values()]
}

export interface PluginsView {
  /** Every plugin installed or on offer, whatever the query. */
  readonly total: number
  /** The plugins each filter shows for the query's text. */
  readonly counts: { readonly [F in ConnectorFilter]: number }
  /** Empty when the filter leaves them out or none matches. */
  readonly added: readonly Plugin[]
  /** The catalog plugins the bot does not have, best first. Empty when the filter leaves them out or none matches. */
  readonly available: readonly CatalogPlugin[]
}

const TIER_RANK: { readonly [T in CatalogTier]: number } = { official: 0, verified: 1, community: 2 }
const UNRANKED = Number.MAX_SAFE_INTEGER

const best = (a: CatalogPlugin, b: CatalogPlugin) =>
  TIER_RANK[a.tier] - TIER_RANK[b.tier] || (a.featured ?? UNRANKED) - (b.featured ?? UNRANKED) || (b.stars ?? -1) - (a.stars ?? -1) || a.name.localeCompare(b.name)

const matches = (text: string, ...fields: readonly string[]) => fields.some(field => field.toLowerCase().includes(text))

export function pluginsView(installed: readonly Plugin[], catalog: readonly CatalogPlugin[], query: ConnectorsQuery): PluginsView {
  const held = new Set(installed.flatMap(plugin => (plugin.catalogName === null ? [plugin.name] : [plugin.name, plugin.catalogName])))
  const offered = catalog.filter(plugin => !held.has(plugin.name))
  const text = query.text.trim().toLowerCase()
  const added = installed.filter(plugin => matches(text, plugin.name, plugin.description))
  const available = offered.filter(plugin => matches(text, plugin.name, plugin.description, plugin.category, plugin.maintainer)).sort(best)
  return {
    total: installed.length + offered.length,
    counts: { all: added.length + available.length, added: added.length, available: available.length },
    added: query.filter === 'available' ? [] : added,
    available: query.filter === 'added' ? [] : available
  }
}

/** The plugins as Hermes lists them after one was turned on or off. `restart`: the change takes effect only once Hermes restarts. */
export interface PluginSwitched {
  readonly plugins: readonly Plugin[]
  readonly restart: boolean
}
