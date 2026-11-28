import { describe, expect, it } from 'vitest'
import { ROWS, settingsViewOf } from '../src/renderer/setup/settings-view'
import { SHORTCUTS } from '../src/renderer/shortcuts'

const KEYED = SHORTCUTS.filter(({ mod }) => mod !== 'alt').map(({ id }) => `key:${id}`)

describe('settingsViewOf with no search', () => {
  it.each([
    ['connection', 'Connection', 'The Hermes this app talks to, and how it reaches it.', ['connection']],
    ['models', 'Models', 'The model each bot starts new chats on, and the one Hermes switches to when that one fails.', ['models']],
    ['appearance', 'Appearance', 'How Highwing looks, how its text reads, and what its sidebar shows.', ['theme', 'accent', 'show-work', 'sidebar', 'font-interface', 'font-prompt', 'font-code', 'font-terminal', 'chat-width', 'contrast', 'math', 'motion']],
    ['composer', 'Composer', 'How the message box sends and checks what you write.', ['send-key', 'spell-check']],
    ['window', 'Window', 'What closing Highwing’s window does.', ['on-close']],
    ['notifications', 'Notifications', 'Which desktop notifications Highwing shows.', ['notice-asks', 'notice-replies', 'notice-jobs']],
    ['passwords', 'Password managers', 'The 1Password and Bitwarden logins each bot can use.', ['passwords']],
    ['permissions', 'Permissions', 'How Hermes asks before it runs a command, and which commands it always runs or never runs.', ['permissions', 'allowed', 'denied', 'add-rule']],
    ['keys', 'Keyboard shortcuts', 'Each shortcut, and where in Highwing it works.', ['shortcuts', ...SHORTCUTS.map(({ id }) => `key:${id}`)]],
    ['usage', 'Usage', 'What this Hermes reports of its use.', ['usage']],
    ['about', 'About', 'The versions of Highwing and of the Hermes it talks to.', ['about-app', 'about-hermes']]
  ] as const)('shows the %s page alone, untitled, under its own heading and lede', (page, heading, lede, rows) => {
    const view = settingsViewOf(page, '', 'idle')
    expect(view).toMatchObject({ heading, lede, pages: [page], titlesPages: false, emptyAdvice: null, announcement: null, current: page })
    expect([...view.rows]).toEqual(rows)
    expect(view.hits.size).toBe(0)
    expect(view.hiddenCheck).toBeNull()
  })

  it('treats a query of only spaces as no search', () => {
    expect(settingsViewOf('appearance', '   ', 'idle')).toEqual(settingsViewOf('appearance', '', 'idle'))
  })
})

