import type { CommandOutcome } from '@highwing/hermes/domain'
import { useId, useState, type FormEvent } from 'react'
import { usePopover } from './popover'

interface FolderChipProps {
  readonly cwd: string
  readonly field: string
  readonly disabled: boolean
  readonly running: boolean
  readonly onMove: (cwd: string) => Promise<CommandOutcome>
}

type Asking = { readonly at: 'idle' } | { readonly at: 'sending' } | { readonly at: 'refused'; readonly message: string }

export function FolderChip({ cwd, field, disabled, running, onMove }: FolderChipProps) {
  const { shown, setOpen, anchor, button } = usePopover(!disabled)
  const [draft, setDraft] = useState(cwd)
  const [asking, setAsking] = useState<Asking>({ at: 'idle' })
  const boxId = useId()
  const fieldId = useId()
  const to = draft.trim()
  const leaf = cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || cwd

  const toggle = () => {
    if (!shown && asking.at !== 'sending') {
      setDraft(cwd)
      setAsking({ at: 'idle' })
    }
    setOpen(!shown)
  }

  const move = async (event: FormEvent) => {
    event.preventDefault()
    if (asking.at === 'sending') return
    setAsking({ at: 'sending' })
    const outcome = await onMove(to)
    if (!outcome.ok) return setAsking({ at: 'refused', message: outcome.refusal.message })
    setAsking({ at: 'idle' })
    setOpen(false)
    button.current?.focus()
  }

  return (
    <div className="knob shrinks-first" ref={anchor}>
      <button
        ref={button} type="button" className="readout" disabled={disabled} title={cwd} aria-label={`Folder: ${cwd}`}
        aria-expanded={shown} aria-haspopup="dialog" aria-controls={shown ? boxId : undefined} onClick={toggle}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="M2 4.5c0-.6.4-1 1-1h3.2l1.5 1.6H13c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
        <span className="value">{leaf}</span>
        <span className="chev" aria-hidden="true" />
      </button>
      {shown && (
        <div className="pop folder" id={boxId} role="dialog" aria-label="Chat folder">
          <form onSubmit={event => void move(event)}>
            <label htmlFor={fieldId}>{field}</label>
            <input id={fieldId} type="text" spellCheck={false} autoComplete="off" autoFocus value={draft} onChange={event => setDraft(event.target.value)} />
            <button type="submit" disabled={running || asking.at === 'sending' || to === '' || to === cwd}>Move</button>
          </form>
          {running && <p className="later">You can move the chat when Hermes is idle.</p>}
          {asking.at === 'refused' && <p className="err">{asking.message}</p>}
        </div>
      )}
    </div>
  )
}
