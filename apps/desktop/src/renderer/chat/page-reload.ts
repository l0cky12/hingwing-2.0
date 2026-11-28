import type { SessionId } from '@highwing/hermes/domain'
import { useEffect, useRef } from 'react'
import type { Preview } from '../../ipc-contract'
import { run, useTopic } from '../store'

export interface PaneSeen { readonly session: SessionId; readonly path: string; readonly version: string | undefined }

/** The page path the open pane shows, as this chat's cards name it: a card's own request, else the address the pane reached. */
export const paneKey = (preview: Preview | undefined, newestPages: ReadonlyMap<string, string>): string | null =>
  preview?.state !== 'open' ? null : newestPages.has(preview.asked) ? preview.asked : preview.address

export const reloadsPane = (before: PaneSeen | null, now: PaneSeen | null): boolean =>
  before !== null && now !== null && before.session === now.session && before.path === now.path &&
  before.version !== undefined && now.version !== undefined && before.version !== now.version

export function usePaneReload(session: SessionId | null, newestPages: ReadonlyMap<string, string> | null) {
  const preview = useTopic('preview')
  const path = newestPages === null ? null : paneKey(preview, newestPages)
  const version = path === null ? undefined : newestPages?.get(path)
  const seen = useRef<PaneSeen | null>(null)
  useEffect(() => {
    const now = session === null || path === null ? null : { session, path, version }
    if (reloadsPane(seen.current, now)) void run({ do: 'reloadPreview' })
    seen.current = now
  }, [session, path, version])
}
