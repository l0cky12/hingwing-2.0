import { describe, expect, it } from 'vitest'
import { betterAccount, standingOf, standingOfTarget } from '../src/domain/apps'
import { parseApps, parseSignIn } from '../src/wire/parse'

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
