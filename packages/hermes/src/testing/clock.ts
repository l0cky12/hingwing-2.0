import type { Clock } from '../wire/link'

export interface ManualClock extends Clock {
  /** Moves time forward by `ms`, running each timer that falls due at its own time, in order. */
  advance(ms: number): Promise<void>
  /** Jumps to the next timer and runs it. False when none is set. */
  next(): Promise<boolean>
}

/** Lets every promise that is already resolvable run. A macrotask, so chains of any depth finish. */
export const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

/** A clock that only moves when told to, so a test owns every timer the client sets. */
export function manualClock(start = 0): ManualClock {
  let now = start
  let order = 0
  const timers = new Map<number, { readonly at: number; readonly run: () => void }>()
  const fireDue = (until: number): boolean => {
    const [id, timer] = [...timers].filter(([, held]) => held.at <= until).sort(([a, x], [b, y]) => x.at - y.at || a - b)[0] ?? []
    if (id === undefined || timer === undefined) return false
    timers.delete(id)
    now = Math.max(now, timer.at)
    timer.run()
    return true
  }
  return {
    now: () => now,
    setTimeout: (run, ms) => {
      const id = order++
      timers.set(id, { at: now + Math.max(0, ms), run })
      return () => void timers.delete(id)
    },
    advance: async ms => {
      const until = now + ms
      await settle()
      while (fireDue(until)) await settle()
      now = until
    },
    next: async () => {
      await settle()
      const fired = fireDue(Infinity)
      await settle()
      return fired
    }
  }
}
