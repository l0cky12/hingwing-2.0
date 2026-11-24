import { rosterOf, type Bots, type Roster } from './domain/bots'
import type { BotChats } from './domain/open'
import type { Link } from './domain/session'
import { Offline, RpcRefusal, type Connection } from './wire/link'
import { parseBots } from './wire/parse'

type News =
  | { readonly is: 'online' }
  | { readonly is: 'offline' }
  | { readonly is: 'listed'; readonly roster: Roster }
  | { readonly is: 'unsupported' }
  | { readonly is: 'refused' }

const LOADING: Bots = { state: 'loading' }

function after(bots: Bots, news: News): Bots {
  switch (news.is) {
    case 'online': return bots.state === 'offline' ? LOADING : bots
    case 'offline': return bots.state === 'loading' ? { state: 'offline' } : bots
    case 'listed': return { state: 'listed', roster: news.roster }
    case 'unsupported': return { state: 'unsupported' }
    case 'refused': return bots.state === 'loading' ? { state: 'refused' } : bots
  }
}

const LINK_NEWS: { readonly [S in Link['state']]: 'online' | 'offline' | null } = { connecting: null, online: 'online', waiting: 'offline', blocked: 'offline' }

const METHOD_NOT_FOUND = -32601
/** Hermes reads every profile's newest session for this call, so a slow disk can stall it. */
const ROSTER_TIMEOUT_MS = 10_000

const same = (a: Bots, b: Bots): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)

export interface BotList {
  readonly bots: Bots
  /** The Bot Chat Hermes last named for each bot that has one. */
  readonly chats: BotChats
  linked(state: Link['state']): void
  /** Asks Hermes for its bots. For a new socket: whatever the last one said, this Hermes may know more. */
  ask(): void
  /** Sessions changed, so a preview may have. Asks again, except of a Hermes that has no `profiles.list`. */
  refresh(): void
}

/**
 * Owns what Highwing knows about the bots. Hermes sends no "profiles changed" event, so the hub
 * says when to ask. `changed` runs after every change of `bots` or `chats`, and never for an answer
 * that changed neither. One ask is in flight at a time, and asking during it runs one more after it.
 */
export function botList(conn: Pick<Connection, 'call'>, changed: () => void): BotList {
  let bots = LOADING
  let chats: BotChats = {}
  let asking = false
  let again = false

  const take = (news: News, named: BotChats = chats) => {
    const next = after(bots, news)
    if (same(next, bots) && JSON.stringify(named) === JSON.stringify(chats)) return
    bots = next
    chats = named
    changed()
  }

  const fetch = async () => {
    asking = true
    try {
      const facts = parseBots(await conn.call('profiles.list', { include_sessions: true }, ROSTER_TIMEOUT_MS))
      take({ is: 'listed', roster: rosterOf(facts) }, Object.fromEntries(facts.flatMap(bot => (bot.chat === null ? [] : [[bot.id, bot.chat]]))))
    } catch (error) {
      if (error instanceof RpcRefusal) take({ is: error.code === METHOD_NOT_FOUND ? 'unsupported' : 'refused' })
      else if (!(error instanceof Offline)) throw error
    } finally {
      asking = false
    }
    if (again) {
      again = false
      refresh()
    }
  }

  const ask = () => {
    if (asking) again = true
    else void fetch()
  }
  const refresh = () => {
    if (bots.state !== 'unsupported') ask()
  }

  return {
    get bots() { return bots },
    get chats() { return chats },
    linked: state => {
      const is = LINK_NEWS[state]
      if (is !== null) take({ is })
    },
    ask,
    refresh
  }
}
