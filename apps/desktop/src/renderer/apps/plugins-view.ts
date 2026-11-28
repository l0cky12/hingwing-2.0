import type { CatalogPlugin, CatalogTier, Plugin, PluginInstalled } from '@highwing/hermes/domain'

/** How many Available cards show at first, and how many more each Show more adds. */
export const PAGE = 60

const TIER_WORDS: { readonly [T in CatalogTier]: string } = { official: 'Official', verified: 'Verified', community: 'Community' }
const PLATFORM_WORDS: Readonly<Record<string, string>> = { linux: 'Linux', macos: 'macOS', windows: 'Windows' }

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
const andList = (words: readonly string[]) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`)

export const installedKind = (plugin: Plugin) => [plugin.version === '' ? '' : `v${plugin.version}`, capital(plugin.source)].filter(Boolean).join(' · ')

export const catalogKind = (plugin: CatalogPlugin) =>
  [TIER_WORDS[plugin.tier], plugin.category, plugin.platforms.map(platform => PLATFORM_WORDS[platform] ?? platform).join(', ')].filter(Boolean).join(' · ')

export const askWords = (plugin: CatalogPlugin) =>
  plugin.tier === 'community' ? "It runs on Hermes's computer. Community plugins aren't reviewed by Nous Research." : "It runs on Hermes's computer."

export function installedWords({ name, restartRequired, missingEnv }: PluginInstalled): string {
  return [
    `Installed ${name}.`,
    restartRequired ? 'Restart Hermes to finish.' : '',
    missingEnv.length === 0 ? '' : `It needs ${andList(missingEnv)} set on Hermes's computer before it works.`
  ].filter(Boolean).join(' ')
}
