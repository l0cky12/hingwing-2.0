import type { CommandOutcome, Routine } from '@highwing/hermes/domain'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { scheduleWords } from './routines'

type Listing =
  | { readonly at: 'loading' }
  | { readonly at: 'listed'; readonly routines: readonly Routine[] }
  | { readonly at: 'refused'; readonly words: string }

interface RoutinesProps {
  readonly name: string
  /** Moves each time Hermes's cron store may have changed, so the list is asked for again. */
  readonly edition: number | undefined
  readonly onList: () => Promise<CommandOutcome<readonly Routine[]>>
}

/** A bot's routines, read from Hermes and asked for again whenever its cron store moves. The last list stays while it asks. */
export function Routines({ name, edition, onList }: RoutinesProps) {
  const [listing, setListing] = useState<Listing>({ at: 'loading' })
  const asked = useRef(0)
  useEffect(() => {
    const ask = ++asked.current
    void onList().then(outcome => {
      if (ask !== asked.current) return
      setListing(outcome.ok ? { at: 'listed', routines: outcome.value } : { at: 'refused', words: outcome.refusal.message })
    })
  }, [edition])

  switch (listing.at) {
    case 'loading':
      return <p className="routines-note" role="status">Reading routines…</p>
    case 'refused':
      return <p className="form-refused" role="alert">{listing.words}</p>
    case 'listed':
      return listing.routines.length === 0
        ? <p className="routines-note">{name} has no routines yet. To make one, ask {name} in a chat, for example “Every weekday at 9, send me the news.”</p>
        : (
          <ul className="routines">
            {listing.routines.map(routine => (
              <li key={routine.id}>
                <span className="routine-name">{routine.name}</span>
                <span className="routine-when">{scheduleWords(routine.schedule)}</span>
                {routine.paused && <span className="routine-paused">Paused</span>}
              </li>
            ))}
          </ul>
        )
  }
}

interface RoutinesDialogProps extends RoutinesProps {
  readonly onClose: () => void
}

export function RoutinesDialog({ onClose, ...listed }: RoutinesDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  useLayoutEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])
  return (
    <dialog ref={dialog} className="confirm-dialog routines-dialog" aria-labelledby={heading} onCancel={event => { event.preventDefault(); onClose() }}>
      <h2 id={heading}>Routines for {listed.name}</h2>
      <Routines {...listed} />
      <div className="actions">
        <button type="button" className="primary" onClick={onClose}>Close</button>
      </div>
    </dialog>
  )
}
