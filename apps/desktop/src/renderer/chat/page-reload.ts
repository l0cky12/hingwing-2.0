import type { SessionId } from '@highwing/hermes/domain'
import { useEffect, useRef } from 'react'
import { run, useTopic } from '../store'

export interface PaneSeen { readonly session: SessionId; readonly path: string; readonly version: string | undefined }

export const reloadsPane = (before: PaneSeen | null, now: PaneSeen | null): boolean =>
  before !== null && now !== null && before.session === now.session && before.path === now.path &&
  before.version !== undefined && now.version !== undefined && before.version !== now.version

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
