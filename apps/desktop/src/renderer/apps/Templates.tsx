import { APPROVAL_WORDS, asksOf, personaStart, scheduleWords, toolWords, type BotTemplate } from '@highwing/hermes/domain'
import { useId, useLayoutEffect, useRef, useState } from 'react'

export function TemplateDialog({ template, onClose }: { readonly template: BotTemplate; readonly onClose: () => void }) {
  const ids = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const nameField = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(template.name)
  const [folder, setFolder] = useState('')
  const [time, setTime] = useState(template.schedule?.defaultTime ?? '')
  const asks = asksOf(template)
  const approval = APPROVAL_WORDS[template.approval]

  useLayoutEffect(() => {
    const shown = dialog.current
    if (shown?.open === false) shown.showModal()
    nameField.current?.focus()
    return () => shown?.close()
  }, [])

  return (
    <dialog ref={dialog} className="bot-form template-dialog" aria-labelledby={`${ids}-title`} onCancel={event => { event.preventDefault(); onClose() }}>
      <form onSubmit={event => event.preventDefault()} noValidate>
        <h2 id={`${ids}-title`}>Use template: {template.name}</h2>
        <div className="bot-form-body">
          <div className="field">
            <label htmlFor={`${ids}-name`}>Bot name</label>
            <input ref={nameField} id={`${ids}-name`} value={name} autoComplete="off" spellCheck={false} onChange={event => setName(event.target.value)} />
          </div>
          {asks.includes('repo-folder') && (
            <div className="field">
              <label htmlFor={`${ids}-folder`}>Repository folder</label>
              <div className="field-stack">
                <input
                  id={`${ids}-folder`} value={folder} placeholder="/home/you/code/my-project" autoComplete="off" spellCheck={false} aria-required="true"
                  aria-describedby={`${ids}-folder-hint`} onChange={event => setFolder(event.target.value)}
                />
                <p className="field-hint" id={`${ids}-folder-hint`}>A folder path on the computer Hermes runs on, not on this one.</p>
              </div>
            </div>
          )}
          {asks.includes('run-time') && (
            <div className="field">
              <label htmlFor={`${ids}-time`}>Run time</label>
              <input id={`${ids}-time`} type="time" value={time} onChange={event => setTime(event.target.value)} />
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
              {template.schedule !== null && <><dt>Schedule</dt><dd>{scheduleWords(time)}</dd></>}
            </dl>
          </section>
        </div>
        <div className="form-choices">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled aria-describedby={`${ids}-soon`}>Create bot</button>
        </div>
        <p className="form-soon" id={`${ids}-soon`}>Making the bot comes in the next update.</p>
      </form>
    </dialog>
  )
}