describe('settingsViewOf with a search', () => {
  it('finds the theme from any page by a word only its keywords hold, under its page name', () => {
    const view = settingsViewOf('keys', 'dark', 'idle')
    expect(view).toMatchObject({ heading: 'Search results', lede: 'Settings that match “dark”.', pages: ['appearance'], titlesPages: true, current: null, emptyAdvice: null, announcement: '1 setting found for “dark”' })
    expect([...view.rows]).toEqual(['theme'])
    expect([...view.hits]).toEqual([['appearance', 1]])
  })

  it.each(['add a server', 'way in', 'fastest', 'in order', 'move up', 'servers', 'LAN', 'ssh destination'])('finds the Connection page by "%s", the words of its servers and ways', query => {
    const view = settingsViewOf('appearance', query, 'idle')
    expect(view.pages).toContain('connection')
    expect(view.rows.has('connection')).toBe(true)
  })

  it('ignores case and the spaces around the query', () => {
    const view = settingsViewOf('connection', '  BOTS ', 'idle')
    expect(view.lede).toBe('Settings that match “BOTS”.')
    expect([...view.rows]).toEqual(['sidebar'])
  })

  it('shows only the matching rows of a page, not its whole card', () => {
    const view = settingsViewOf('connection', 'palette', 'idle')
    expect(view.pages).toEqual(['keys'])
    expect([...view.rows]).toEqual(['key:palette'])
  })

  it('lists matches from several pages in page order', () => {
    const view = settingsViewOf('keys', 'sidebar', 'idle')
    expect(view.pages).toEqual(['appearance', 'keys'])
    expect([...view.rows]).toEqual(['sidebar', 'key:compactSidebar'])
    expect(view.announcement).toBe('2 settings found for “sidebar”')
    expect([...view.hits]).toEqual([['appearance', 1], ['keys', 1]])
  })

  it.each([
    ['dark mode', ['theme']],
    ['plum tint', ['accent']],
    ['find chat', ['key:find']],
    ['change address', ['connection']],
    ['gateway address', ['connection']],
    ['Ctrl+K', ['key:palette']],
    ['⌘F', ['key:find']],
    ['ctrl f', ['key:find']],
    ['Ctrl K', ['key:palette']],
    ['Ctrl + K', ['key:palette']],
    ['Cmd N', ['key:newChat', 'key:newGroup']],
    ['ctrl', ['send-key', 'shortcuts', ...KEYED]],
    ["computer's light", ['theme']],
    ['command p', ['key:palette']],
    ['Ctrl+', ['send-key', ...KEYED]],
    ['ctrl +', ['send-key', ...KEYED]],
    ['cmd', ['send-key', 'shortcuts', ...KEYED]],
    ['command', ['font-terminal', 'send-key', 'permissions', 'allowed', 'denied', 'add-rule', 'shortcuts', ...KEYED]],
    ['control', ['send-key', 'shortcuts', ...KEYED]],
    ['Ctrl+,', ['key:settings']],
    ['ctrl /', ['key:sheet']],
    ['Ctrl 3', ['key:bot']],
    ['ctrl tab', ['key:cycleBot', 'key:cycleBotBack']],
    ['alt up', ['key:previousBot']],
    ['Ctrl+Z', []],
    ['Ctrl C', []],
    ['command  p', ['key:palette']],
    ['Ctrl S', []],
    ['ctrl a', []],
    ['⌘ s', []],
    ['tray', ['on-close']],
    ['ctrl enter', ['send-key', 'key:send']],
    ['spelling', ['spell-check']],
    ['scheduled', ['notice-jobs']],
    ['bitwarden', ['passwords']],
    ['backup model', ['models']],
    ['no backup', ['models']],
    ['default model', ['models']],
    ['LLM provider', ['models']],
    ['fallback', ['connection', 'models']],
    ['failover', ['connection', 'models']],
    ['approved', ['permissions']],
    ['approvals.deny', ['denied']],
    ['allowlist', ['allowed']],
    ['remove rule', ['allowed', 'denied']],
    ['add a rule', ['add-rule']],
    ['yolo', ['permissions', 'denied']],
    ['show all', ['show-work', 'shortcuts']],
    ['version', ['about-app', 'about-hermes']],
    ['font', ['font-interface', 'font-prompt', 'font-code', 'font-terminal']],
    ['typeface', ['font-interface', 'font-prompt', 'font-code', 'font-terminal']],
    ['monospace code', ['font-code']],
    ['terminal size', ['font-terminal']],
    ['wrap long', ['font-code', 'font-terminal']],
    ['width', ['chat-width']],
    ['wide', ['chat-width']],
    ['contrast', ['contrast']],
    ['math', ['math']],
    ['latex', ['math']],
    ['animation', ['show-work', 'motion']],
    ['motion', ['motion']]
  ] as const)('finds %j by each of its words, wherever they sit in a row', (query, rows) => {
    expect([...settingsViewOf('appearance', query, 'idle').rows]).toEqual(rows)
  })

  it('matches every row of a page by the page name', () => {
    expect([...settingsViewOf('connection', 'keyboard', 'idle').rows]).toEqual(ROWS.filter(row => row.page === 'keys').map(row => row.id))
  })

  it.each(['zzz', 'skills'])('shows nothing and says so when no setting matches %j', query => {
    const view = settingsViewOf('connection', query, 'idle')
    expect(view).toMatchObject({ heading: 'Search results', lede: `No settings match “${query}”.`, pages: [], emptyAdvice: 'Try another word, such as theme, keys or address.', announcement: `No settings match “${query}”.`, current: null })
    expect(view.rows.size).toBe(0)
    expect(view.hits.size).toBe(0)
  })
})

describe('settingsViewOf while a connection check runs or has failed', () => {
  it.each([
    ['checking', 'Highwing is checking the new connection.'],
    ['failed', 'The new connection failed its check.']
  ] as const)('tells of a %s check from a page that hides the connection card', (check, words) => {
    expect(settingsViewOf('appearance', '', check).hiddenCheck).toBe(words)
    expect(settingsViewOf('connection', 'theme', check).hiddenCheck).toBe(words)
  })

  it('says nothing more where the connection card itself shows', () => {
    expect(settingsViewOf('connection', '', 'failed').hiddenCheck).toBeNull()
    expect(settingsViewOf('keys', 'tailscale', 'checking').hiddenCheck).toBeNull()
  })
})
