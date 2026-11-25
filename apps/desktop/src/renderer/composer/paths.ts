import type { PathMatch, SessionId } from '@highwing/hermes/domain'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { run } from '../store'
import type { PathFiles } from './menu'

const NONE: readonly PathMatch[] = []
const NO_FILES: PathFiles = { word: null, matches: NONE }
const QUIET_MS = 120

export interface Timer {
  set(run: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export interface PathAsker {
  /** The word being typed, or null for none. Hermes is asked once the word has held still for a moment. */
  want(word: string | null): void
  /** Stops a pending ask and ignores a reply still to come. */
  dispose(): void
  files(): PathFiles
  subscribe(listener: () => void): () => void
}

const realTimer: Timer = { set: (task, ms) => setTimeout(task, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }

/**
 * The matches for the latest word wanted. A reply for a word typed past is dropped, and a refusal is no matches. The
 * last matches stay, named for their own word, while a newer word waits, so the list does not close and open on each keystroke. `@` alone has
 * nothing to complete and asks nothing.
 */
export function pathAsker(ask: (word: string) => Promise<readonly PathMatch[]>, timer: Timer = realTimer, quietMs = QUIET_MS): PathAsker {
  let latest: string | null = null
  let waiting: unknown = null
  let held = NO_FILES
  const listeners = new Set<() => void>()

  const stop = () => {
    if (waiting !== null) timer.clear(waiting)
    waiting = null
  }
  const hold = (next: PathFiles) => {
    if (next.matches.length === 0 && held.matches.length === 0) return
    held = next
    for (const listener of listeners) listener()
  }

  return {
    want(word) {
      const wanted = word === null || word.length <= 1 ? null : word
      if (wanted === latest) return
      latest = wanted
      stop()
      if (wanted === null) {
        hold(NO_FILES)
        return
      }
      waiting = timer.set(() => {
        waiting = null
        void ask(wanted).catch(() => NONE).then(found => {
          if (latest === wanted) hold({ word: wanted, matches: found })
        })
      }, quietMs)
    },
    dispose() {
      latest = null
      stop()
    },
    files: () => held,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}

const nobody = { files: () => NO_FILES, subscribe: () => () => {} }

/** The files and folders of a chat's working folder that `word` starts. Nothing for a chat with no session, or no word. */
export function usePathFiles(sessionId: SessionId | null, word: string | null): PathFiles {
  const asker = useMemo(
    () => (sessionId === null ? null : pathAsker(async text => {
      const outcome = await run({ do: 'completePath', sessionId, word: text })
      return outcome.ok ? outcome.value : NONE
    })),
    [sessionId]
  )
  useEffect(() => () => asker?.dispose(), [asker])
  useEffect(() => asker?.want(word), [asker, word])
  const { files, subscribe } = asker ?? nobody
  return useSyncExternalStore(subscribe, files)
}
