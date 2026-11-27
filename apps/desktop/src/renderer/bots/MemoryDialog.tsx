import type { MemoryEntry } from '@highwing/hermes/domain'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { run } from '../store'

const preview = (text: string) => {
  const line = text.split('\n')[0]?.trim() ?? ''
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

interface Ready {
  readonly at: 'ready'
  readonly entries: readonly MemoryEntry[]
  readonly editing: string | null
  readonly draft: string
  readonly removing: string | null
  readonly words: string | null
  readonly busy: boolean
}

export function MemoryDialog({ onClose }: { readonly onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const heading = useId()
  const [view, setView] = useState<{ readonly at: 'loading' } | { readonly at: 'refused'; readonly words: string } | Ready>({ at: 'loading' })

  useLayoutEffect(() => {
    if (dialog.current?.open === false) {
      dialog.current.showModal()
      close.current?.focus()
    }
  }, [])

  const showListed = (outcome: Awaited<ReturnType<typeof run<{ do: 'memory' }>>>) => {
    setView(outcome.ok
      ? { at: 'ready', entries: outcome.value, editing: null, draft: '', removing: null, words: null, busy: false }
      : { at: 'refused', words: outcome.refusal.message })
  }
  useEffect(() => { void run({ do: 'memory' }).then(showListed) }, [])

  const save = async (ready: Ready, id: string) => {
    setView({ ...ready, busy: true, words: null })
    const outcome = await run({ do: 'saveMemory', id, text: ready.draft })
    if (!outcome.ok) {
      setView({ ...ready, busy: false, words: outcome.refusal.message })
      return
    }
    void run({ do: 'memory' }).then(showListed)
  }
  const remove = async (ready: Ready, id: string) => {
    setView({ ...ready, busy: true, words: null })
    const outcome = await run({ do: 'removeMemory', id })
    if (!outcome.ok) {
      setView({ ...ready, busy: false, removing: null, words: outcome.refusal.message })
      return
    }
    void run({ do: 'memory' }).then(showListed)
  }

  return (
    <dialog ref={dialog} className="confirm-dialog memory-dialog" aria-labelledby={heading} onCancel={event => { event.preventDefault(); onClose() }}>
      <h2 id={heading}>Memory</h2>
      {view.at === 'loading' && <p role="status">Reading memory…</p>}
      {view.at === 'refused' && <p role="alert">{view.words}</p>}
      {view.at === 'ready' && (
        view.entries.length === 0
          ? <p>Hermes remembers nothing yet.</p>
          : <ul className="memory-entries">
              {view.entries.map(entry => <Entry key={entry.id} entry={entry} view={view} onEdit={() => setView({ ...view, editing: entry.id, draft: entry.text, removing: null, words: null })} onDraft={draft => setView({ ...view, draft })} onCancelEdit={() => setView({ ...view, editing: null, words: null })} onSave={() => void save(view, entry.id)} onAskRemove={() => setView({ ...view, removing: entry.id, editing: null, words: null })} onCancelRemove={() => setView({ ...view, removing: null })} onRemove={() => void remove(view, entry.id)} />)}
            </ul>
      )}
      {view.at === 'ready' && view.words !== null && <p role="alert">{view.words}</p>}
      <div className="actions">
        <button ref={close} type="button" onClick={onClose}>Close</button>
      </div>
    </dialog>
  )
}

interface EntryProps {
  readonly entry: MemoryEntry
  readonly view: Ready
  readonly onEdit: () => void
  readonly onDraft: (text: string) => void
  readonly onCancelEdit: () => void
  readonly onSave: () => void
  readonly onAskRemove: () => void
  readonly onCancelRemove: () => void
  readonly onRemove: () => void
}

function Entry({ entry, view, onEdit, onDraft, onCancelEdit, onSave, onAskRemove, onCancelRemove, onRemove }: EntryProps) {
  const name = `${entry.file}: ${preview(entry.text)}`
  const editing = view.editing === entry.id
  const removing = view.removing === entry.id
  return (
    <li>
      <p className="memory-file">{entry.file}</p>
      {editing
        ? <>
            <textarea aria-label={`Memory text for ${entry.file}`} value={view.draft} autoFocus disabled={view.busy} onChange={event => onDraft(event.target.value)} />
            <div className="memory-actions">
              <button type="button" disabled={view.busy} onClick={onCancelEdit}>Cancel</button>
              <button type="button" className="primary" disabled={view.busy} onClick={onSave}>Save</button>
            </div>
          </>
        : removing
          ? <>
              <p className="memory-text">{entry.text}</p>
              <p>Remove this entry?</p>
              <div className="memory-actions">
                <button type="button" disabled={view.busy} onClick={onCancelRemove}>Cancel</button>
                <button type="button" className="primary" aria-label={`Remove ${name}`} disabled={view.busy} onClick={onRemove}>Remove</button>
              </div>
            </>
          : <>
              <p className="memory-text">{entry.text}</p>
              <div className="memory-actions">
                <button type="button" aria-label={`Edit ${name}`} disabled={view.busy} onClick={onEdit}>Edit</button>
                <button type="button" aria-label={`Remove ${name}`} disabled={view.busy} onClick={onAskRemove}>Remove</button>
              </div>
            </>}
    </li>
  )
}
