import { APPROVAL_WORDS, asksOf, isRunTime, personaStart, scheduleWords, templatePlan, toolWords, type BotCreated, type BotTemplate, type CommandOutcome, type Refusal, type TemplateAnswers } from '@highwing/hermes/domain'
import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'

interface TemplateDialogProps {
  readonly template: BotTemplate
  readonly problemOf: (name: string) => string | null
  readonly onCreate: (answers: TemplateAnswers) => Promise<CommandOutcome<BotCreated>>
  readonly onClose: () => void
}

type Send = { readonly at: 'idle' } | { readonly at: 'sending' } | { readonly at: 'refused'; readonly refusal: Refusal }

export function TemplateDialog({ template, problemOf, onCreate, onClose }: TemplateDialogProps) {
  const ids = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const nameField = useRef<HTMLInputElement>(null)
  const [name, setName] = useState<string>(template.id)
  const [folder, setFolder] = useState('')
  const [time, setTime] = useState(template.schedule?.defaultTime ?? '')
  const [send, setSend] = useState<Send>({ at: 'idle' })
  const asks = asksOf(template)
  const approval = APPROVAL_WORDS[template.approval]
  const sending = send.at === 'sending'
  const answers = { name, folder, time }
  const problem = sending ? null : problemOf(name)
  const nameWords = problem ?? (send.at === 'refused' && send.refusal.field === 'name' ? send.refusal.message : null)
  const otherWords = send.at === 'refused' && send.refusal.field !== 'name' ? send.refusal.message : null
  const ready = !sending && problem === null && templatePlan(template, answers) !== null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready) return
    setSend({ at: 'sending' })
    const outcome = await onCreate(answers)
    if (outcome.ok) onClose()
    else setSend({ at: 'refused', refusal: outcome.refusal })
  }

  useLayoutEffect(() => {
    const shown = dialog.current
    if (shown?.open === false) shown.showModal()
    nameField.current?.focus()
    return () => shown?.close()
  }, [])

  return (
    <dialog ref={dialog} className="bot-form template-dialog" aria-labelledby={`${ids}-title`} onCancel={event => { event.preventDefault(); if (!sending) onClose() }}>
      <form onSubmit={event => void submit(event)} noValidate>
        <h2 id={`${ids}-title`}>Use template: {template.name}</h2>
        <div className="bot-form-body">
          <div className="field">
            <label htmlFor={`${ids}-name`}>Bot name</label>
            <input
              ref={nameField} id={`${ids}-name`} value={name} autoComplete="off" spellCheck={false} disabled={sending}
              aria-invalid={nameWords !== null || undefined} aria-describedby={nameWords === null ? undefined : `${ids}-name-words`}
              onChange={event => setName(event.target.value)}
            />
            {nameWords !== null && <p className="field-words" id={`${ids}-name-words`}>{nameWords}</p>}
          </div>
          {asks.includes('repo-folder') && (
            <div className="field">
              <label htmlFor={`${ids}-folder`}>Repository folder</label>
              <div className="field-stack">
                <input
                  id={`${ids}-folder`} value={folder} placeholder="/home/you/code/my-project" autoComplete="off" spellCheck={false} aria-required="true" disabled={sending}
                  aria-describedby={`${ids}-folder-hint`} onChange={event => setFolder(event.target.value)}
                />
                <p className="field-hint" id={`${ids}-folder-hint`}>A folder path on the computer Hermes runs on, not on this one.</p>
              </div>
            </div>
          )}
          {asks.includes('run-time') && (
            <div className="field">
              <label htmlFor={`${ids}-time`}>Run time</label>
              <input id={`${ids}-time`} type="time" value={time} disabled={sending} onChange={event => setTime(event.target.value)} />
            </div>
          )}
          <section className="template-sets" aria-label="What it sets up">
            <h3>What it sets up</h3>
            <dl>
              <dt>Personality</dt>
              <dd>{personaStart(template.persona)}</dd>
              <dt>Tools</dt>
              <dd>{toolWords(template.toolsets)}</dd>
              <dt>Approval</dt>
              <dd>{approval.label}: {approval.says}</dd>
              {template.schedule !== null && <><dt>Schedule</dt><dd>{isRunTime(time) ? scheduleWords(time) : 'Pick a run time'}</dd></>}
            </dl>
          </section>
        </div>
        {otherWords !== null && <p className="form-refused" role="alert">{otherWords}</p>}
        <div className="form-choices">
          <button type="button" disabled={sending} onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!ready} aria-busy={sending || undefined}>{sending ? 'Creating…' : 'Create bot'}</button>
        </div>
      </form>
    </dialog>
  )
}
