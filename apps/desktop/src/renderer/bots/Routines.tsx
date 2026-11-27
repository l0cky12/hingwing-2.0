import type { BotId, CommandOutcome, Routine, RoutineAction, RoutineId } from '@highwing/hermes/domain'
import { useEffect, useState } from 'react'
import { DeleteDialog } from './DeleteDialog'
import { afterControl, routinesViewOf, type RoutineRow, type RoutinesView } from './routines-view'

export interface RoutinesProps {
  readonly bot: BotId
  /** The bot's name as shown. */
  readonly name: string
  /** The `routines` topic. The list is first asked for once it arrives, and again whenever it changes. */
  readonly revision: number | undefined
  readonly onList: (bot: BotId) => Promise<CommandOutcome<readonly Routine[]>>
  readonly onControl: (bot: BotId, routine: RoutineId, action: RoutineAction) => Promise<CommandOutcome<Routine | null>>
}

type Listed = { readonly bot: BotId; readonly outcome: CommandOutcome<readonly Routine[]>; readonly said: string | null }

/** A bot's Routines tab: the jobs Hermes runs for it on a schedule, each with Pause or Resume and Delete. */
export function Routines({ bot, name, revision, onList, onControl }: RoutinesProps) {
  const [listed, setListed] = useState<Listed | null>(null)
  const [busy, setBusy] = useState<RoutineId | null>(null)
  const [deleting, setDeleting] = useState<RoutineRow | null>(null)
  useEffect(() => {
    if (revision === undefined) return
    let current = true
    void onList(bot).then(outcome => { if (current) setListed(held => ({ bot, outcome, said: held?.bot === bot ? held.said : null })) })
    return () => { current = false }
  }, [bot, revision, onList])

  const control = async (id: RoutineId, action: RoutineAction) => {
    setDeleting(null)
    setBusy(id)
    const answered = await onControl(bot, id, action)
    setBusy(null)
    setListed(held => {
      if (held?.bot !== bot) return held
      const after = afterControl(held.outcome, id, answered)
      return { bot, outcome: after.listed, said: after.said }
    })
  }

  const shown = listed?.bot === bot ? listed : null
  return (
    <>
      {shown?.said == null ? null : <p className="routines-note bots-refused" role="alert">{shown.said}</p>}
      <RoutinesList
        view={routinesViewOf(shown?.outcome ?? null, name)} busy={busy}
        onToggle={row => void control(row.id, row.paused ? 'resume' : 'pause')} onDelete={setDeleting}
      />
      {deleting === null ? null : (
        <DeleteDialog
          name={deleting.name} words="Hermes stops running it and forgets it. It can't bring it back."
          onCancel={() => setDeleting(null)} onConfirm={() => void control(deleting.id, 'delete')}
        />
      )}
    </>
  )
}

export interface RoutinesListProps {
  readonly view: RoutinesView
  /** The routine whose control is on its way to Hermes. */
  readonly busy: RoutineId | null
  readonly onToggle: (row: RoutineRow) => void
  readonly onDelete: (row: RoutineRow) => void
}

export function RoutinesList({ view, busy, onToggle, onDelete }: RoutinesListProps) {
  if (view.state === 'loading') return <p className="routines-note" aria-busy="true">Loading routines…</p>
  if (view.state === 'refused') return <p className="routines-note routines-refused" role="alert">{view.message}</p>
  if (view.state === 'empty') return <p className="routines-note">{view.hint}</p>
  return (
    <ul className="routines" aria-label="Routines">
      {view.rows.map(row => (
        <li key={row.id} className="routine" aria-busy={busy === row.id}>
          <span className="routine-name">{row.name}</span>
          <span className="routine-when">{row.when}</span>
          <span className="routine-controls">
            <button type="button" disabled={busy !== null} aria-label={`${row.paused ? 'Resume' : 'Pause'} ${row.name}`} onClick={() => onToggle(row)}>
              {row.paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" disabled={busy !== null} aria-label={`Delete ${row.name}…`} onClick={() => onDelete(row)}>Delete…</button>
          </span>
        </li>
      ))}
    </ul>
  )
}
