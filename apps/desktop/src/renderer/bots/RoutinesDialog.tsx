import type { Bot, RoutineList, Routines } from '@highwing/hermes/domain'
import { useLayoutEffect, useRef } from 'react'

interface RoutinesDialogProps {
  readonly bot: Bot
  readonly routines: Routines | undefined
  readonly onClose: () => void
}

const READING: RoutineList = { state: 'reading' }

function Listing({ bot, list }: { readonly bot: Bot; readonly list: RoutineList }) {
  switch (list.state) {
    case 'reading':
      return <p role="status">Reading routines…</p>
    case 'refused':
      return <p className="form-refused" role="alert">{list.message}</p>
    case 'listed':
      if (list.routines.length === 0) {
        return (
          <p className="empty">
            {bot.name} has no routines yet. To make one, ask {bot.name} in a chat to do something on a schedule, such as “Every weekday at 9am, summarise my inbox.”
          </p>
        )
      }
      return (
        <ul aria-label="Routines">
          {list.routines.map(routine => (
            <li key={routine.id}>
              <span className="name">{routine.name}</span>
              <span className="schedule">{routine.schedule}</span>
              {routine.paused && <span className="paused-tag">Paused</span>}
            </li>
          ))}
        </ul>
      )
  }
}

export function RoutinesDialog({ bot, routines, onClose }: RoutinesDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (dialog.current?.open === false) {
      dialog.current.showModal()
      close.current?.focus()
    }
  }, [])
  const list = routines?.bot === bot.id ? routines.list : READING
  return (
    <dialog
      ref={dialog} className="confirm-dialog routines-dialog" aria-label={`Routines for ${bot.name}`}
      onCancel={event => { event.preventDefault(); onClose() }}
    >
      <h2>Routines</h2>
      <p className="whose">{bot.name}</p>
      <Listing bot={bot} list={list} />
      <div className="actions">
        <button ref={close} type="button" onClick={onClose}>Close</button>
      </div>
    </dialog>
  )
}
