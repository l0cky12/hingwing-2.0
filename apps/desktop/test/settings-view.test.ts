import { describe, expect, it } from 'vitest'
import { ROWS, settingsViewOf } from '../src/renderer/setup/settings-view'
import { SHORTCUTS } from '../src/renderer/shortcuts'

const KEYED = SHORTCUTS.filter(({ mod }) => mod !== 'alt').map(({ id }) => `key:${id}`)

describe('settingsViewOf with no search', () => {
  it.each([
    ['connection', 'Connection', 'The Hermes this app talks to, and how it reaches it.', ['connection']],
    ['appearance', 'Appearance', 'How Highwing looks and what its sidebar shows.', ['theme', 'sidebar']],
    ['window', 'Window', 'What closing Highwing’s window does.', ['on-close']],
    ['notifications', 'Notifications', 'Which desktop notifications Highwing shows.', ['notice-asks', 'notice-replies', 'notice-jobs']],
    ['passwords', 'Password managers', 'The 1Password and Bitwarden logins each bot can use.', ['passwords']],
    ['skills', 'Skills', 'The skills the open bot can use, and which of them are on.', ['skills']],
    ['permissions', 'Permissions', 'How Hermes asks before it runs a command.', ['permissions', 'denied']],
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
    ['find chat', ['key:find']],
    ['change address', ['connection']],
    ['gateway address', ['connection']],
    ['Ctrl+K', ['key:palette']],
    ['⌘F', ['key:find']],
    ['ctrl f', ['key:find']],
    ['Ctrl K', ['key:palette']],
    ['Ctrl + K', ['key:palette']],
    ['Cmd N', ['key:newChat', 'key:newGroup']],
    ['ctrl', KEYED],
    ["computer's light", ['theme']],
    ['command p', ['key:palette']],
    ['Ctrl+', KEYED],
    ['ctrl +', KEYED],
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
    ['scheduled', ['notice-jobs']],
    ['bitwarden', ['passwords']],
    ['approved', ['permissions']],
    ['approvals.deny', ['denied']],
    ['yolo', ['permissions', 'denied']],
    ['skill.md', ['skills']],
    ['show all', ['shortcuts']],
    ['version', ['about-app', 'about-hermes']]
  ] as const)('finds %j by each of its words, wherever they sit in a row', (query, rows) => {
    expect([...settingsViewOf('appearance', query, 'idle').rows]).toEqual(rows)
  })

  it('matches every row of a page by the page name', () => {
    expect([...settingsViewOf('connection', 'keyboard', 'idle').rows]).toEqual(ROWS.filter(row => row.page === 'keys').map(row => row.id))
  })

  it('shows nothing and says so when no setting matches', () => {
    const view = settingsViewOf('connection', 'zzz', 'idle')
    expect(view).toMatchObject({ heading: 'Search results', lede: 'No settings match “zzz”.', pages: [], emptyAdvice: 'Try another word, such as theme, keys or address.', announcement: 'No settings match “zzz”.', current: null })
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
