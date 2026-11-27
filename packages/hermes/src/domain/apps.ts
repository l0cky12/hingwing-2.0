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
