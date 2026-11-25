import { GROUP_NAME_MAX, type Bot, type CommandOutcome, type GroupDraft } from '@highwing/hermes/domain'
import { useId, useLayoutEffect, useReducer, useRef, type FormEvent } from 'react'
import { Avatar } from '../bots/Avatar'
import { groupFormOf, nextGroupForm, startGroupForm } from './group-form'

interface GroupFormProps {
  readonly offered: readonly Bot[]
  readonly onCreate: (draft: GroupDraft) => Promise<CommandOutcome>
  readonly onClose: () => void
}

const Search = () => <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
const Tick = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>

export function GroupForm({ offered, onCreate, onClose }: GroupFormProps) {
  const [state, dispatch] = useReducer(nextGroupForm, null, () => startGroupForm(crypto.randomUUID()))
  const dialog = useRef<HTMLDialogElement>(null)
  const ids = useId()
  useLayoutEffect(() => {
    const shown = dialog.current
    if (shown?.open === false) shown.showModal()
    return () => shown?.close()
  }, [])

  const view = groupFormOf(state, offered)
  const sending = state.send.at === 'sending'
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const { draft } = view
    if (sending || draft === null) return
    dispatch({ on: 'sent' })
    const outcome = await onCreate(draft)
    if (outcome.ok) onClose()
    else dispatch({ on: 'refused', refusal: outcome.refusal })
  }

  return (
    <dialog
      ref={dialog} className="bot-form group-form" aria-labelledby={`${ids}-title`} aria-describedby={`${ids}-lede`}
      onCancel={event => { event.preventDefault(); if (!sending) onClose() }}
    >
      <form onSubmit={event => void submit(event)} noValidate>
        <h2 id={`${ids}-title`}>New group chat</h2>
        <p className="lede" id={`${ids}-lede`}>Pick 2 to 6 bots. You can’t change who’s in the group later.</p>
        <div className="stacked">
          <label htmlFor={`${ids}-name`}>Name</label>
          <input
            id={`${ids}-name`} type="text" value={state.name} maxLength={GROUP_NAME_MAX} autoComplete="off"
            onChange={event => dispatch({ on: 'named', name: event.target.value })}
          />
        </div>
        <div className="stacked">
          <span className="flabel" id={`${ids}-bots`}>Bots</span>
          <div className="search">
            <Search />
            <input
              type="text" aria-label="Search bots" placeholder="Search bots" value={state.query} autoComplete="off" spellCheck={false}
              onChange={event => dispatch({ on: 'searched', query: event.target.value })}
              onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }}
            />
          </div>
          <ul className="pick-list" aria-labelledby={`${ids}-bots`}>
            {view.rows.map(({ bot, picked, locked }) => {
              const at = `${ids}-${bot.id}`
              return (
                <li key={bot.id}>
                  <label>
                    <input
                      type="checkbox" checked={picked} disabled={locked || sending} aria-labelledby={`${at}-name`}
                      aria-describedby={bot.description === null ? undefined : `${at}-about`}
                      onChange={() => dispatch({ on: 'toggled', bot: bot.id })}
                    />
                    <Avatar bot={bot} size={28} />
                    <span className="bot-text">
                      <span className="bot-name" id={`${at}-name`}>{bot.name}</span>
                      {bot.description !== null && <span className="bot-preview" id={`${at}-about`}>{bot.description}</span>}
                    </span>
                    <span className="box" aria-hidden="true">{picked && <Tick />}</span>
                  </label>
                </li>
              )
            })}
            {view.rows.length === 0 && state.query.trim() !== '' && <li className="pick-none">No bots match “{state.query}”</li>}
          </ul>
          <p className="tally" role="status">{view.tally}</p>
          {view.membersWords !== null && <p className="field-words" role="alert">{view.membersWords}</p>}
        </div>
        {view.otherWords !== null && <p className="form-refused" role="alert">{view.otherWords}</p>}
        <div className="form-choices">
          <button type="button" disabled={sending} onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={sending || view.draft === null} aria-busy={sending || undefined}>Create group chat</button>
        </div>
      </form>
    </dialog>
  )
}
