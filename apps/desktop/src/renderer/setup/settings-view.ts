import { SHORTCUTS, type Shortcut, type ShortcutId } from '../shortcuts'

export type Page = 'connection' | 'models' | 'appearance' | 'composer' | 'window' | 'notifications' | 'passwords' | 'skills' | 'permissions' | 'keys' | 'usage' | 'about'
export type RowId =
  | 'connection' | 'models' | 'theme' | 'accent' | 'show-work' | 'sidebar' | 'send-key' | 'spell-check' | 'on-close' | 'notice-asks' | 'notice-replies' | 'notice-jobs' | 'passwords' | 'skills' | 'permissions' | 'denied'
  | 'shortcuts' | `key:${ShortcutId}` | 'usage' | 'about-app' | 'about-hermes'

export const PAGES: readonly { readonly id: Page; readonly label: string; readonly lede: string }[] = [
  { id: 'connection', label: 'Connection', lede: 'The Hermes this app talks to, and how it reaches it.' },
  { id: 'models', label: 'Models', lede: 'The model each bot starts new chats on, and the one Hermes switches to when that one fails.' },
  { id: 'appearance', label: 'Appearance', lede: 'How Highwing looks and what its sidebar shows.' },
  { id: 'composer', label: 'Composer', lede: 'How the message box sends and checks what you write.' },
  { id: 'window', label: 'Window', lede: 'What closing Highwing’s window does.' },
  { id: 'notifications', label: 'Notifications', lede: 'Which desktop notifications Highwing shows.' },
  { id: 'passwords', label: 'Password managers', lede: 'The 1Password and Bitwarden logins each bot can use.' },
  { id: 'skills', label: 'Skills', lede: 'The skills the open bot can use, and which of them are on.' },
  { id: 'permissions', label: 'Permissions', lede: 'How Hermes asks before it runs a command.' },
  { id: 'keys', label: 'Keyboard shortcuts', lede: 'Each shortcut, and where in Highwing it works.' },
  { id: 'usage', label: 'Usage', lede: 'What this Hermes reports of its use.' },
  { id: 'about', label: 'About', lede: 'The versions of Highwing and of the Hermes it talks to.' }
]

const SHORTCUT = 'keys keyboard shortcut hotkey'
const CTRL = 'ctrl control cmd command ⌘'
const NOTICE = 'notification notify alert desktop'

/** Where a shortcut works, as its row's description. */
export const whereOf = ({ onlyIn }: Shortcut) => (onlyIn === null ? 'Works anywhere in Highwing.' : `Works ${onlyIn.charAt(0).toLowerCase()}${onlyIn.slice(1)}.`)

interface Row {
  readonly id: RowId
  readonly page: Page
  readonly searchText: string
  /** The keys a Ctrl or ⌘ chord names it by, such as `k`. */
  readonly keys?: readonly string[]
}

const shortcutRows: readonly Row[] = SHORTCUTS.map(shortcut => ({
  id: `key:${shortcut.id}` as const,
  page: 'keys' as const,
  searchText: [
    `${shortcut.label}. ${whereOf(shortcut)} ${shortcut.group}.`, ...shortcut.keys.filter(key => key.length > 1),
    ...(shortcut.mod === 'alt' ? [] : [CTRL]), ...(shortcut.mod === 'alt' || shortcut.mod === 'ctrlAlt' ? ['alt option ⌥'] : []), ...(shortcut.shift === true ? ['shift ⇧'] : []), SHORTCUT
  ].join(' '),
  ...(shortcut.mod === 'alt' ? {} : { keys: shortcut.keys.map(key => key.toLowerCase()) })
}))

