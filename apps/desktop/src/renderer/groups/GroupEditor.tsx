import { GROUP_NAME_MAX, type CommandOutcome, type GroupId } from '@highwing/hermes/domain'
import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Avatar } from '../bots/Avatar'
import { renamedTo, type GroupSend } from './group-form'
import type { GroupRowView } from './group-rows'

interface GroupEditorProps {
  readonly group: Pick<GroupRowView, 'id' | 'name' | 'members'>
  readonly onRename: (group: GroupId, name: string) => Promise<CommandOutcome>
  readonly onClose: () => void
}

const EDITING: GroupSend = { at: 'editing' }

export function GroupEditor({ group, onRename, onClose }: GroupEditorProps) {
  const [name, setName] = useState(group.name)
  const [send, setSend] = useState<GroupSend>(EDITING)
  const dialog = useRef<HTMLDialogElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const ids = useId()
  useLayoutEffect(() => {
    const shown = dialog.current
    if (shown?.open === false) shown.showModal()
    field.current?.focus()
    field.current?.select()
    return () => shown?.close()
  }, [])

  const sending = send.at === 'sending'
  const renamed = renamedTo(name, group.name)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending || renamed === null) return
    setSend({ at: 'sending' })
    const outcome = await onRename(group.id, renamed)
    if (outcome.ok) onClose()
    else setSend({ at: 'refused', refusal: outcome.refusal })
  }

  return (
    <dialog
      ref={dialog} className="bot-form group-form group-editor" aria-labelledby={`${ids}-title`}
      onCancel={event => { event.preventDefault(); if (!sending) onClose() }}
    >
      <form onSubmit={event => void submit(event)} noValidate>
        <h2 id={`${ids}-title`}>Edit group chat</h2>
        <div className="stacked">
          <label htmlFor={`${ids}-name`}>Name</label>
          <input
            ref={field} id={`${ids}-name`} type="text" value={name} maxLength={GROUP_NAME_MAX} autoComplete="off" readOnly={sending}
            onChange={event => { setName(event.target.value); setSend(EDITING) }}
          />
        </div>
        <div className="stacked">
          <span className="flabel" id={`${ids}-members`}>Members</span>
          <ul className="member-list" aria-labelledby={`${ids}-members`}>
            {group.members.map(bot => <li key={bot.id}><Avatar bot={bot} size={28} />{bot.name}</li>)}
          </ul>
          <p className="member-note">Hermes can’t change who’s in a group.</p>
        </div>
        {send.at === 'refused' && <p className="form-refused" role="alert">{send.refusal.message}</p>}
        <div className="form-choices">
          <button type="button" disabled={sending} onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={sending || renamed === null} aria-busy={sending || undefined}>Save</button>
        </div>
      </form>
    </dialog>
  )
}
