import type { BotId, CommandOutcome, Routine, RoutineAction, RoutineId, RoutineRun, SessionId } from '@highwing/hermes/domain'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { TIME_ZONE } from '../chat/wake'
import { DeleteDialog } from './DeleteDialog'
import { afterControl, routinesViewOf, runsViewOf, type RoutineRow, type RoutinesView, type RunRow, type RunsView } from './routines-view'

export interface RoutinesProps {
  readonly bot: BotId
  /** The bot's name as shown. */
  readonly name: string
  /** The `routines` topic. The list is first asked for once it arrives, and again whenever it changes. */
  readonly revision: number | undefined
  readonly onList: (bot: BotId) => Promise<CommandOutcome<readonly Routine[]>>
  readonly onControl: (bot: BotId, routine: RoutineId, action: RoutineAction) => Promise<CommandOutcome<Routine | null>>
  /** Asks Hermes for a routine's newest runs. */
  readonly onRuns: (bot: BotId, routine: RoutineId) => Promise<CommandOutcome<readonly RoutineRun[]>>
  /** Opens the chat of a run, read-only. */
  readonly onOpenRun: (bot: BotId, sessionId: SessionId) => void
}

type Listed = { readonly bot: BotId; readonly outcome: CommandOutcome<readonly Routine[]>; readonly said: string | null }

/** A bot's Routines tab: the jobs Hermes runs for it on a schedule, each with Pause or Resume and Delete. */
export function Routines({ bot, name, revision, onList, onControl, onRuns, onOpenRun }: RoutinesProps) {
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

  const history = useMemo((): RunHistory => ({ read: routine => onRuns(bot, routine), onOpen: sessionId => onOpenRun(bot, sessionId) }), [bot, onRuns, onOpenRun])
  const shown = listed?.bot === bot ? listed : null
  return (
    <>
      {shown?.said == null ? null : <p className="routines-note routines-refused" role="alert">{shown.said}</p>}
      <RoutinesList
        view={routinesViewOf(shown?.outcome ?? null, name)} busy={busy} history={history}
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

export interface RunHistory {
  /** Hermes's newest runs of the routine. */
  readonly read: (routine: RoutineId) => Promise<CommandOutcome<readonly RoutineRun[]>>
  /** Opens the chat of a run. */
  readonly onOpen: (sessionId: SessionId) => void
}

export interface RoutinesListProps {
  readonly view: RoutinesView
  /** The routine whose control is on its way to Hermes. */
  readonly busy: RoutineId | null
  /** What each row's Past runs needs: Hermes's list of the routine's runs, and what opening one does. */
  readonly history: RunHistory
  readonly onToggle: (row: RoutineRow) => void
  readonly onDelete: (row: RoutineRow) => void
}

export function RoutinesList({ view, busy, history, onToggle, onDelete }: RoutinesListProps) {
  if (view.state === 'loading') return <p className="routines-note" aria-busy="true">Loading routines…</p>
  if (view.state === 'refused') return <p className="routines-note routines-refused" role="alert">{view.message}</p>
  if (view.state === 'empty') return <p className="routines-note">{view.hint}</p>
  return (
    <ul className="routines" aria-label="Routines">
      {view.rows.map(row => <RoutineItem key={row.id} row={row} busy={busy} history={history} onToggle={onToggle} onDelete={onDelete} />)}
    </ul>
  )
}

type ItemProps = Pick<RoutinesListProps, 'busy' | 'history' | 'onToggle' | 'onDelete'> & { readonly row: RoutineRow }

function RoutineItem({ row, busy, history, onToggle, onDelete }: ItemProps) {
  const [open, setOpen] = useState(false)
  const runs = useId()
  return (
    <li className="routine" aria-busy={busy === row.id}>
      <span className="routine-name">{row.name}</span>
      <span className="routine-when">{row.when}</span>
      <span className="routine-controls">
        <button type="button" aria-expanded={open} aria-controls={runs} aria-label={`Past runs of ${row.name}`} onClick={() => setOpen(!open)}>Past runs</button>
        <button type="button" disabled={busy !== null} aria-label={`${row.paused ? 'Resume' : 'Pause'} ${row.name}`} onClick={() => onToggle(row)}>
          {row.paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" disabled={busy !== null} aria-label={`Delete ${row.name}…`} onClick={() => onDelete(row)}>Delete…</button>
      </span>
      {open && <PastRuns id={runs} routine={row.id} name={row.name} history={history} />}
    </li>
  )
}

/** Mounted while a routine's Past runs is open, so each time it opens it asks Hermes afresh. */
function PastRuns({ id, routine, name, history }: { readonly id: string; readonly routine: RoutineId; readonly name: string; readonly history: RunHistory }) {
  const [listed, setListed] = useState<CommandOutcome<readonly RoutineRun[]> | null>(null)
  const read = useRef(history.read)
  read.current = history.read
  useEffect(() => {
    let current = true
    void read.current(routine).then(outcome => { if (current) setListed(outcome) })
    return () => { current = false }
  }, [routine])
  return <RunsList id={id} name={name} view={runsViewOf(listed, { now: Date.now(), timeZone: TIME_ZONE })} onOpen={history.onOpen} />
}

export function RunsList({ id, name, view, onOpen }: { readonly id: string; readonly name: string; readonly view: RunsView; readonly onOpen: RunHistory['onOpen'] }) {
  return (
    <div id={id} className="routine-runs">
      {view.state === 'loading' && <p className="routines-note" aria-busy="true">Loading runs…</p>}
      {view.state === 'refused' && <p className="routines-note routines-refused" role="alert">{view.message}</p>}
      {view.state === 'empty' && <p className="routines-note">{view.hint}</p>}
      {view.state === 'listed' && (
        <ul aria-label={`Past runs of ${name}`}>
          {view.rows.map(run => <RunItem key={run.key} run={run} onOpen={onOpen} />)}
        </ul>
      )}
    </div>
  )
}

function RunItem({ run, onOpen }: { readonly run: RunRow; readonly onOpen: RunHistory['onOpen'] }) {
  const { chat } = run
  return (
    <li className={`run run-${run.outcome}`}>
      <span className="run-state">{run.state}</span>
      <span className="run-when">{run.took === null ? run.when : `${run.when} · ${run.took}`}</span>
      {chat !== null && <button type="button" aria-label={`Open run from ${run.when}`} onClick={() => onOpen(chat)}>Open run</button>}
      {run.why !== null && <span className="run-why">{run.why}</span>}
    </li>
  )
}
