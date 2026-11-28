import { APPROVAL_MODES, APPROVAL_WORDS, type ApprovalMode, type CommandOutcome } from '@highwing/hermes/domain'
import { useEffect, useId, useRef, useState } from 'react'
import { usePickMenu } from '../chat/menu'
import { Check } from '../chrome/ModeSwitch'

interface ApprovalsProps {
  /** The bot's approval mode. `off` runs the chat without asking whatever its own flag says. */
  readonly mode: ApprovalMode
  /** The chat's own YOLO flag, set by `/yolo` or another client. On, the chat runs without asking, so the menu reads Off. */
  readonly yolo: boolean
  readonly onMode: (to: ApprovalMode) => Promise<CommandOutcome>
  readonly onYolo: (on: false) => Promise<CommandOutcome>
}

type Asking =
  | { readonly at: 'idle' }
  | { readonly at: 'confirming' }
  | { readonly at: 'sending' }
  | { readonly at: 'refused'; readonly message: string }

export function Approvals({ mode, yolo, onMode, onYolo }: ApprovalsProps) {
  const [asking, setAsking] = useState<Asking>({ at: 'idle' })
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const heading = useId()
  const lines = useId()
  const menu = usePickMenu()
  const confirming = asking.at === 'confirming'
  const shown: ApprovalMode = yolo ? 'off' : mode

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

  const send = async (change: () => Promise<CommandOutcome>) => {
    setAsking({ at: 'sending' })
    const outcome = await change()
    setAsking(outcome.ok ? { at: 'idle' } : { at: 'refused', message: outcome.refusal.message })
  }

  // The chat's own flag would keep it running without asking, so leaving Off turns that off too.
  const ask = async (to: ApprovalMode) => {
    if (to !== mode) {
      const set = await onMode(to)
      if (!set.ok || !yolo) return set
    }
    return onYolo(false)
  }

  const pick = (to: ApprovalMode) => {
    menu.close()
    if (to === shown) return
    if (to === 'off') setAsking({ at: 'confirming' })
    else void send(() => ask(to))
  }

  return (
    <div className="approvals-mode">
      <div className="knob approvals" ref={menu.holder} onKeyDown={menu.onKeyDown}>
        <button
          ref={menu.toggle} type="button" className="readout" aria-haspopup="menu" aria-expanded={menu.open} disabled={asking.at === 'sending'}
          onClick={() => menu.setOpen(open => !open)}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="M8 2 3 4v3.6c0 3 2.1 5.4 5 6.4 2.9-1 5-3.4 5-6.4V4z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
          {shown === 'off' && <span className="sr">Approvals </span>}
          <span className="value">{APPROVAL_WORDS[shown].name}</span>
          {shown !== 'off' && <span className="sr"> approvals</span>}
          <span className="chev" aria-hidden="true" />
        </button>
        {menu.open && (
          <div {...menu.menuProps} className="file-menu approvals-menu" aria-label="Approvals">
            {APPROVAL_MODES.map(item => (
              <button
                key={item} type="button" role="menuitemradio" aria-checked={item === shown} aria-describedby={`${lines}-${item}`}
                tabIndex={-1} onClick={() => pick(item)}
              >
                <span className="mode-check" aria-hidden="true">{item === shown && <Check />}</span>
                <span>{APPROVAL_WORDS[item].name}</span>
                <span className="approvals-line" id={`${lines}-${item}`} aria-hidden="true">{APPROVAL_WORDS[item].line}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {asking.at === 'refused' && <p className="err">{asking.message}</p>}
      <dialog
        ref={dialog} className="confirm-dialog" aria-labelledby={heading}
        onClose={() => setAsking(held => (held.at === 'confirming' ? { at: 'idle' } : held))}
      >
        <h2 id={heading}>Turn off approvals for this bot?</h2>
        <p>Hermes will run every command in every chat with this bot without asking.</p>
        <div className="actions">
          <button ref={cancel} type="button" onClick={() => setAsking({ at: 'idle' })}>Cancel</button>
          <button type="button" className="primary" onClick={() => void send(() => onMode('off'))}>Turn off</button>
        </div>
      </dialog>
    </div>
  )
}
