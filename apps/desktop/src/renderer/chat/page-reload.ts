import type { SessionId } from '@highwing/hermes/domain'
import { useEffect, useRef } from 'react'
import type { Preview } from '../../ipc-contract'
import { run, useTopic } from '../store'

export interface PaneSeen { readonly path: string; readonly version: string | undefined }

/** The page path the open pane shows, as this chat's cards name it. null unless this chat asked for the page and the view is still on it. */
export const paneKey = (preview: Preview | undefined, session: SessionId | null, newestPages: ReadonlyMap<string, string>): string | null => {
  const page = preview?.state === 'open' ? preview.page : null
  if (page === null || page.session !== session || preview?.state !== 'open') return null
  return newestPages.has(page.path) ? page.path : preview.address
}

export const reloadsPane = (before: PaneSeen | null, now: PaneSeen | null): boolean =>
  before !== null && now !== null && before.path === now.path &&
  before.version !== undefined && now.version !== undefined && before.version !== now.version

export function usePaneReload(session: SessionId | null, newestPages: ReadonlyMap<string, string> | null) {
  const preview = useTopic('preview')
  const path = newestPages === null ? null : paneKey(preview, session, newestPages)
  const version = path === null ? undefined : newestPages?.get(path)
  const seen = useRef<PaneSeen | null>(null)
  useEffect(() => {
    const now = path === null ? null : { path, version }
    if (reloadsPane(seen.current, now)) void run({ do: 'reloadPreview' })
    seen.current = now
  }, [path, version])
}
