import type { SessionId } from '@highwing/hermes/domain'
import { createContext, useContext, useState } from 'react'
import type { FileAction, FileOutcome } from '../../ipc-contract'
import { useMenu } from './menu'

/** `label` goes with a `page`, as Hermes named it. */
export type FileCall = (action: FileAction, path: string, label?: string | null) => Promise<FileOutcome>

/** What a path answers where no session is watched. */
export const NO_FILE_CALL: FileCall = async () => ({ ok: false, reason: 'refused' })

export const FileCallContext = createContext(NO_FILE_CALL)

export const fileCallFor = (sessionId: SessionId): FileCall => (action, path, label = null) =>
  window.highwing.file(action === 'page' ? { action, sessionId, path, label } : { action, sessionId, path })

export const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

const PREVIEWS = /\.(html?|pdf|csv|tsv)$/i

const WORDS = {
  missing: "This file isn't there any more.",
  failed: "Highwing couldn't open this file.",
  refused: "Highwing couldn't open this file.",
  copy: "Highwing couldn't copy this path."
} as const

export function FilePath({ path, findId }: { readonly path: string; readonly findId: string }) {
  const fileCall = useContext(FileCallContext)
  const { open: menu, setOpen: setMenu, holder: row, toggle, onKeyDown } = useMenu<HTMLDivElement, HTMLButtonElement>()
  const [note, setNote] = useState<string | null>(null)
  const name = baseName(path)

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
    <div className="file" ref={row} onKeyDown={onKeyDown}>
      <div className="file-row">
        <button className="file-open" aria-label={`Open ${name}`} title={path} data-find={findId} onClick={() => void act('open')}>{path}</button>
        {PREVIEWS.test(path) && <button className="file-preview" aria-label={`Preview ${name}`} onClick={() => void act('preview')}>Preview</button>}
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
