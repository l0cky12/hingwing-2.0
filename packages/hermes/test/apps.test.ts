import { describe, expect, it } from 'vitest'
import { appsView, betterAccount, standingOf, standingOfTarget, RECOMMENDED, type AppsBoard } from '../src/domain/apps'
import { parseApps, parseSignIn } from '../src/wire/parse'

const BOARD: AppsBoard = {
  apps: [
    { slug: 'github', name: 'GitHub', description: 'Repositories, issues and pull requests.', category: 'Recommended', account: null },
    { slug: 'slack', name: 'Slack', description: 'Channels and direct messages.', category: 'Chat', account: { connectionId: 'slack-1', standing: 'connected', label: 'Work' } },
    { slug: 'notion', name: 'Notion', description: 'Pages and databases.', category: 'Notes', account: { connectionId: 'notion-1', standing: 'needs-sign-in', label: 'Notes' } }
  ]
}

describe('appsView', () => {
  it('lifts Recommended above the other categories and counts the whole board', () => {
    const view = appsView(BOARD, { text: '', category: null })
    expect(view.summary).toBe('1 connected')
    expect(view.categories).toEqual(['Recommended', 'Chat', 'Notes'])
    expect(view.sections.map(section => section.heading)).toEqual(['Recommended', 'Chat', 'Notes'])
    expect(view.sections[0]?.apps.map(app => app.slug)).toEqual(['github'])
    expect(view.empty).toBe(false)
  })

  it('filters by the app name and still lists every category', () => {
    const view = appsView(BOARD, { text: ' git ', category: null })
    expect(view.categories).toEqual(['Recommended', 'Chat', 'Notes'])
    expect(view.sections.map(section => section.apps.map(app => app.name))).toEqual([['GitHub']])
  })

  it('shows one category and hides the recommended section', () => {
    const view = appsView(BOARD, { text: '', category: 'Chat' })
    expect(view.sections).toEqual([{ heading: 'Chat', apps: [BOARD.apps[1]] }])
  })

  it('keeps the recommended section when that chip is selected', () => {
    const view = appsView(BOARD, { text: '', category: RECOMMENDED })
    expect(view.sections.map(section => section.heading)).toEqual([RECOMMENDED])
  })

  it('says when nothing matches, and when the catalog is empty', () => {
    expect(appsView(BOARD, { text: 'zzz', category: null }).empty).toBe(true)
    expect(appsView({ apps: [] }, { text: '', category: null })).toMatchObject({ summary: 'None connected', categories: [], sections: [], empty: true })
    expect(appsView({ apps: [BOARD.apps[0]!, BOARD.apps[1]!] }, { text: '', category: null }).summary).toBe('1 connected')
    const both = { apps: [BOARD.apps[1]!, { ...BOARD.apps[1]!, slug: 'slack-2', name: 'Slack two' }] }
    expect(appsView(both, { text: '', category: null }).summary).toBe('2 connected')
  })
})

describe('standing', () => {
  it('uses the three words the window shows', () => {
    expect(standingOf('active')).toBe('connected')
    expect(standingOf('expired')).toBe('needs-sign-in')
    expect(standingOf('failed')).toBe('needs-sign-in')
    expect(standingOf('revoked')).toBe('needs-sign-in')
    expect(standingOf('pending')).toBe('disconnected')
    expect(standingOfTarget('connected')).toBe('connected')
    expect(standingOfTarget('expired')).toBe('needs-sign-in')
    expect(standingOfTarget('initiated')).toBe('disconnected')
  })

  it('keeps the better account', () => {
    const connected = { connectionId: 'a', standing: 'connected' as const, label: 'A' }
    const again = { connectionId: 'b', standing: 'needs-sign-in' as const, label: 'B' }
    expect(betterAccount(null, again)).toBe(again)
    expect(betterAccount(connected, again)).toBe(connected)
    expect(betterAccount(again, connected)).toBe(connected)
  })
})

describe('parseApps', () => {
  const catalog = {
    connectors: [
      { slug: 'github', name: 'GitHub', description: 'Repos.', category: 'Recommended' },
      { slug: 'slack', name: 'Slack', description: 'Chat.', category: 'Chat' },
      { slug: ' ', name: 'Blank', description: 'No.', category: 'Chat' },
      { slug: 'github', name: 'GitHub again', description: 'Dup.', category: 'Recommended' }
    ]
  }
  const accounts = {
    accounts: [
      { connection_id: 'slack-old', connector: 'slack', status: 'expired', label: 'Old' },
      { connection_id: 'slack-1', connector: 'slack', status: 'active', label: 'Work' },
      { connection_id: 'other', connector: 'missing', status: 'active', label: 'No' }
    ]
  }

  it('keeps one account per catalog app and drops a blank or repeated slug', () => {
    expect(parseApps(catalog, accounts).apps).toEqual([
      { slug: 'github', name: 'GitHub', description: 'Repos.', category: 'Recommended', account: null },
      { slug: 'slack', name: 'Slack', description: 'Chat.', category: 'Chat', account: { connectionId: 'slack-1', standing: 'connected', label: 'Work' } }
    ])
    expect(parseApps(null, null)).toEqual({ apps: [] })
  })

  it('keeps an app whose description or category is empty, and a connected account whose label is empty', () => {
    const catalog = {
      connectors: [
        { slug: 'github', name: 'GitHub', description: '', category: '' },
        { slug: 'slack', name: 'Slack', description: '   ', category: 'Chat' }
      ]
    }
    const accounts = {
      accounts: [
        { connection_id: 'gh-1', connector: 'github', status: 'active', label: '' },
        { connection_id: 'slack-1', connector: 'slack', status: 'active', label: '   ' }
      ]
    }
    expect(parseApps(catalog, accounts).apps).toEqual([
      { slug: 'github', name: 'GitHub', description: '', category: 'Other', account: { connectionId: 'gh-1', standing: 'connected', label: 'GitHub' } },
      { slug: 'slack', name: 'Slack', description: '', category: 'Chat', account: { connectionId: 'slack-1', standing: 'connected', label: 'Slack' } }
    ])
  })

  it('reads a sign-in when it has settled, and only an http(s) page', () => {
    expect(parseSignIn({
      op_id: 'op-1', settled: false,
      targets: [{ state: 'initiated', connect_url: 'https://example.com/connect/github' }]
    })).toEqual({ opId: 'op-1', settled: false, url: 'https://example.com/connect/github', standing: null })
    expect(parseSignIn({
      op_id: 'op-1', settled: true,
      targets: [{ state: 'connected', connect_url: 'javascript:alert(1)' }]
    })).toEqual({ opId: 'op-1', settled: true, url: null, standing: 'connected' })
    expect(parseSignIn(null)).toEqual({ opId: '', settled: false, url: null, standing: null })
  })
})
