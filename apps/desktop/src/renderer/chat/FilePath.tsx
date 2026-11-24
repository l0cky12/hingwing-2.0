import type { SessionId } from '@highwing/hermes/domain'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { FileAction, FileOutcome } from '../../ipc-contract'

export type FileCall = (action: FileAction, path: string) => Promise<FileOutcome>

/** What a path answers where no session is watched. */
export const NO_FILE_CALL: FileCall = async () => ({ ok: false, reason: 'refused' })

export const FileCallContext = createContext(NO_FILE_CALL)

export const fileCallFor = (sessionId: SessionId): FileCall => (action, path) => window.highwing.file({ action, sessionId, path })

export const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

const WORDS = {
  missing: "This file isn't there any more.",
  failed: "Highwing couldn't open this file.",
  refused: "Highwing couldn't open this file.",
  copy: "Highwing couldn't copy this path."
} as const

export function FilePath({ path, findId }: { readonly path: string; readonly findId: string }) {
  const fileCall = useContext(FileCallContext)
  const [menu, setMenu] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const row = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const name = baseName(path)

  useEffect(() => {
    if (!menu) return
    const away = (event: PointerEvent) => {
      if (!row.current?.contains(event.target as Node)) setMenu(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [menu])

  const act = async (action: FileAction) => {
    setMenu(false)
    const outcome = await fileCall(action, path)
    setNote(outcome.ok ? null : WORDS[outcome.reason])
  }
  const copy = async () => {
    setMenu(false)
    try {
      await navigator.clipboard.writeText(path)
      setNote(null)
    } catch {
      setNote(WORDS.copy)
    }
  }

  return (
    <div
      className="file"
      ref={row}
      onKeyDown={event => {
        if (event.key !== 'Escape' || !menu) return
        event.stopPropagation()
        setMenu(false)
        toggle.current?.focus()
      }}
    >
      <div className="file-row">
        <button className="file-open" aria-label={`Open ${name}`} title={path} data-find={findId} onClick={() => void act('open')}>{path}</button>
        <span className="file-side">
          <button className="file-more" ref={toggle} aria-label={`More for ${name}`} aria-expanded={menu} onClick={() => setMenu(open => !open)}>
            <span aria-hidden="true">⋯</span>
          </button>
          {menu && (
            <div className="file-menu">
              <button onClick={() => void act('show')}>Show in folder</button>
              <button onClick={() => void copy()}>Copy path</button>
            </div>
          )}
        </span>
      </div>
      {note !== null && <p className="file-note">{note}</p>}
    </div>
  )
}
