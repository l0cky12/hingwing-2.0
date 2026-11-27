import { createHash } from 'node:crypto'
import { DONE, refused } from './actor'
import type { BotId } from './domain/bots'
import type { Outcome } from './domain/command'
import { controlOf, newerLease, type Lease, type Screen, type ScreenFacts, type ScreenView } from './domain/screen'
import { NOT_CONNECTED } from './open'
import { Offline, RpcRefusal, type Calls, type Clock, type Connection } from './wire/link'
import { parseLease, parseObserved, parseScreenFacts, parseThumbnail } from './wire/parse'

/** How often the open chat's bot is asked for a new frame of its screen while the agent uses it. */
export const THUMBNAIL_MS = 2_000

type Held = { readonly state: 'asking' } | { readonly state: 'unavailable' } | { readonly state: 'known'; readonly facts: ScreenFacts }

const ASKING: Held = { state: 'asking' }
const UNAVAILABLE: Held = { state: 'unavailable' }
const OFF: Screen = { state: 'off' }

/** Hermes names the holder of a lease by the first 12 hex digits of the SHA-256 of its viewer id (tools/bot_desktop/lease.py). */
const hashOf = (viewerId: string) => createHash('sha256').update(viewerId).digest('hex').slice(0, 12)

export interface ScreenDesk {
  /** The screen of the bot `follow` last named. null while it named none. */
  readonly view: ScreenView | null
  /** The open chat's bot. undefined: what is open has no screen of its own, as a group chat has not. */
  follow(bot: BotId | null | undefined): void
  online(): void
  offline(): void
  /** A `display.status` or `display.lease` event, for the profile whose home is `key`. */
  moved(change: { readonly key: string; readonly running: boolean | null; readonly lease: Lease }): void
  /** Takes control of the bot's screen from the agent, or hands it back. */
  control(bot: BotId | null, take: boolean): Promise<Outcome>
  /** Where to dial the live view of the followed bot's screen, ticket included. null when Hermes gives none, or no socket can reach it. */
  socket(): Promise<string | null>
  close(): void
}

/**
 * Owns what Highwing knows of each bot's screen on this connection. A bot's screen is asked for once, when its chat
 * opens, and then follows Hermes's events. Only the open chat's bot is asked for frames, and only while its screen runs.
 */
