import type { CommandOutcome, Tuning } from '@highwing/hermes/domain'
import { useId, useState } from 'react'
import { LATER } from './ModelPicker'
import { usePopover } from './popover'
import { EFFORT_WORDS, LEVELS, thinkingLabel, type ThinkingTune } from './tuning'

interface ThinkingPillProps {
  readonly tuning: Tuning
  readonly disabled: boolean
  readonly running: boolean
  readonly onTune: (tune: ThinkingTune) => Promise<CommandOutcome>
}

type Asking = { readonly at: 'idle' } | { readonly at: 'sending' } | { readonly at: 'refused'; readonly message: string }

export function ThinkingPill({ tuning, disabled, running, onTune }: ThinkingPillProps) {
  const { shown, setOpen, anchor, button } = usePopover(!disabled)
  const [asking, setAsking] = useState<Asking>({ at: 'idle' })
  const boxId = useId()

  const toggle = () => {
    if (!shown) setAsking(held => (held.at === 'sending' ? held : { at: 'idle' }))
    setOpen(!shown)
  }

  const tune = async (change: ThinkingTune) => {
    if (asking.at === 'sending') return
    setAsking({ at: 'sending' })
    const outcome = await onTune(change)
    setAsking(outcome.ok ? { at: 'idle' } : { at: 'refused', message: outcome.refusal.message })
  }

  return (
    <div className="knob" ref={anchor}>
      <button
        ref={button} type="button" className="readout" disabled={disabled}
        aria-expanded={shown} aria-haspopup="dialog" aria-controls={shown ? boxId : undefined} onClick={toggle}
      >
        {thinkingLabel(tuning)}
        <span className="chev" aria-hidden="true" />
      </button>
      {shown && (
        <div className="pop" id={boxId} role="dialog" aria-label="Thinking">
          <ThinkingChoices tuning={tuning} sending={asking.at === 'sending'} onTune={change => void tune(change)} />
          {running && <p className="later">{LATER}</p>}
          {asking.at === 'refused' && <p className="err">{asking.message}</p>}
        </div>
      )}
    </div>
  )
}

export function ThinkingChoices({ tuning, sending, onTune }: {
  readonly tuning: Tuning
  readonly sending: boolean
  readonly onTune: (tune: ThinkingTune) => void
}) {
  const name = useId()
  const { effort, fast, reasoning } = tuning
  return (
    <>
      {effort !== null && (
        <div role="radiogroup" aria-label="Effort">
          {LEVELS.map(level => (
            <label key={level} className="choice">
              <input type="radio" name={name} checked={level === effort} disabled={sending} onChange={() => onTune({ set: 'effort', to: level })} />
              {EFFORT_WORDS[level]}
            </label>
          ))}
        </div>
      )}
      {(fast !== null || reasoning !== null) && (
        <div className="switches">
          {fast !== null && (
            <label className="choice">
              <input type="checkbox" role="switch" checked={fast} disabled={sending} onChange={() => onTune({ set: 'fast', on: !fast })} />
              Fast
            </label>
          )}
          {reasoning !== null && (
            <label className="choice">
              <input type="checkbox" role="switch" checked={reasoning} disabled={sending} onChange={() => onTune({ set: 'reasoning', on: !reasoning })} />
              Show reasoning
            </label>
          )}
        </div>
      )}
    </>
  )
}