export const ROWS: readonly Row[] = [
  { id: 'connection', page: 'connection', searchText: 'Hermes. Where Hermes runs. Tailnet machine, SSH, Web address, This computer. Hermes machine. SSH destination. Gateway address. Change. Connect. Servers. Use. Remove. In use. Add a server. Add a way in. Ways in. Pick. Fastest, In order. Move up, Move down. server host address Tailscale LAN URL sign in online switch several multiple priority fallback failover speed' },
  { id: 'models', page: 'models', searchText: 'Models. Bot. Each bot keeps its own models. Default model. New chats with this bot start on it. Backup model. Used when the default model fails. No backup. fallback failover provider LLM switch' },
  { id: 'theme', page: 'appearance', searchText: 'Theme. System, Light, Dark. System follows your computer’s light or dark setting. mode colour color' },
  { id: 'accent', page: 'appearance', searchText: 'Accent. Bot, Ink, Slate, Plum, Olive, Mauve, Umber. Bot uses the color of the open chat’s bot. colour color tint header send button' },
  { id: 'show-work', page: 'appearance', searchText: 'Show the bot’s work. Replies only, Actions, Everything. Replies only hides thinking and tool calls, and shows the bot hopping while it works. thinking reasoning thought tool call steps activity pet animation hide collapse verbose' },
  { id: 'sidebar', page: 'appearance', searchText: 'Show in the sidebar. Bots, Chats. Bots shows your bots. Chats shows the chats of the open bot.' },
  { id: 'send-key', page: 'composer', searchText: `Send with Ctrl+Enter. Enter adds a new line. When off, Enter sends and Shift+Enter adds a line. send key message newline line break ${CTRL}` },
  { id: 'spell-check', page: 'composer', searchText: 'Check spelling. Underline misspelled words and suggest fixes. spell check spellcheck spelling dictionary typo' },
  { id: 'on-close', page: 'window', searchText: 'When the window closes. Quit, Keep in the tray. Quit leaves Highwing. Keep in the tray leaves it running. close exit background' },
  { id: 'notice-asks', page: 'notifications', searchText: `Approvals and questions. When a bot waits on you in a chat you aren’t looking at. ${NOTICE}` },
  { id: 'notice-replies', page: 'notifications', searchText: `Finished replies. When a reply ends in a chat you aren’t looking at. ${NOTICE}` },
  { id: 'notice-jobs', page: 'notifications', searchText: `Scheduled jobs. When a scheduled job finishes. cron ${NOTICE}` },
  { id: 'passwords', page: 'passwords', searchText: 'Password managers. 1Password, Bitwarden. Bot. Each bot keeps its own password managers. unlock lock vault secret login master password token' },
  { id: 'skills', page: 'skills', searchText: 'Skills. Skills this bot can use. A skill turned off stays installed. Open SKILL.md instructions. turn on off enable disable library' },
  { id: 'permissions', page: 'permissions', searchText: 'Commands are approved on the composer. approval approve Manual, Smart, Off. YOLO' },
  { id: 'denied', page: 'permissions', searchText: 'Denied commands. This bot never runs a command that matches one of these, even with YOLO on. To change them, edit approvals.deny in the bot’s config.yaml. deny block blocked forbid rule glob' },
  { id: 'shortcuts', page: 'keys', searchText: `Show all. Every shortcut Highwing has, grouped by what it does. sheet ${SHORTCUT} ${CTRL}` },
  ...shortcutRows,
  { id: 'usage', page: 'usage', searchText: 'Usage. What this Hermes reports. tokens cost plan limit quota account' },
  { id: 'about-app', page: 'about', searchText: 'App. Highwing version' },
  { id: 'about-hermes', page: 'about', searchText: 'Hermes. Hermes version' }
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

const pageOf = (page: Page) => PAGES.find(entry => entry.id === page)!
const fold = (text: string) => text.toLowerCase().replaceAll('’', "'")

function byKey(needle: string): readonly Row[] | null {
  const chord = /^(?:ctrl|control|cmd|command|⌘)\s*\+?\s*(\S)?$/.exec(needle)
  if (chord === null) return null
  const key = chord[1]
  if (key === undefined) {
    const worded = byWords(needle)
    return ROWS.filter(row => row.keys !== undefined || worded.includes(row))
  }
  const keyed = ROWS.filter(row => row.keys?.includes(key) === true)
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
