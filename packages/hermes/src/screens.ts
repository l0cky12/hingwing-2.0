import { createHash } from 'node:crypto'
import { DONE, refused } from './actor'
import type { BotId } from './domain/bots'
import type { Outcome } from './domain/command'
import { controlOf, newerLease, type Lease, type Screen, type ScreenView } from './domain/screen'
import { NOT_CONNECTED } from './open'
import { Offline, RpcRefusal, type Calls, type Clock, type Connection } from './wire/link'
import { parseLease, parseObserved, parseScreenFacts, parseThumbnail } from './wire/parse'

/** How often the open chat's bot is asked for a new frame of its screen while the agent uses it. */
export const THUMBNAIL_MS = 2_000

/** `key`: the profile's home, the name Hermes's events give it. */
type Held = { readonly state: 'asking' } | { readonly state: 'unavailable' } | { readonly state: 'known'; readonly key: string; readonly running: boolean }

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
  /** Where to dial the live view of the followed bot's screen, ticket included. null when Hermes gives none, no socket can reach it, or the open chat moved to another bot meanwhile. */
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
  /** Profile homes whose screen started or stopped while a status was asked. `running` has no epoch, so such a reply is asked again. */
  const turned = new Set<string>()
  /** The newest lease of each profile, by its home. An event can come before the reply that names a bot's home. */
  const leases = new Map<string, Lease>()
  /** Every viewer id Hermes minted for this Highwing, by its hash. A lease taken before a dropped link is still this Highwing's. */
  const ours = new Map<string, string>()
  /** The viewer id Hermes minted on this connection. Only it may take control. */
  let current: string | null = null
  /**
   * Every call that mints a viewer id or moves the lease waits for the one before: a second observe then asks with the id the first
   * was minted, and Hand back releases whichever id holds the lease once a move in flight has landed.
   */
  let queue: Promise<unknown> = Promise.resolve()
  let followed: BotId | null | undefined
  let thumbnail: string | null = null
  let polling: { readonly bot: BotId | null; cancel: () => void } | null = null

  const callsFor = (bot: BotId | null): Pick<Calls, 'call'> => (bot === null ? conn : conn.as(bot))
  const heldOf = (bot: BotId | null): Held => held.get(bot) ?? ASKING
  const running = (bot: BotId | null) => {
    const now = heldOf(bot)
    return now.state === 'known' && now.running
  }
  const leaseOf = (bot: BotId | null) => {
    const now = heldOf(bot)
    return now.state === 'known' ? leases.get(now.key) ?? null : null
  }
  const lease = (key: string, next: Lease) => leases.set(key, newerLease(leases.get(key) ?? null, next))

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

  const ask = async (bot: BotId | null) => {
    if (asking.has(bot)) return
    asking.add(bot)
    let again = false
    try {
      const facts = parseScreenFacts(await callsFor(bot).call('display.status', {}))
      if (facts === null) return put(bot, UNAVAILABLE)
      again = turned.has(facts.key)
      lease(facts.key, facts.lease)
      put(bot, { state: 'known', key: facts.key, running: facts.running })
    } catch (error) {
      // -32601 on an older Hermes, or on a socket without the interactive grant; profile_mismatch for another bot on a socket bound to one.
      if (error instanceof RpcRefusal) put(bot, UNAVAILABLE)
      else if (!(error instanceof Offline)) throw error
    } finally {
      asking.delete(bot)
      if (asking.size === 0) turned.clear()
    }
    if (again) await ask(bot)
  }

  const serially = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work)
    queue = run.catch(() => null)
    return run
  }

  const observe = async (bot: BotId | null) => {
    const observed = parseObserved(await callsFor(bot).call('display.observe', current === null ? {} : { viewer_id: current }))
    if (observed !== null) {
      current = observed.viewerId
      ours.set(hashOf(current), current)
    }
    return observed
  }

  const leased = (bot: BotId | null, reply: Lease | null) => {
    const now = heldOf(bot)
    if (reply === null || now.state !== 'known') return
    lease(now.key, reply)
    changed()
  }
  const acquire = async (bot: BotId | null, id: string) =>
    leased(bot, parseLease(await callsFor(bot).call('display.lease.acquire', { viewer_id: id, reason: 'Highwing' })))

  const screenOf = (bot: BotId | null): Screen => {
    const now = heldOf(bot)
    if (now.state !== 'known') return now
    if (!now.running) return OFF
    const taken = leases.get(now.key)
    const control = taken === undefined ? 'agent' : controlOf(taken, ours)
    return { state: 'on', control, thumbnail: control === 'agent' ? thumbnail : null }
  }

  return {
    get view() {
      return followed === undefined ? null : { bot: followed, screen: screenOf(followed) }
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
      current = null
      for (const bot of [...held.keys()]) if (bot !== followed) held.delete(bot)
      if (followed !== undefined) void ask(followed)
    },
    offline: () => {
      current = null
      stopPolling()
    },
    moved: ({ key, running: now, lease: next }) => {
      lease(key, next)
      if (now !== null && asking.size > 0) turned.add(key)
      for (const [bot, was] of [...held]) {
        if (was.state === 'known' && was.key === key && now !== null) held.set(bot, { ...was, running: now })
      }
      if (followed !== undefined && !running(followed)) thumbnail = null
      keepFresh()
      changed()
    },
    control: (bot, take) => serially(async () => {
      try {
        if (take) {
          const id = current ?? (await observe(bot))?.viewerId
          if (id === undefined) return refused('rejected', "Hermes didn't let Highwing watch this screen.")
          await acquire(bot, id)
          return DONE
        }
        const holder = leaseOf(bot)?.viewerHash
        const id = holder === undefined || holder === null ? undefined : ours.get(holder)
        if (id === undefined) return refused('rejected', "Highwing doesn't have control of this screen.")
        // An id minted on an earlier connection is no longer this connection's, which only `force` lets through. Hermes still releases only a lease that id holds.
        leased(bot, parseLease(await callsFor(bot).call('display.lease.release', { viewer_id: id, force: true })))
        return DONE
      } catch (error) {
        if (error instanceof Offline) return NOT_CONNECTED
        if (error instanceof RpcRefusal) return refused('rejected', `Hermes refused: ${error.message}`)
        throw error
      }
    }),
    socket: async () => {
      const bot = followed
      if (bot === undefined) return null
      try {
        const observed = await serially(async () => {
          const minted = await observe(bot)
          // After a dropped link the user's lease names the id of the last connection, so it moves to the one this view watches with, or Hermes would drop their input.
          const holder = leaseOf(bot)?.viewerHash
          if (minted !== null && holder != null && ours.has(holder) && holder !== hashOf(minted.viewerId)) await acquire(bot, minted.viewerId)
          return minted
        })
        // A relay to another machine can fail on its own, and the view then says it could not connect.
        const at = observed === null ? null : await conn.sibling(observed.path).catch(() => null)
        if (observed === null || at === null || followed !== bot) return null
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
