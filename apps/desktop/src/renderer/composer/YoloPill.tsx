import type { ApprovalMode, CommandOutcome } from '@highwing/hermes/domain'
import { useEffect, useId, useRef, useState } from 'react'

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
  /** `yolo`: turn YOLO on for this chat. `smart`: take the whole bot off YOLO, onto Smart. */
  | { readonly at: 'confirming'; readonly to: 'yolo' | 'smart' }
  | { readonly at: 'sending' }
  | { readonly at: 'refused'; readonly message: string; readonly unsupported: boolean }

const CONFIRM = {
  yolo: { title: 'Turn on YOLO for this chat?', body: 'Hermes will run commands in this chat without asking.', yes: 'Turn on' },
  smart: {
    title: 'Turn off YOLO for this bot?',
    body: 'YOLO is on for every chat with this bot. Smart approvals runs the commands Hermes judges safe and asks you before risky ones.',
    yes: 'Use Smart'
  }
} as const

const MODE_WORDS: { readonly [M in Exclude<ApprovalMode, 'off'>]: { readonly label: string; readonly title: string } } = {
  smart: { label: 'Smart', title: 'Hermes runs the commands it judges safe and asks you before risky ones.' },
  manual: { label: 'Manual', title: 'Hermes asks you before every command it flags as risky.' }
}

export function YoloPill({ on, approvals, onSet, onApprovals }: YoloPillProps) {
  const [asking, setAsking] = useState<Asking>({ at: 'idle' })
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const heading = useId()
  const confirming = asking.at === 'confirming' ? asking.to : null
  const words = CONFIRM[confirming ?? 'yolo']
  const yolo = on || approvals === 'off'
  const mode = !yolo && approvals !== null ? MODE_WORDS[approvals] : null

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

  const press = () => {
    if (approvals === 'off') setAsking({ at: 'confirming', to: 'smart' })
    else if (on) void send(() => onSet(false))
    else setAsking({ at: 'confirming', to: 'yolo' })
  }

  return (
    <div className="yolo">
      {mode !== null && (
        <span className="approvals" title={mode.title}>
          <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="M8 2 3 4v3.6c0 3 2.1 5.4 5 6.4 2.9-1 5-3.4 5-6.4V4z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
          {mode.label}<span className="sr"> approvals</span>
        </span>
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
          <button type="button" className="primary" onClick={() => void send(confirming === 'smart' ? toSmart : () => onSet(true))}>{words.yes}</button>
        </div>
      </dialog>
    </div>
  )
}
