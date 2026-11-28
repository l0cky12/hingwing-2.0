import { describe, expect, it } from 'vitest'
import type { AppsBoard } from '../src/domain/apps'
import { connectorsView, type ConnectorCard, type ConnectorsView } from '../src/domain/connectors'
import type { ToolServer } from '../src/domain/tool-servers'

const BOARD: AppsBoard = {
  apps: [
    { slug: 'slack', name: 'Slack', description: 'Channels and direct messages.', category: 'Chat', logo: null, account: { connectionId: 'slack-1', standing: 'connected', label: 'Work' } },
    { slug: 'github', name: 'GitHub', description: 'Repositories, issues and pull requests.', category: 'Recommended', logo: null, account: null },
    { slug: 'notion', name: 'Notion', description: 'Pages and databases.', category: 'Notes', logo: null, account: { connectionId: 'notion-1', standing: 'needs-sign-in', label: 'Notes' } },
    { slug: 'linear', name: 'Linear', description: 'Issues.', category: 'Work', logo: null, account: null }
  ]
}
const SERVERS: readonly ToolServer[] = [
  { name: 'github', where: 'https://api.githubcopilot.com/mcp/', state: 'connected', tools: 41, removable: true },
  { name: 'browser', where: 'npx -y @playwright/mcp', state: 'idle', tools: 0, removable: false }
]

const named = (card: ConnectorCard) => `${card.kind}:${card.kind === 'app' ? card.app.slug : card.server.name}`
const shelves = (view: ConnectorsView) => view.sections.map(section => [section.shelf, section.cards.map(named)])

describe('connectorsView', () => {
  it('puts apps with an account and every tool server under Added, and apps with none under Available, Recommended first', () => {
    const view = connectorsView(BOARD, SERVERS, { text: '', filter: 'all' })
    expect(shelves(view)).toEqual([
      ['added', ['app:slack', 'app:notion', 'server:github', 'server:browser']],
      ['available', ['app:github', 'app:linear']]
    ])
    expect(view).toMatchObject({ total: 6, counts: { all: 6, added: 4, available: 2 } })
  })

  it('shows one shelf for its filter, and keeps every count', () => {
    expect(shelves(connectorsView(BOARD, SERVERS, { text: '', filter: 'added' })).map(([shelf]) => shelf)).toEqual(['added'])
    const available = connectorsView(BOARD, SERVERS, { text: '', filter: 'available' })
    expect(shelves(available)).toEqual([['available', ['app:github', 'app:linear']]])
    expect(available.counts).toEqual({ all: 6, added: 4, available: 2 })
  })

  it('matches an app or a server by name and counts only the matches, while the total stays whole', () => {
    const view = connectorsView(BOARD, SERVERS, { text: ' GIT ', filter: 'all' })
    expect(shelves(view)).toEqual([['added', ['server:github']], ['available', ['app:github']]])
    expect(view).toMatchObject({ total: 6, counts: { all: 2, added: 1, available: 1 } })
  })

  it('leaves out a shelf with no card, and shows the servers alone when Hermes listed no apps', () => {
    expect(connectorsView(BOARD, SERVERS, { text: 'zzz', filter: 'all' })).toEqual({ total: 6, counts: { all: 0, added: 0, available: 0 }, sections: [] })
    expect(shelves(connectorsView(null, SERVERS, { text: '', filter: 'all' }))).toEqual([['added', ['server:github', 'server:browser']]])
    expect(connectorsView(null, [], { text: '', filter: 'all' })).toEqual({ total: 0, counts: { all: 0, added: 0, available: 0 }, sections: [] })
  })
})
