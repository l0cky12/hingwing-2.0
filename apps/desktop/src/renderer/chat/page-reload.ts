import type { SessionId } from '@highwing/hermes/domain'
import { useEffect, useRef } from 'react'
import { run, useTopic } from '../store'

/** What the open pane showed beside a chat: its address, and the newest version of that page in the chat, undefined when no card there names it. */
export interface PaneSeen { readonly session: SessionId; readonly path: string; readonly version: string | undefined }

/**
 * The pane reloads when the chat it was seen beside wrote a new version of the page it still shows.
 * A version that only now appears is not one: it is what a chat reads while it loads.
 */
export const reloadsPane = (before: PaneSeen | null, now: PaneSeen | null): boolean =>
  before !== null && now !== null && before.session === now.session && before.path === now.path &&
  before.version !== undefined && now.version !== undefined && before.version !== now.version

/** Reloads the open pane once each time this chat writes a newer version of the page it shows. */
export function usePaneReload(session: SessionId | null, newestPages: ReadonlyMap<string, string> | null) {
  const preview = useTopic('preview')
  const path = preview?.state === 'open' ? preview.address : null
  const version = path === null ? undefined : newestPages?.get(path)
  const known = newestPages !== null
  const seen = useRef<PaneSeen | null>(null)
  useEffect(() => {
    const now = session === null || path === null || !known ? null : { session, path, version }
    if (reloadsPane(seen.current, now)) void run({ do: 'reloadPreview' })
    seen.current = now
  }, [session, path, version, known])
}
