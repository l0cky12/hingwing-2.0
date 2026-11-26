import { useEffect } from 'react'

export const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const LONGEST_WAIT_MS = 60_000

/** Calls `wake`, which bumps `tick`, just after `at`: when a thread's time lines change by the clock alone. */
export function useWakeAt(at: number | null, tick: number, wake: () => void) {
  useEffect(() => {
    if (at === null) return
    // A timer does not count the time the machine sleeps, so a long wait is cut into short ones, each re-armed by `tick`.
    const id = setTimeout(wake, Math.min(Math.max(0, at - Date.now()) + 25, LONGEST_WAIT_MS))
    return () => clearTimeout(id)
  }, [at, tick, wake])
}
