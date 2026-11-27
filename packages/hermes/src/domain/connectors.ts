import { RECOMMENDED, type AppEntry, type AppsBoard } from './apps'
import type { ToolServer } from './tool-servers'

export type ConnectorCard =
  | { readonly kind: 'app'; readonly app: AppEntry }
  | { readonly kind: 'server'; readonly server: ToolServer }

export const CONNECTOR_FILTERS = ['all', 'added', 'available'] as const
export type ConnectorFilter = typeof CONNECTOR_FILTERS[number]

export interface ConnectorsQuery {
  /** Substring of the card's name. Empty matches every name. */
  readonly text: string
  readonly filter: ConnectorFilter
}

/** `added`: an app with an account, whatever its standing, and every tool server. `available`: an app with no account. */
export type ConnectorShelf = 'added' | 'available'

export interface ConnectorsSection {
  readonly shelf: ConnectorShelf
  readonly cards: readonly ConnectorCard[]
}

export interface ConnectorsView {
  /** Every card, whatever the query. */
  readonly total: number
  /** The cards each filter shows for the query's text. */
  readonly counts: { readonly [F in ConnectorFilter]: number }
  /** Only shelves with a card, Added first. */
  readonly sections: readonly ConnectorsSection[]
}

const shelfOf = (card: ConnectorCard): ConnectorShelf => (card.kind === 'server' || card.app.account !== null ? 'added' : 'available')
const nameOf = (card: ConnectorCard) => (card.kind === 'app' ? card.app.name : card.server.name)
const recommendedFirst = (apps: readonly AppEntry[]) => [...apps.filter(app => app.category === RECOMMENDED), ...apps.filter(app => app.category !== RECOMMENDED)]

/** `board` null: Hermes listed no apps, so only the tool servers show. */
export function connectorsView(board: AppsBoard | null, servers: readonly ToolServer[], query: ConnectorsQuery): ConnectorsView {
  const cards: readonly ConnectorCard[] = [
    ...recommendedFirst(board?.apps ?? []).map(app => ({ kind: 'app' as const, app })),
    ...servers.map(server => ({ kind: 'server' as const, server }))
  ]
  const text = query.text.trim().toLowerCase()
  const named = cards.filter(card => nameOf(card).toLowerCase().includes(text))
  const on = (shelf: ConnectorShelf) => named.filter(card => shelfOf(card) === shelf)
  const added = on('added')
  const available = on('available')
  const sections: ConnectorsSection[] = []
  if (query.filter !== 'available' && added.length > 0) sections.push({ shelf: 'added', cards: added })
  if (query.filter !== 'added' && available.length > 0) sections.push({ shelf: 'available', cards: available })
  return { total: cards.length, counts: { all: named.length, added: added.length, available: available.length }, sections }
}
