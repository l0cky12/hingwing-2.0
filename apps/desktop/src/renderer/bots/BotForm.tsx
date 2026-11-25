import { sameModel, type BotDraft, type CommandOutcome, type ModelMenu } from '@highwing/hermes/domain'
import { useId, useLayoutEffect, useReducer, useRef, type FormEvent } from 'react'
import { canSubmit, groupModels, nextForm, startForm } from './bot-form'

interface BotFormProps {
  readonly title: string
  readonly submitLabel: string
  readonly initial: BotDraft
  readonly problemOf: (name: string) => string | null
  readonly models: ModelMenu | null
  readonly onSubmit: (draft: BotDraft) => Promise<CommandOutcome<unknown>>
  readonly onClose: () => void
}

const DEFAULT_MODEL = "Hermes's default"

export function BotForm({ title, submitLabel, initial, problemOf, models, onSubmit, onClose }: BotFormProps) {
  const [{ draft, send }, dispatch] = useReducer(nextForm, initial, startForm)
  const dialog = useRef<HTMLDialogElement>(null)
  const ids = useId()
  useLayoutEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  const sending = send.at === 'sending'
  const problem = sending ? null : problemOf(draft.name)
  const nameWords = problem ?? (send.at === 'refused' && send.refusal.field === 'name' ? send.refusal.message : null)
  const otherWords = send.at === 'refused' && send.refusal.field !== 'name' ? send.refusal.message : null
  const options = models?.options ?? []
  const chosen = draft.model
  const picked = chosen === null ? -1 : options.findIndex(option => sameModel(chosen, option))
  const ready = !sending && canSubmit(draft, problem)

  const type = (more: Partial<BotDraft>) => dispatch({ on: 'typed', draft: { ...draft, ...more } })
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready) return
    dispatch({ on: 'sent' })
    const outcome = await onSubmit(draft)
    if (outcome.ok) onClose()
    else dispatch({ on: 'refused', refusal: outcome.refusal })
  }

  return (
    <dialog ref={dialog} className="bot-form" aria-labelledby={`${ids}-title`} onCancel={event => { event.preventDefault(); if (!sending) onClose() }}>
      <form onSubmit={event => void submit(event)} noValidate>
        <h2 id={`${ids}-title`}>{title}</h2>
        <div className="field">
          <label htmlFor={`${ids}-name`}>Name</label>
          <input
            id={`${ids}-name`} value={draft.name} autoComplete="off" spellCheck={false}
            aria-invalid={nameWords !== null || undefined} aria-describedby={nameWords === null ? undefined : `${ids}-name-words`}
            onChange={event => type({ name: event.target.value })}
          />
          {nameWords !== null && <p className="field-words" id={`${ids}-name-words`}>{nameWords}</p>}
        </div>
        <div className="field">
          <label htmlFor={`${ids}-description`}>Description</label>
          <input id={`${ids}-description`} value={draft.description} onChange={event => type({ description: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-model`}>Model</label>
          <select
            id={`${ids}-model`} value={picked < 0 ? '' : String(picked)}
            onChange={event => type({ model: event.target.value === '' ? null : options[Number(event.target.value)] ?? null })}
          >
            <option value="">{DEFAULT_MODEL}</option>
            {groupModels(options).map(group => (
              <optgroup key={group.provider} label={group.label}>
                {group.options.map(({ index, option }) => <option key={index} value={index}>{option.id}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-persona`}>Persona</label>
          <textarea id={`${ids}-persona`} rows={4} value={draft.persona} onChange={event => type({ persona: event.target.value })} />
        </div>
        {otherWords !== null && <p className="form-refused" role="alert">{otherWords}</p>}
        <div className="form-choices">
          {/* A create already sent finishes in this form, so its answer never lands on a form opened after it. */}
          <button type="button" disabled={sending} onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!ready} aria-busy={sending || undefined}>{submitLabel}</button>
        </div>
      </form>
    </dialog>
  )
}