export function screenDesk(conn: Pick<Connection, 'call' | 'as' | 'sibling'>, clock: Clock, changed: () => void): ScreenDesk {
  const held = new Map<BotId | null, Held>()
  const asking = new Set<BotId | null>()
  let followed: BotId | null | undefined
  let thumbnail: string | null = null
  /** Minted by Hermes per connection, so a new socket forgets it. */
  let viewer: { readonly id: string; readonly hash: string } | null = null
  let polling: { readonly bot: BotId | null; cancel: () => void } | null = null

  const callsFor = (bot: BotId | null): Pick<Calls, 'call'> => (bot === null ? conn : conn.as(bot))
  const heldOf = (bot: BotId | null): Held => held.get(bot) ?? ASKING
  const running = (bot: BotId | null) => {
    const now = heldOf(bot)
    return now.state === 'known' && now.facts.running
  }

  const stopPolling = () => {
    polling?.cancel()
    polling = null
  }

  /** Asks for frames while the followed bot's screen runs, one ask at a time. */
  const keepFresh = () => {
    const bot = followed
    if (bot === undefined || !running(bot)) return stopPolling()
    if (polling?.bot === bot) return
    stopPolling()
    const turn = { bot, cancel: () => {} }
    polling = turn
    const tick = async () => {
      try {
        const frame = parseThumbnail(await callsFor(bot).call('display.thumbnail', {}))
        if (polling === turn && frame !== thumbnail) {
          thumbnail = frame
          changed()
        }
      } catch (error) {
        if (!(error instanceof RpcRefusal || error instanceof Offline)) throw error
      }
      if (polling === turn) turn.cancel = clock.setTimeout(() => void tick(), THUMBNAIL_MS)
    }
    void tick()
  }

  const put = (bot: BotId | null, next: Held) => {
    held.set(bot, next)
    if (bot === followed && !running(bot)) thumbnail = null
    keepFresh()
    changed()
  }

  const known = (bot: BotId | null, facts: ScreenFacts) => {
    const before = heldOf(bot)
    put(bot, { state: 'known', facts: { ...facts, lease: newerLease(before.state === 'known' ? before.facts.lease : null, facts.lease) } })
  }

  const ask = async (bot: BotId | null) => {
    if (asking.has(bot)) return
    asking.add(bot)
    try {
      const facts = parseScreenFacts(await callsFor(bot).call('display.status', {}))
      if (facts === null) put(bot, UNAVAILABLE)
      else known(bot, facts)
    } catch (error) {
      // -32601 on an older Hermes, or on a socket without the interactive grant; profile_mismatch for another bot on a socket bound to one.
      if (error instanceof RpcRefusal) put(bot, UNAVAILABLE)
      else if (!(error instanceof Offline)) throw error
    } finally {
      asking.delete(bot)
    }
  }

  const minted = (viewerId: string) => {
    if (viewer?.id !== viewerId) viewer = { id: viewerId, hash: hashOf(viewerId) }
    return viewer
  }

  const observe = async (bot: BotId | null) => {
    const observed = parseObserved(await callsFor(bot).call('display.observe', viewer === null ? {} : { viewer_id: viewer.id }))
    if (observed !== null) minted(observed.viewerId)
    return observed
  }

  const leased = (bot: BotId | null, lease: Lease | null) => {
    const now = heldOf(bot)
    if (lease !== null && now.state === 'known') known(bot, { ...now.facts, lease })
  }

  const screenOf = (now: Held): Screen => {
    if (now.state !== 'known') return now
    if (!now.facts.running) return OFF
    const control = controlOf(now.facts.lease, viewer?.hash ?? null)
    return { state: 'on', control, thumbnail: control === 'agent' ? thumbnail : null }
  }

  return {
    get view() {
      return followed === undefined ? null : { bot: followed, screen: screenOf(heldOf(followed)) }
    },
    follow: bot => {
      if (bot === followed) return
      followed = bot
      thumbnail = null
      if (bot !== undefined && !held.has(bot)) void ask(bot)
      keepFresh()
      changed()
    },
    online: () => {
      viewer = null
      for (const bot of [...held.keys()]) if (bot !== followed) held.delete(bot)
      if (followed !== undefined) void ask(followed)
    },
    offline: () => {
      viewer = null
      stopPolling()
    },
    moved: ({ key, running: now, lease }) => {
      for (const [bot, was] of [...held]) {
        if (was.state === 'known' && was.facts.key === key) known(bot, { key, running: now ?? was.facts.running, lease })
      }
    },
    control: async (bot, take) => {
      try {
        if (take) {
          const id = viewer?.id ?? (await observe(bot))?.viewerId
          if (id === undefined) return refused('rejected', "Hermes didn't let Highwing watch this screen.")
          leased(bot, parseLease(await callsFor(bot).call('display.lease.acquire', { viewer_id: id, reason: 'Highwing' })))
        } else {
          if (viewer === null) return refused('rejected', "Highwing doesn't have control of this screen.")
          leased(bot, parseLease(await callsFor(bot).call('display.lease.release', { viewer_id: viewer.id })))
        }
        return DONE
      } catch (error) {
        if (error instanceof Offline) return NOT_CONNECTED
        if (error instanceof RpcRefusal) return refused('rejected', `Hermes refused: ${error.message}`)
        throw error
      }
    },
    socket: async () => {
      if (followed === undefined) return null
      try {
        const observed = await observe(followed)
        // A relay to another machine can fail on its own, and the view then says it could not connect.
        const at = observed === null ? null : await conn.sibling(observed.path).catch(() => null)
        if (observed === null || at === null) return null
        const url = new URL(at)
        url.searchParams.set('display_ticket', observed.ticket)
        return url.href
      } catch (error) {
        if (error instanceof RpcRefusal || error instanceof Offline) return null
        throw error
      }
    },
    close: stopPolling
  }
}
