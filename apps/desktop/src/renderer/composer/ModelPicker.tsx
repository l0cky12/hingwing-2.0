import { sameModel, type CommandOutcome, type ModelConfirm, type ModelOption, type ModelRef, type ModelView } from '@highwing/hermes/domain'
import { useEffect, useId, useRef, useState } from 'react'

interface ModelPickerProps {
  readonly view: Exclude<ModelView, { show: 'hidden' }>
  readonly onOpen: () => void
  readonly onPick: (model: ModelOption, confirm: string | null) => Promise<CommandOutcome<ModelConfirm | null>>
}

export const LATER = 'Applies to the next message.'

const optionFor = (options: readonly ModelOption[], model: ModelRef): ModelOption =>
  options.find(option => sameModel(model, option)) ?? { id: model.id, provider: model.provider ?? '', providerName: model.provider ?? '' }

type Asking =
  | { readonly at: 'idle' }
  | { readonly at: 'sending'; readonly model: ModelOption }
  | { readonly at: 'confirm'; readonly model: ModelOption; readonly confirm: ModelConfirm }
  | { readonly at: 'refused'; readonly message: string }

export function ModelPicker({ view, onOpen, onPick }: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState<Asking>({ at: 'idle' })
  const anchor = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const onPress = (event: PointerEvent) => { if (!anchor.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPress)
    }
  }, [open])

  const toggle = () => {
    if (!open) {
      setAsking({ at: 'idle' })
      onOpen()
    }
    setOpen(!open)
  }

  const pick = async (model: ModelOption, confirm: string | null = null, keeping = false) => {
    setAsking({ at: 'sending', model })
    const first = await onPick(model, confirm)
    // Staying on the model the chat already runs takes on no new cost, so a guard Hermes raises for it is answered at once.
    const outcome = keeping && first.ok && first.value !== null ? await onPick(model, first.value.token) : first
    if (!outcome.ok) setAsking({ at: 'refused', message: outcome.refusal.message })
    else setAsking(outcome.value === null ? { at: 'idle' } : { at: 'confirm', model, confirm: outcome.value })
  }

  const label = view.show === 'none'
    ? 'No model set up'
    : `Model${view.current === null ? '' : `: ${view.current.id}`}${view.next === null ? '' : `, then ${view.next.id}`}`

  // Hermes asked for a yes either in answer to this window's pick, or for a pick it held until a turn ended.
  const held = view.show === 'list' ? view.ask : null
  const confirming = asking.at === 'confirm'
    ? { model: asking.model, token: asking.confirm.token, message: asking.confirm.message }
    : held !== null && view.show === 'list' && asking.at !== 'sending'
      ? { model: optionFor(view.options, held.model), token: held.token, message: held.message }
      : null
  const keep = view.show === 'list' && view.current !== null ? optionFor(view.options, view.current) : null

  return (
    <div className="model">
      <div className="anchor" ref={anchor}>
        <button
          type="button"
          className={view.show === 'none' ? 'readout none' : 'readout'}
          aria-expanded={open}
          aria-haspopup="true"
          aria-controls={open ? listId : undefined}
          onClick={toggle}
        >
          {label}
          <span className="chev" aria-hidden="true" />
        </button>
        {open && (
          <div className="list" id={listId}>
            {view.show === 'none' ? (
              <p className="empty">Hermes has no provider signed in. Set one up with Hermes on its machine, then open this list again.</p>
            ) : (
              <Choices view={view} asking={asking} onPick={model => void pick(model)} />
            )}
          </div>
        )}
      </div>
      {!open && view.show === 'list' && view.next !== null && <span className="later">{LATER}</span>}
      {asking.at === 'refused' && <p className="err">{asking.message}</p>}
      {confirming !== null && (
        <div className="confirm" role="alert">
          <p>{confirming.message}</p>
          <button type="button" className="primary" onClick={() => void pick(confirming.model, confirming.token)}>Use {confirming.model.id} anyway</button>
          {/* A newer pick replaces the one Hermes holds (persistence/sqlite/authority/_runtime_picks.py:61-69). Only
              declining in this window would leave Hermes asking again on every attach (gateway/session_deferred_pick.py:46-54). */}
          {keep !== null && (
            <button type="button" onClick={() => (asking.at === 'confirm' && held === null ? setAsking({ at: 'idle' }) : void pick(keep, null, true))}>Keep {keep.id}</button>
          )}
        </div>
      )}
    </div>
  )
}

function Choices({ view, asking, onPick }: {
  readonly view: Extract<ModelView, { show: 'list' }>
  readonly asking: Asking
  readonly onPick: (model: ModelOption) => void
}) {
  const name = useId()
  const chosen = view.next ?? view.current
  // A model named without its provider checks only the first provider that offers it.
  const checked = chosen === null ? undefined : view.options.find(option => sameModel(chosen, option))
  const providers = [...new Set(view.options.map(option => option.provider))]
  const grouped = providers.length > 1
  return (
    <>
      <div role="radiogroup" aria-label="Model">
        {providers.map(provider => {
          const options = view.options.filter(option => option.provider === provider)
          return (
            <div key={provider} className="provider">
              {grouped && <p className="name">{options[0]?.providerName}</p>}
              {options.map(option => (
                <label key={option.id} className="choice">
                  <input
                    type="radio"
                    name={name}
                    checked={option === checked}
                    disabled={asking.at === 'sending'}
                    onChange={() => onPick(option)}
                  />
                  {option.id}
                </label>
              ))}
            </div>
          )
        })}
      </div>
      {view.deferring && <p className="later">{LATER}</p>}
    </>
  )
}
