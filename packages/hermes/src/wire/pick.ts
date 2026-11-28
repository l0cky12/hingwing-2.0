/**
 * One route over the several ways in to one server. Every dial times the ways, ranks them and takes the
 * best that connects, so a redial after a drop picks again and lands on a way that still works.
 */
import { byKind, sameTarget, type SshHost, type Target } from '../domain/reach'
import { rankWays, TIE_MS, type PickMode, type Server, type Timed } from '../domain/servers'
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
 * `call` and `transcribe` go through the way that last connected, or the first way before any did.
 * When every way fails, a dial fails as the first way does, since that is the one the user put first.
 */
export function pickedRoute(server: Pick<Server, 'ways' | 'pick'>, wayFor: (target: Target) => Way, onPick: (picked: Picked) => void, clock: Clock = systemClock): PickedRoute {
  const life = new AbortController()
  let ways: readonly Way[] = server.ways.map(wayFor)
  let pick = server.pick
  let held: { readonly way: Way; readonly socket: WireSocket } | null = null

  const through = (): Route => (held?.way ?? (ways[0] as Way)).route
  /** Counts dials. The link keeps only its latest dial, so only the latest may set the way in use. */
  let turn = 0
  /** `undefined`: the way was still being timed. It is left out, so its row shows no time yet. */
  const told = (timed: readonly Way[], times: readonly (number | null | undefined)[] | null): readonly Timed[] =>
    (times === null ? [] : timed.flatMap(({ target }, at) => (times[at] === undefined ? [] : [{ target, ms: times[at] }])))

  /**
   * Times every way, and settles as soon as the times so far decide the best way, so a way that never
   * answers holds no dial up to its deadline. In order, that is once a way answered and every way above
   * it is done. Fastest, it is `TIE_MS` after the first answer: a way later than that cannot win the tie.
   * `all` resolves with every time once each way is done. null: one way, which is never timed, since
   * there is nothing to choose between.
   */
  const timeAll = (timed: readonly Way[], mode: PickMode) => {
    if (timed.length === 1) return null
    const times: (number | null | undefined)[] = timed.map(() => undefined)
    let settle = () => {}
    const settled = new Promise<void>(resolve => { settle = resolve })
    let cancelTie: (() => void) | null = null
    let heard: (() => void)[] = []
    const done = () => times.filter(ms => ms !== undefined).length
    const decided = () => {
      const answered = times.findIndex(ms => typeof ms === 'number')
      if (times.every(ms => ms !== undefined)) return true
      return mode === 'order' && answered !== -1 && times.slice(0, answered).every(ms => ms !== undefined)
    }
    const all = Promise.all(timed.map(async (way, at) => {
      const ms = await way.time(life.signal)
      times[at] = ms
      if (mode === 'fastest' && ms !== null && cancelTie === null) cancelTie = clock.setTimeout(settle, TIE_MS)
      if (decided()) settle()
      for (const wake of heard) wake()
      heard = []
      return ms
    }))
    const early = settled.then(() => {
      cancelTie?.()
      return [...times]
    })
    /** The times so far, and how many ways are done. */
    const now = () => ({ times: [...times], done: done() })
    /** Resolves once more than `seen` ways are done. */
    const more = (seen: number) => (done() > seen ? Promise.resolve() : new Promise<void>(resolve => void heard.push(resolve)))
    return { early, all, now, more }
  }
  type Timing = ReturnType<typeof timeAll>

  /** Tells which way is in use, and once every way is timed tells again, while that socket and those ways are still the ones in use. */
  const tell = (timed: readonly Way[], timing: Timing, times: readonly (number | null | undefined)[] | null, way: Way, socket: WireSocket) => {
    onPick({ using: way.target, times: told(timed, times) })
    if (timing === null || !times?.includes(undefined)) return
    void timing.all.then(full => void (held?.socket === socket && ways === timed && !life.signal.aborted && onPick({ using: way.target, times: told(timed, full) })))
  }

  const dial: Dialer = async request => {
    if (life.signal.aborted) throw new DialError('dropped')
    const [mine, dialed, mode] = [++turn, ways, pick]
    const timing = timeAll(dialed, mode)
    const failures = new Map<number, unknown>()
    const gone = () => life.signal.aborted || mine !== turn
    /** The first of `indices` that connects. A way already tried, or one an edit took away, is skipped. */
    const first = async (indices: readonly number[]) => {
      for (const index of indices) {
        const way = dialed[index] as Way
        if (gone()) return null
        if (failures.has(index) || !ways.includes(way)) continue
        const socket = await way.route.dial(request).catch((error: unknown) => void failures.set(index, error))
        if (socket === undefined) continue
        // An edit or a dispose during the dial ended this way's processes, so its socket would be a dead one. A later dial replaced this one.
        if (gone() || !ways.includes(way)) {
          socket.close()
          continue
        }
        return { way, socket }
      }
      return null
    }
    let times: readonly (number | null | undefined)[] | null = timing === null ? null : await timing.early
    const answered = (held: readonly (number | null | undefined)[]) => rankWays(held.map(ms => ms ?? null), mode).filter(index => typeof held[index] === 'number')
    let won = await first(times === null ? [0] : answered(times))
    // After a failure the next way to answer is tried next, whatever its place in the order. A way that never answers is tried last.
    while (won === null && timing !== null && !gone()) {
      const seen = timing.now()
      times = seen.times
      if (seen.done === dialed.length) {
        won = await first(rankWays(seen.times.map(ms => ms ?? null), mode))
        break
      }
      won = await first(answered(seen.times))
      if (won === null) await timing.more(seen.done)
    }
    if (won === null) throw gone() ? new DialError('dropped') : failures.get(0) ?? [...failures.values()][0] ?? new DialError('dropped')
    const { way, socket } = won
    held = won
    // An edit during the dial may have changed which way is best.
    if (ways !== dialed || pick !== mode) {
      onPick({ using: way.target, times: told(dialed, times) })
      void pickAgain()
    } else tell(dialed, timing, times, way, socket)
    return socket
  }

  /** After an edit, times the ways now listed, and closes the socket in use when a dial would now take another way. The link takes the close as a drop and redials, and that dial picks. */
  const pickAgain = async () => {
    const [timed, mode, before] = [ways, pick, held]
    // A dial in flight sees the edit when it connects.
    if (before === null) return
    const timing = timeAll(timed, mode)
    const times = timing === null ? null : await timing.early
    // A later edit picks again itself, and a dial since then picked under this edit.
    if (life.signal.aborted || ways !== timed || pick !== mode || held !== before) return
    const best = times === null ? 0 : (rankWays(times.map(ms => ms ?? null), mode)[0] as number)
    if (typeof times?.[best] === 'number' && timed[best] !== before.way) {
      held = null
      return before.socket.close()
    }
    tell(timed, timing, times, before.way, before.socket)
  }

  return {
    dial,
    call: ask => through().call(ask),
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
