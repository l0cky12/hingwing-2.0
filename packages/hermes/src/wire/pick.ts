/**
 * One route over the several ways in to one server. Every dial times the ways, ranks them and takes the
 * best that connects, so a redial after a drop picks again and lands on a way that still works.
 */
import { byKind, sameTarget, type SshHost, type Target } from '../domain/reach'
import { rankWays, type PickMode, type Server, type Timed } from '../domain/servers'
import { DialError, systemClock, type Clock, type Dialer, type WireSocket } from './link'
import type { Route } from './remote'
import { sshPing } from './ssh'

/** One way in: where it leads, the route that dials it, and how long it takes to answer. `time` resolves null when it does not answer. */
export interface Way { readonly target: Target; readonly route: Route; time(signal: AbortSignal): Promise<number | null> }

/** What a dial settled on. `times` is empty when the server has one way, which is never timed. */
export interface Picked { readonly using: Target; readonly times: readonly Timed[] }

export interface PickedRoute extends Route {
  /**
   * The server's ways and pick after an edit. Keeps the `Way` of a target it already has, makes the others
   * with `wayFor`, and disposes the ways no longer listed. A socket through a dropped way closes, and the
   * link redials through the ways left. Otherwise the route times the ways again, and closes the socket only
   * when a dial would now take another way, so an added way or a new order is used at once.
   */
  arrange(ways: readonly Target[], pick: PickMode): void
}

/**
 * `read` and `transcribe` go through the way that last connected, or the first way before any did.
 * When every way fails, a dial fails as the first way does, since that is the one the user put first.
 */
export function pickedRoute(server: Pick<Server, 'ways' | 'pick'>, wayFor: (target: Target) => Way, onPick: (picked: Picked) => void): PickedRoute {
  const life = new AbortController()
  let ways: readonly Way[] = server.ways.map(wayFor)
  let pick = server.pick
  let held: { readonly way: Way; readonly socket: WireSocket } | null = null

  const through = (): Route => (held?.way ?? (ways[0] as Way)).route
  /** One way is never timed: there is nothing to choose between. */
  const timesOf = (timed: readonly Way[]) => (timed.length === 1 ? null : Promise.all(timed.map(way => way.time(life.signal))))
  const told = (timed: readonly Way[], times: readonly (number | null)[] | null): readonly Timed[] =>
    (times === null ? [] : timed.map(({ target }, at) => ({ target, ms: times[at] as number | null })))

  const dial: Dialer = async request => {
    if (life.signal.aborted) throw new DialError('dropped')
    const dialed = ways
    const times = await timesOf(dialed)
    const failures = new Map<number, unknown>()
    for (const index of times === null ? [0] : rankWays(times, pick)) {
      const way = dialed[index] as Way
      if (life.signal.aborted) break
      if (!ways.includes(way)) continue
      const socket = await way.route.dial(request).catch((error: unknown) => void failures.set(index, error))
      if (socket === undefined) continue
      // An edit or a dispose during the dial ended this way's processes, so its socket would be a dead one.
      if (life.signal.aborted || !ways.includes(way)) {
        socket.close()
        continue
      }
      held = { way, socket }
      onPick({ using: way.target, times: told(dialed, times) })
      return socket
    }
    throw life.signal.aborted ? new DialError('dropped') : failures.get(0) ?? [...failures.values()][0] ?? new DialError('dropped')
  }

  const pickAgain = async () => {
    const [timed, before] = [ways, held]
    if (before === null) return
    const times = await timesOf(timed)
    if (life.signal.aborted || ways !== timed || held !== before) return
    const best = times === null ? null : (rankWays(times, pick)[0] as number)
    // The link takes the close as a drop and redials, and that dial picks.
    if (best !== null && times?.[best] !== null && timed[best] !== before.way) return before.socket.close()
    onPick({ using: before.way.target, times: told(timed, times) })
  }

  return {
    dial,
    read: path => through().read(path),
    transcribe: recording => through().transcribe(recording),
    arrange: (targets, nextPick) => {
      const next = targets.map(target => ways.find(way => sameTarget(way.target, target)) ?? wayFor(target))
      const dropped = ways.filter(way => !next.includes(way))
      ways = next
      pick = nextPick
      if (held !== null && dropped.includes(held.way)) {
        // The local route holds no process a dispose could end, so the socket is closed by hand.
        held.socket.close()
        held = null
      }
      for (const way of dropped) way.route.dispose()
      void pickAgain()
    },
    dispose: () => {
      life.abort()
      for (const way of ways) way.route.dispose()
    }
  }
}

/** How long a way has to answer a timing. A way that takes longer still gets dialed, after the ways that answered. */
export const TIME_MS = 5_000

export interface TimeOptions {
  readonly signal: AbortSignal
  readonly sshBin?: string
  readonly clock?: Clock
  readonly fetch?: typeof fetch
}

/**
 * How long `target` takes to answer, in ms, or null when it does not answer in `TIME_MS`. A machine
 * reached over ssh is timed by one login that runs `exit`, which goes the way a dial goes: through
 * `~/.ssh/config`, Tailscale SSH and any ProxyJump. A gateway address is timed by one HEAD request,
 * and any HTTP status counts as an answer. This computer takes no time. Nothing here asks Hermes.
 */
export function timeWay(target: Target, { signal, sshBin, clock = systemClock, fetch: fetcher = fetch }: TimeOptions): Promise<number | null> {
  const began = clock.now()
  const took = (answered: boolean) => (answered ? clock.now() - began : null)
  const overSsh = ({ host }: { readonly host: SshHost }) =>
    sshPing(host, { signal, clock, deadlineMs: TIME_MS, ...(sshBin === undefined ? {} : { sshBin }) }).then(took)
  return byKind<Promise<number | null>>(target, {
    local: async () => 0,
    remote: overSsh,
    ssh: overSsh,
    url: async ({ url }) => {
      const late = new AbortController()
      const cancel = clock.setTimeout(() => late.abort(), TIME_MS)
      try {
        // Never followed, as no request to a gateway address is.
        await fetcher(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.any([signal, late.signal]) })
        return took(true)
      } catch {
        return null
      } finally {
        cancel()
      }
    }
  })
}
