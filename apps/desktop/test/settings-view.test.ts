import { describe, expect, it } from 'vitest'
import { settingsViewOf } from '../src/renderer/setup/settings-view'

describe('settingsViewOf with no search', () => {
  it.each([
    ['connection', 'Connection', 'The Hermes this app talks to, and how it reaches it.', ['connection']],
    ['appearance', 'Appearance', 'How Highwing looks and what its sidebar shows.', ['theme', 'sidebar']],
    ['keys', 'Keyboard shortcuts', 'Each shortcut, and where in Highwing it works.', ['palette', 'new-chat', 'find']]
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
    expect([...view.rows]).toEqual(['palette'])
  })

  it('lists matches from several pages in page order', () => {
    const view = settingsViewOf('keys', 'chat', 'idle')
    expect(view.pages).toEqual(['appearance', 'keys'])
    expect([...view.rows]).toEqual(['sidebar', 'new-chat', 'find'])
    expect(view.announcement).toBe('3 settings found for “chat”')
    expect([...view.hits]).toEqual([['appearance', 1], ['keys', 2]])
  })

  it.each([
    ['dark mode', ['theme']],
    ['find chat', ['find']],
    ['change address', ['connection']],
    ['gateway address', ['connection']],
    ['Ctrl+K', ['palette']],
    ['⌘F', ['find']],
    ['ctrl f', ['find']],
    ['Ctrl K', ['palette']],
    ['Ctrl + K', ['palette']],
    ['Cmd N', ['new-chat']],
    ['ctrl', ['palette', 'new-chat', 'find']],
    ["computer's light", ['theme']],
    ['command p', ['palette']],
    ['Ctrl+', ['palette', 'new-chat', 'find']],
    ['ctrl +', ['palette', 'new-chat', 'find']],
    ['Ctrl+Z', []],
    ['Ctrl C', []],
    ['command  p', ['palette']],
    ['Ctrl S', []],
    ['ctrl a', []],
    ['⌘ s', []]
  ] as const)('finds %j by each of its words, wherever they sit in a row', (query, rows) => {
    expect([...settingsViewOf('appearance', query, 'idle').rows]).toEqual(rows)
  })

  it('matches every row of a page by the page name', () => {
    expect([...settingsViewOf('connection', 'keyboard', 'idle').rows]).toEqual(['palette', 'new-chat', 'find'])
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
