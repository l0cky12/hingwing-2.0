import type { BotManagers, CommandOutcome, Link, ManagerState } from '@highwing/hermes/domain'

export type Read =
  | { readonly at: 'reading' }
  | { readonly at: 'read'; readonly managers: BotManagers }
  | { readonly at: 'refused'; readonly words: string; readonly unsupported: boolean }

export type SectionView =
  | { readonly show: 'note'; readonly words: string }
  | { readonly show: 'reading' }
  | { readonly show: 'failed'; readonly words: string }
  | { readonly show: 'managers'; readonly managers: BotManagers }

export const NOT_CONNECTED = 'Connect to Hermes to set up password managers.'
export const NO_BOT = 'Hermes has no bots to set up yet.'
export const NONE_LISTED = 'This Hermes lists no password managers.'

export const readOf = (outcome: CommandOutcome<BotManagers>): Read =>
  outcome.ok ? { at: 'read', managers: outcome.value } : { at: 'refused', words: outcome.refusal.message, unsupported: outcome.refusal.kind === 'unsupported' }

export function sectionOf(link: Link | undefined, hasBot: boolean, read: Read): SectionView {
  if (link?.state !== 'online') return { show: 'note', words: NOT_CONNECTED }
  if (!hasBot) return { show: 'note', words: NO_BOT }
  if (read.at === 'reading') return { show: 'reading' }
  if (read.at === 'refused') return read.unsupported ? { show: 'note', words: read.words } : { show: 'failed', words: read.words }
  return read.managers.managers.length === 0 ? { show: 'note', words: NONE_LISTED } : { show: 'managers', managers: read.managers }
}

export type Tone = 'quiet' | 'caution' | 'signal'

export const STATES: { readonly [S in ManagerState['at']]: { readonly badge: string; readonly tone: Tone; readonly says: (state: Extract<ManagerState, { at: S }>, bot: string) => string } } = {
  missing: { badge: 'Not installed', tone: 'quiet', says: () => 'Not installed on the Hermes machine.' },
  off: { badge: 'Off', tone: 'quiet', says: (_, bot) => `Off for ${bot}.` },
  locked: { badge: 'Locked', tone: 'caution', says: (_, bot) => `Unlock it so ${bot} can use its logins.` },
  ready: {
    badge: 'Unlocked', tone: 'signal',
    says: ({ logins }, bot) => (logins === null ? "Unlocked, but Hermes couldn't list its logins." : `Unlocked · ${logins} ${logins === 1 ? 'login' : 'logins'} ${bot} can use`)
  }
}

export const saysOf = (state: ManagerState, bot: string): string => (STATES[state.at].says as (state: ManagerState, bot: string) => string)(state, bot)

export const stillUnlocked = (label: string, bot: string): string => `${label} stays unlocked while ${bot} has a service account token. Stop using turns it off for ${bot}.`
