import type { CommandOutcome } from '@highwing/hermes/domain'
import { useEffect, useId, useRef, useState } from 'react'

interface YoloPillProps {
  readonly on: boolean
  readonly onSet: (on: boolean) => Promise<CommandOutcome>
}

type Asking =
  | { readonly at: 'idle' }
  | { readonly at: 'confirming' }
  | { readonly at: 'sending' }
  | { readonly at: 'refused'; readonly message: string; readonly unsupported: boolean }

export function YoloPill({ on, onSet }: YoloPillProps) {
  const [asking, setAsking] = useState<Asking>({ at: 'idle' })
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const heading = useId()
  const confirming = asking.at === 'confirming'

  useEffect(() => {
    const box = dialog.current
    if (box === null || box.open === confirming) return
    if (confirming) {
      box.showModal()
      cancel.current?.focus()
    } else {
      box.close()
    }
  }, [confirming])

  const send = async (next: boolean) => {
    setAsking({ at: 'sending' })
    const outcome = await onSet(next)
    setAsking(outcome.ok ? { at: 'idle' } : { at: 'refused', message: outcome.refusal.message, unsupported: outcome.refusal.kind === 'unsupported' })
  }

  const press = () => {
    if (on) void send(false)
    else setAsking({ at: 'confirming' })
  }

  return (
    <div className="yolo">
      {!(asking.at === 'refused' && asking.unsupported) && (
        <button type="button" className="pill" aria-pressed={on} disabled={asking.at === 'sending'} onClick={press}>
          {on ? 'YOLO on' : 'YOLO'}
        </button>
      )}
      {asking.at === 'refused' && <p className="err">{asking.message}</p>}
      <dialog
        ref={dialog} className="confirm-dialog" aria-labelledby={heading}
        onClose={() => setAsking(held => (held.at === 'confirming' ? { at: 'idle' } : held))}
      >
        <h2 id={heading}>Turn on YOLO for this chat?</h2>
        <p>Hermes will run commands in this chat without asking.</p>
        <div className="actions">
          <button ref={cancel} type="button" onClick={() => setAsking({ at: 'idle' })}>Cancel</button>
          <button type="button" className="primary" onClick={() => void send(true)}>Turn on</button>
        </div>
      </dialog>
    </div>
  )
}
