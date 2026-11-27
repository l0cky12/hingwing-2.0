import { APPROVAL_MODES, type ApprovalMode, type CommandOutcome } from '@highwing/hermes/domain'
import { useEffect, useId, useRef, useState } from 'react'
import { usePickMenu } from '../chat/menu'
import { Check } from '../chrome/ModeSwitch'

interface YoloPillProps {
  /** The chat's own YOLO flag. */
  readonly on: boolean
  /** The bot's approval mode. `off` runs the chat without asking whatever its own flag says. Null: Hermes never said it. */
  readonly approvals: ApprovalMode | null
  readonly onSet: (on: boolean) => Promise<CommandOutcome>
  readonly onApprovals: (to: ApprovalMode) => Promise<CommandOutcome>
}

type Asking =
  | { readonly at: 'idle' }
  | { readonly at: 'confirming'; readonly to: 'chatYolo' | 'botSmart' | 'botOff' }
  | { readonly at: 'sending' }
  | { readonly at: 'refused'; readonly message: string; readonly unsupported: boolean }

const CONFIRM = {
  chatYolo: { title: 'Turn on YOLO for this chat?', body: 'Hermes will run commands in this chat without asking.', yes: 'Turn on' },
  botSmart: {
    title: 'Turn off YOLO for this bot?',
    body: 'YOLO is on for every chat with this bot. Smart approvals runs the commands Hermes judges safe and asks you before risky ones.',
    yes: 'Use Smart'
  },
  botOff: { title: 'Turn off approvals for this bot?', body: 'Hermes will run every command in every chat with this bot without asking.', yes: 'Turn off' }
} as const

const MODES: { readonly [M in ApprovalMode]: { readonly name: string; readonly label: string; readonly line: string } } = {
  manual: { name: 'Manual', label: 'Manual approvals', line: 'Asks you before every risky command.' },
  smart: { name: 'Smart', label: 'Smart approvals', line: 'Runs safe commands, refuses dangerous ones, asks about the rest.' },
  off: { name: 'Off', label: 'Approvals off', line: 'Runs every command without asking.' }
}

export function YoloPill({ on, approvals, onSet, onApprovals }: YoloPillProps) {
  const [asking, setAsking] = useState<Asking>({ at: 'idle' })
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const heading = useId()
  const lines = useId()
  const menu = usePickMenu()
  const confirming = asking.at === 'confirming' ? asking.to : null
  const words = CONFIRM[confirming ?? 'chatYolo']
  const yolo = on || approvals === 'off'

  useEffect(() => {
    const box = dialog.current
    if (box === null || box.open === (confirming !== null)) return
    if (confirming !== null) {
      box.showModal()
      cancel.current?.focus()
    } else {
      box.close()
    }
  }, [confirming])

  const send = async (change: () => Promise<CommandOutcome>) => {
    setAsking({ at: 'sending' })
    const outcome = await change()
    setAsking(outcome.ok ? { at: 'idle' } : { at: 'refused', message: outcome.refusal.message, unsupported: outcome.refusal.kind === 'unsupported' })
  }

  const toSmart = async () => {
    const set = await onApprovals('smart')
    return set.ok && on ? onSet(false) : set
  }

  const pick = (to: ApprovalMode) => {
    menu.close()
    if (to === approvals) return
    if (to === 'off') setAsking({ at: 'confirming', to: 'botOff' })
    else void send(() => onApprovals(to))
  }

  const confirmed = () => {
    if (confirming === 'botSmart') return toSmart()
    if (confirming === 'botOff') return onApprovals('off')
    return onSet(true)
  }

  const press = () => {
    if (approvals === 'off') setAsking({ at: 'confirming', to: 'botSmart' })
    else if (on) void send(() => onSet(false))
    else setAsking({ at: 'confirming', to: 'chatYolo' })
  }

  return (
    <div className="yolo">
      {approvals !== null && (
        <div className="knob approvals" ref={menu.holder} onKeyDown={menu.onKeyDown}>
          <button
            ref={menu.toggle} type="button" className="readout" aria-haspopup="menu" aria-expanded={menu.open} disabled={asking.at === 'sending'}
            onClick={() => menu.setOpen(shown => !shown)}
          >
            {MODES[approvals].label}
            <span className="chev" aria-hidden="true" />
          </button>
          {menu.open && (
            <div {...menu.menuProps} className="file-menu approvals-menu" aria-label="Approvals">
              {APPROVAL_MODES.map(item => (
                <button
                  key={item} type="button" role="menuitemradio" aria-checked={item === approvals} aria-describedby={`${lines}-${item}`}
                  tabIndex={-1} onClick={() => pick(item)}
                >
                  <span className="mode-check" aria-hidden="true">{item === approvals && <Check />}</span>
                  <span>{MODES[item].name}</span>
                  <span className="approvals-line" id={`${lines}-${item}`} aria-hidden="true">{MODES[item].line}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {!(asking.at === 'refused' && asking.unsupported) && (
        <button type="button" className="pill" aria-pressed={yolo} disabled={asking.at === 'sending'} onClick={press}>
          {yolo ? 'YOLO on' : 'YOLO'}
        </button>
      )}
      {asking.at === 'refused' && <p className="err">{asking.message}</p>}
      <dialog
        ref={dialog} className="confirm-dialog" aria-labelledby={heading}
        onClose={() => setAsking(held => (held.at === 'confirming' ? { at: 'idle' } : held))}
      >
        <h2 id={heading}>{words.title}</h2>
        <p>{words.body}</p>
        <div className="actions">
          <button ref={cancel} type="button" onClick={() => setAsking({ at: 'idle' })}>Cancel</button>
          <button type="button" className="primary" onClick={() => void send(confirmed)}>{words.yes}</button>
        </div>
      </dialog>
    </div>
  )
}
