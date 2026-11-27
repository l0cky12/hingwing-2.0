export type Page = 'connection' | 'appearance' | 'keys'
export type RowId = 'connection' | 'theme' | 'sidebar' | 'palette' | 'new-chat' | 'find'

export const PAGES: readonly { readonly id: Page; readonly label: string; readonly lede: string }[] = [
  { id: 'connection', label: 'Connection', lede: 'The Hermes this app talks to, and how it reaches it.' },
  { id: 'appearance', label: 'Appearance', lede: 'How Highwing looks and what its sidebar shows.' },
  { id: 'keys', label: 'Keyboard shortcuts', lede: 'Each shortcut, and where in Highwing it works.' }
]

const SHORTCUT = 'keys keyboard shortcut hotkey ctrl control cmd command ⌘'

export const ROWS: readonly { readonly id: RowId; readonly page: Page; readonly searchText: string; readonly key?: string }[] = [
  { id: 'connection', page: 'connection', searchText: 'Hermes. Where Hermes runs. Tailnet machine, Web address, This computer. Hermes machine. Gateway address. Change. Connect. server host address SSH Tailscale URL sign in online' },
  { id: 'theme', page: 'appearance', searchText: 'Theme. System, Light, Dark. System follows your computer’s light or dark setting. mode colour color' },
  { id: 'sidebar', page: 'appearance', searchText: 'Show in the sidebar. Bots, Chats. Bots shows your bots. Chats shows the chats of the open bot.' },
  { id: 'palette', page: 'keys', searchText: `Command palette. Works anywhere in Highwing. ${SHORTCUT}`, key: 'k' },
  { id: 'new-chat', page: 'keys', searchText: `New chat. Works on the chat screen. ${SHORTCUT}`, key: 'n' },
  { id: 'find', page: 'keys', searchText: `Find in chat. Works in an open chat. search ${SHORTCUT}`, key: 'f' }
]

export type Check = 'idle' | 'checking' | 'failed'

const HIDDEN_CHECK: { readonly [C in Exclude<Check, 'idle'>]: string } = {
  checking: 'Highwing is checking the new connection.',
  failed: 'The new connection failed its check.'
}

export interface SettingsView {
  readonly heading: string
  readonly lede: string
  readonly pages: readonly Page[]
  readonly rows: ReadonlySet<RowId>
  readonly titlesPages: boolean
  readonly emptyAdvice: string | null
  readonly announcement: string | null
  readonly current: Page | null
  readonly hits: ReadonlyMap<Page, number>
  readonly hiddenCheck: string | null
}

type Row = (typeof ROWS)[number]

const pageOf = (page: Page) => PAGES.find(entry => entry.id === page)!
const fold = (text: string) => text.toLowerCase().replaceAll('’', "'")

function byKey(needle: string): readonly Row[] | null {
  const chord = /^(?:ctrl|control|cmd|command|⌘)\s*\+?\s*([a-z])?$/.exec(needle)
  if (chord === null) return null
  const keyed = ROWS.filter(row => row.key !== undefined && (chord[1] === undefined || row.key === chord[1]))
  return keyed.length > 0 ? keyed : ROWS.filter(row => fold(row.searchText).startsWith(needle))
}

function byWords(needle: string): readonly Row[] {
  const terms = needle.split(' ')
  return ROWS.filter(row => {
    const text = fold(`${pageOf(row.page).label} ${row.searchText}`)
    return terms.every(term => text.includes(term))
  })
}

export function settingsViewOf(page: Page, query: string, check: Check): SettingsView {
  const needle = fold(query.trim()).replace(/\s+/g, ' ')
  const hiddenCheckFrom = (rows: ReadonlySet<RowId>) => (check === 'idle' || rows.has('connection') ? null : HIDDEN_CHECK[check])
  if (needle === '') {
    const { label, lede } = pageOf(page)
    const rows = new Set(ROWS.filter(row => row.page === page).map(row => row.id))
    return { heading: label, lede, pages: [page], rows, titlesPages: false, emptyAdvice: null, announcement: null, current: page, hits: new Map(), hiddenCheck: hiddenCheckFrom(rows) }
  }
  const found = byKey(needle) ?? byWords(needle)
  const hits = new Map(PAGES.map(({ id }) => [id, found.filter(row => row.page === id).length] as const).filter(([, count]) => count > 0))
  const rows = new Set(found.map(row => row.id))
  const quoted = `“${query.trim()}”`
  const none = found.length === 0
  return {
    heading: 'Search results',
    lede: none ? `No settings match ${quoted}.` : `Settings that match ${quoted}.`,
    pages: [...hits.keys()],
    rows,
    titlesPages: true,
    emptyAdvice: none ? 'Try another word, such as theme, keys or address.' : null,
    announcement: none ? `No settings match ${quoted}.` : `${found.length} ${found.length === 1 ? 'setting' : 'settings'} found for ${quoted}`,
    current: null,
    hits,
    hiddenCheck: hiddenCheckFrom(rows)
  }
}
