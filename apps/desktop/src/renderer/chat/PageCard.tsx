import { fieldId, type PageView } from '@highwing/thread'
import { useContext, useState } from 'react'
import { baseName, FileCallContext } from './FilePath'

const WORDS = { missing: "This page isn't there any more.", failed: "Highwing couldn't open this page.", refused: "Highwing couldn't open this page." } as const

export function PageCard({ page: { path, label, title }, nodeKey }: { readonly page: PageView; readonly nodeKey: string }) {
  const fileCall = useContext(FileCallContext)
  const [note, setNote] = useState<string | null>(null)
  const open = async () => {
    const outcome = await fileCall('page', path, label)
    setNote(outcome.ok ? null : WORDS[outcome.reason])
  }
  return (
    <article className="page-card" aria-label={title}>
      <div className="page-card-row">
        <svg className="page-card-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6" />
        </svg>
        <div className="page-card-words">
          <h3 data-find={fieldId(nodeKey, 'title')}>{title}</h3>
          <p title={path}>{baseName(path)}</p>
        </div>
        <button type="button" aria-label={`Open ${title}`} onClick={() => void open()}>Open</button>
      </div>
      {note !== null && <p className="page-card-note" role="alert">{note}</p>}
    </article>
  )
}
