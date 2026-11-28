export type Tab = 'skills' | 'plugins' | 'connectors' | 'tools' | 'templates'

export const TABS: readonly { readonly tab: Tab; readonly label: string }[] = [
  { tab: 'skills', label: 'Skills' }, { tab: 'plugins', label: 'Plugins' }, { tab: 'connectors', label: 'Connectors' }, { tab: 'tools', label: 'Tools' }, { tab: 'templates', label: 'Templates' }
]

/** The tab a Left or Right arrow moves to from the tab at `at`, wrapping at either end. null: any other key. */
export function tabAfterKey(at: number, key: string): Tab | null {
  const by = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
  return by === 0 ? null : TABS[(at + by + TABS.length) % TABS.length]!.tab
}
