import { rosterOf, type BotFacts, type BotFlag, type BotId, type Bots } from './domain/bots'
import type { BotChats } from './domain/open'
import type { Link } from './domain/session'
import { METHOD_NOT_FOUND, Offline, RpcRefusal, type Connection } from './wire/link'
import { parseBots } from './wire/parse'

type News =
  | { readonly is: 'online' }
  | { readonly is: 'offline' }
  | { readonly is: 'listed'; readonly facts: readonly BotFacts[] }
  | { readonly is: 'unsupported' }
  | { readonly is: 'refused' }

type Held =
  | { readonly state: 'loading' | 'offline' | 'unsupported' | 'refused' }
  | { readonly state: 'listed'; readonly facts: readonly BotFacts[] }

const LOADING: { readonly state: 'loading' } = { state: 'loading' }

function after(held: Held, news: News): Held {
  switch (news.is) {
    case 'online': return held.state === 'offline' ? LOADING : held
    case 'offline': return held.state === 'loading' ? { state: 'offline' } : held
    case 'listed': return { state: 'listed', facts: news.facts }
    case 'unsupported': return { state: 'unsupported' }
    case 'refused': return held.state === 'loading' ? { state: 'refused' } : held
  }
}

const LINK_NEWS: { readonly [S in Link['state']]: 'online' | 'offline' | null } = { connecting: null, online: 'online', waiting: 'offline', blocked: 'offline' }

/** Hermes reads every profile's newest session for this call, so a slow disk can stall it. */
const ROSTER_TIMEOUT_MS = 10_000

const chatsOf = (facts: readonly BotFacts[]): BotChats => Object.fromEntries(facts.flatMap(bot => (bot.chat === null ? [] : [[bot.id, bot.chat]])))
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

export interface BotList {
  readonly bots: Bots
  /** The Bot Chat Hermes last named for each bot that has one. */
  readonly chats: BotChats
  linked(state: Link['state']): void
  /** Asks Hermes for its bots. For a new socket: whatever the last one said, this Hermes may know more. */
  ask(): void
  /** Sessions changed, so a preview may have. Asks again, except of a Hermes that has no `profiles.list`. */
  refresh(): void
  confirm(bot: BotId, set: { readonly flag: BotFlag; readonly on: boolean }): number
}

/**
 * Owns what Highwing knows about the bots. Hermes sends no "profiles changed" event, so the hub
 * says when to ask. `changed` runs after every change of `bots` or `chats`, and never for an answer
 * that changed neither. One ask is in flight at a time, and asking during it runs one more after it.
 */
export function botList(conn: Pick<Connection, 'call'>, changed: () => void): BotList {
  let held: Held = LOADING
  let bots: Bots = LOADING
  let chats: BotChats = {}
  let edition = 0
  let writes = 0
  let asking = false
  let again = false

  const take = (next: Held) => {
    const drawn: Bots = next.state === 'listed' ? { state: 'listed', roster: rosterOf(next.facts), edition } : next
    const named = next.state === 'listed' ? chatsOf(next.facts) : chats
    held = next
    const moved = !same(drawn, bots)
    if (!moved && same(named, chats)) return
    if (moved) bots = drawn.state === 'listed' ? { ...drawn, edition: ++edition } : drawn
    chats = named
    changed()
  }

  const fetch = async () => {
    asking = true
    const began = writes
    try {
      const facts = parseBots(await conn.call('profiles.list', { include_sessions: true }, ROSTER_TIMEOUT_MS))
      if (began === writes) take(after(held, { is: 'listed', facts }))
      else again = true
    } catch (error) {
      if (error instanceof RpcRefusal) take(after(held, { is: error.code === METHOD_NOT_FOUND ? 'unsupported' : 'refused' }))
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
    if (held.state !== 'unsupported') ask()
  }

  return {
    get bots() { return bots },
    get chats() { return chats },
    linked: state => {
      const is = LINK_NEWS[state]
      if (is !== null) take(after(held, { is }))
    },
    ask,
    refresh,
    confirm: (bot, { flag, on }) => {
      writes++
      if (held.state === 'listed') take({ state: 'listed', facts: held.facts.map(fact => (fact.id === bot ? { ...fact, [flag]: on } : fact)) })
      ask()
      return edition
    }
  }
}
