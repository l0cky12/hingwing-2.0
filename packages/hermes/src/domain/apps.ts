export type AppStanding = 'connected' | 'needs-sign-in' | 'disconnected'

export interface AppAccount {
  readonly connectionId: string
  readonly standing: AppStanding
  readonly label: string
}

export interface AppEntry {
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly category: string
  readonly account: AppAccount | null
}

export interface AppsBoard {
  readonly apps: readonly AppEntry[]
}

export const RECOMMENDED = 'Recommended'

/** Hermes account status, as `ConnectorAccountStatus`, in the window's three words. */
export const standingOf = (status: string): AppStanding =>
  status === 'active' ? 'connected'
  : status === 'expired' || status === 'failed' || status === 'revoked' ? 'needs-sign-in'
  : 'disconnected'

/** A settled sign-in target's state, in the same three words. */
export const standingOfTarget = (state: string): AppStanding =>
  state === 'connected' ? 'connected'
  : state === 'failed' || state === 'expired' ? 'needs-sign-in'
  : 'disconnected'

export const STANDING_WORDS: { readonly [S in AppStanding]: string } = {
  connected: 'Connected',
  'needs-sign-in': 'Needs sign-in again',
  disconnected: 'Disconnected'
}

export interface AppsQuery {
  /** Substring of the app's name. Empty matches every name. */
  readonly text: string
  /** A category chip. null is All. */
  readonly category: string | null
}

export interface AppsSection {
  readonly heading: string
  readonly apps: readonly AppEntry[]
}

export interface AppsView {
  readonly summary: string
  readonly categories: readonly string[]
  readonly sections: readonly AppsSection[]
  readonly empty: boolean
}

export interface AppSignIn {
  readonly opId: string
  readonly settled: boolean
  readonly url: string | null
  readonly standing: AppStanding | null
}

const RANK: { readonly [S in AppStanding]: number } = { connected: 0, 'needs-sign-in': 1, disconnected: 2 }

/** The account the row's Reconnect and Remove act on. A better standing wins. The first of a tie stays. */
export const betterAccount = (held: AppAccount | null, next: AppAccount): AppAccount =>
  held !== null && RANK[held.standing] <= RANK[next.standing] ? held : next

const summaryOf = (board: AppsBoard): string => {
  const connected = board.apps.filter(app => app.account?.standing === 'connected').length
  return connected === 0 ? 'None connected' : connected === 1 ? '1 connected' : `${connected} connected`
}

const named = (app: AppEntry, text: string) => app.name.toLowerCase().includes(text.trim().toLowerCase())

export function appsView(board: AppsBoard, query: AppsQuery): AppsView {
  const categories: string[] = []
  for (const app of board.apps) if (!categories.includes(app.category)) categories.push(app.category)
  const shown = board.apps.filter(app => (query.category === null || app.category === query.category) && named(app, query.text))
  const sections: AppsSection[] = []
  const add = (heading: string, apps: readonly AppEntry[]) => {
    if (apps.length > 0) sections.push({ heading, apps })
  }
  if (query.category === null) {
    add(RECOMMENDED, shown.filter(app => app.category === RECOMMENDED))
    for (const category of categories) if (category !== RECOMMENDED) add(category, shown.filter(app => app.category === category))
  } else add(query.category, shown)
  return { summary: summaryOf(board), categories, sections, empty: shown.length === 0 }
}
