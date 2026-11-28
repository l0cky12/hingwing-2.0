import type { BotId, CommandOutcome, LibraryItemId, LibraryRead } from '@highwing/hermes/domain'
import { useEffect, useState } from 'react'
import { TIME_ZONE } from '../chat/wake'
import { afterStep, libraryViewOf, type LibraryPages, type LibraryRow, type LibraryView } from './library-view'

export interface LibraryProps {
  readonly bot: BotId
  readonly name: string
  readonly onRead: (bot: BotId, step: number) => Promise<CommandOutcome<LibraryRead>>
  readonly onPreview: (bot: BotId, id: LibraryItemId) => Promise<CommandOutcome<void>>
  readonly onSave: (bot: BotId, id: LibraryItemId) => Promise<CommandOutcome<string | null>>
  /** An item is in the pane, which the panel covers. */
  readonly onShown: () => void
}

type Said = { readonly words: string; readonly tone: 'status' | 'alert' }
type Busy = LibraryItemId | 'older' | null

/** A bot's Library tab: the files, images and links its chats made, newest first. A name opens it in the pane, and a file can be saved. */
export function Library({ bot, name, onRead, onPreview, onSave, onShown }: LibraryProps) {
  const [read, setRead] = useState<CommandOutcome<LibraryPages> | null>(null)
  const [said, setSaid] = useState<Said | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  useEffect(() => {
    let current = true
    void onRead(bot, 0).then(outcome => { if (current) setRead(outcome.ok ? { ok: true, value: afterStep(null, 0, outcome.value) } : outcome) })
    return () => { current = false }
  }, [bot, onRead])

  const older = async () => {
    if (read?.ok !== true) return
    const step = read.value.step + 1
    setBusy('older')
    const outcome = await onRead(bot, step)
    setBusy(null)
    if (outcome.ok) setRead(held => (held?.ok === true ? { ok: true, value: afterStep(held.value, step, outcome.value) } : held))
    else setSaid({ words: outcome.refusal.message, tone: 'alert' })
  }
  const open = async (row: LibraryRow) => {
    const outcome = await onPreview(bot, row.id)
    if (outcome.ok) onShown()
    else setSaid({ words: outcome.refusal.message, tone: 'alert' })
  }
  const save = async (row: LibraryRow) => {
    setBusy(row.id)
    const outcome = await onSave(bot, row.id)
    setBusy(null)
    if (!outcome.ok) setSaid({ words: outcome.refusal.message, tone: 'alert' })
    else if (outcome.value !== null) setSaid({ words: `Saved ${row.name} to ${outcome.value}.`, tone: 'status' })
  }

  return (
    <>
      {said === null ? null : <p className={said.tone === 'alert' ? 'library-note library-refused' : 'library-note'} role={said.tone}>{said.words}</p>}
      <LibraryList
        view={libraryViewOf(read, name, { now: Date.now(), timeZone: TIME_ZONE })} busy={busy}
        onOpen={row => void open(row)} onSave={row => void save(row)} onOlder={() => void older()}
      />
    </>
  )
}

export interface LibraryListProps {
  readonly view: LibraryView
  readonly busy: Busy
  readonly onOpen: (row: LibraryRow) => void
  readonly onSave: (row: LibraryRow) => void
  readonly onOlder: () => void
}

export function LibraryList({ view, busy, onOpen, onSave, onOlder }: LibraryListProps) {
  if (view.state === 'loading') return <p className="library-note" aria-busy="true">Loading the library…</p>
  if (view.state === 'refused') return <p className="library-note library-refused" role="alert">{view.message}</p>
  const reach = (
    <>
      {view.reached === null ? null : <p className="library-note">{view.reached}</p>}
      {view.older ? <button type="button" className="library-older" disabled={busy !== null} aria-busy={busy === 'older'} onClick={onOlder}>Look in older chats</button> : null}
    </>
  )
  if (view.state === 'empty') return <><p className="library-note">{view.hint}</p>{reach}</>
  return (
    <>
      <ul className="library" aria-label="Library">
        {view.rows.map(row => (
          <li key={row.id} className="library-item" aria-busy={busy === row.id}>
            <button type="button" className="library-name" onClick={() => onOpen(row)}>{row.name}</button>
            <span className="library-about">{row.when === '' ? row.type : `${row.type} · ${row.when}`}</span>
            {row.saves ? (
              <span className="library-controls">
                <button type="button" disabled={busy !== null} aria-label={`Save ${row.name}…`} onClick={() => onSave(row)}>Save…</button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {reach}
    </>
  )
}
