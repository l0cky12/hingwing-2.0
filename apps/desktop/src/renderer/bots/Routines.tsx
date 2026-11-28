import { SCHEDULE_MAX, type BotId, type CommandOutcome, type Edited, type Routine, type RoutineAction, type RoutineEdit, type RoutineId, type RoutineRun, type SessionId } from '@highwing/hermes/domain'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { TIME_ZONE } from '../chat/wake'
import { DeleteDialog } from './DeleteDialog'
import {
  afterControl, afterEdit, afterEditKnown, afterReread, afterSave, canRun, canSave, editControlsOf, isGone, openEditor, rereadAfter, routinesViewOf, RUNNING_WORDS, runsViewOf, SCHEDULE_HINT, typedInto,
  type Editor, type EditControls, type EditsKnown, type RoutineRow, type RoutinesView, type RunRow, type RunsView
} from './routines-view'

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
  /** Opens the chat of a run, read-only, in the bot whose profile holds it. */
  readonly onOpenRun: (bot: BotId, sessionId: SessionId) => void
  /** Whether this Hermes serves the routes that run a routine now and change its schedule. `routine` is any routine of the bot. */
  readonly onOffered: (bot: BotId, routine: RoutineId) => Promise<boolean>
  /** Asks Hermes to run the routine now, which it answers once the job has run, or to change its schedule. Answers the routine as Hermes then holds it. */
  readonly onEdit: (bot: BotId, routine: RoutineId, edit: RoutineEdit) => Promise<CommandOutcome<Edited>>
}

type Listed = { readonly bot: BotId; readonly outcome: CommandOutcome<readonly Routine[]>; readonly said: string | null; readonly note: string | null }
type Known = EditsKnown & { readonly bot: BotId }
type Running = { readonly bot: BotId; readonly ids: readonly RoutineId[] }

/**
 * A bot's Routines tab: the jobs Hermes runs for it on a schedule, each with Pause or Resume and Delete. Where Hermes serves the routes,
 * each also has Run now, which Hermes does inside the request, and Edit schedule…, which changes the schedule and nothing else.
 */
export function Routines({ bot, name, revision, onList, onControl, onRuns, onOpenRun, onOffered, onEdit }: RoutinesProps) {
  const [listed, setListed] = useState<Listed | null>(null)
  const [busy, setBusy] = useState<RoutineId | null>(null)
  const [deleting, setDeleting] = useState<RoutineRow | null>(null)
  const [known, setKnown] = useState<Known | null>(null)
  const [running, setRunning] = useState<Running>({ bot, ids: [] })
  const [again, setAgain] = useState(0)
  useEffect(() => {
    if (revision === undefined) return
    let current = true
    void onList(bot).then(outcome => {
      if (current) setListed(held => ({ bot, outcome, said: held?.bot === bot ? held.said : null, note: held?.bot === bot ? held.note : null }))
    })
    return () => { current = false }
  }, [bot, revision, onList, again])

  const shown = listed?.bot === bot ? listed : null
  const first = shown?.outcome.ok ? shown.outcome.value[0]?.id ?? null : null
  useEffect(() => {
    if (first === null) return
    let current = true
    void onOffered(bot, first).then(offered => {
      if (current) setKnown(held => ({ bot, offered: offered || (held?.bot === bot && held.offered), withdrawn: held?.bot === bot ? held.withdrawn : [] }))
    })
    return () => { current = false }
  }, [bot, first, onOffered])

  const control = async (id: RoutineId, action: RoutineAction) => {
    setDeleting(null)
    setBusy(id)
    const answered = await onControl(bot, id, action)
    setBusy(null)
    setListed(held => {
      if (held?.bot !== bot) return held
      const after = afterControl(held.outcome, id, answered)
      return { bot, outcome: after.listed, said: after.said, note: null }
    })
  }

  const edit = async (id: RoutineId, change: RoutineEdit) => {
    if (change.do === 'run') setRunning(held => ({ bot, ids: [...(held.bot === bot ? held.ids : []), id] }))
    const answered = await onEdit(bot, id, change)
    if (change.do === 'run') setRunning(held => (held.bot === bot ? { bot, ids: held.ids.filter(other => other !== id) } : held))
    setKnown(held => (held?.bot === bot ? afterEditKnown(held, change, answered) : held))
    setListed(held => {
      if (held?.bot !== bot) return held
      const after = afterEdit(held.outcome, id, change, answered, { now: Date.now(), timeZone: TIME_ZONE })
      return { bot, outcome: after.listed, said: after.said, note: after.note }
    })
    if (isGone(answered)) setAgain(count => count + 1)
    return answered
  }

  const history = useMemo((): RunHistory => ({ bot, revision, read: routine => onRuns(bot, routine), onOpen: onOpenRun }), [bot, revision, onRuns, onOpenRun])
  const edits: RowEdits = {
    controls: editControlsOf(known?.bot === bot ? known : null), running: running.bot === bot ? running.ids : [],
    onRun: row => void edit(row.id, { do: 'run' }), onReschedule: (row, schedule) => edit(row.id, { do: 'reschedule', schedule })
  }
  return (
    <>
      {shown?.said == null ? null : <p className="routines-note routines-refused" role="alert">{shown.said}</p>}
      {shown?.note == null ? null : <p className="routines-note" role="status">{shown.note}</p>}
      <RoutinesList
        view={routinesViewOf(shown?.outcome ?? null, name)} busy={busy} history={history} edits={edits}
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
  readonly bot: BotId
  /** The `routines` topic. An open list is asked for again whenever it changes, so a run that ends there shows how it went. */
  readonly revision: number | undefined
  /** Hermes's newest runs of the routine. */
  readonly read: (routine: RoutineId) => Promise<CommandOutcome<readonly RoutineRun[]>>
  /** Opens the chat of a run. */
  readonly onOpen: (bot: BotId, sessionId: SessionId) => void
}

/** What each row's Run now and Edit schedule… need, and which of them Hermes has said it serves. */
export interface RowEdits {
  readonly controls: EditControls
  /** The routines Hermes is running now, each for as long as its job takes. */
  readonly running: readonly RoutineId[]
  readonly onRun: (row: RoutineRow) => void
  /** Sends the schedule as typed. Answers what Hermes said, so the field can show a refusal. */
  readonly onReschedule: (row: RoutineRow, schedule: string) => Promise<CommandOutcome<Edited>>
}

export interface RoutinesListProps {
  readonly view: RoutinesView
  /** The routine whose control is on its way to Hermes. */
  readonly busy: RoutineId | null
  /** What each row's Past runs needs: Hermes's list of the routine's runs, and what opening one does. */
  readonly history: RunHistory
  readonly edits: RowEdits
  readonly onToggle: (row: RoutineRow) => void
  readonly onDelete: (row: RoutineRow) => void
}

export function RoutinesList({ view, busy, history, edits, onToggle, onDelete }: RoutinesListProps) {
  if (view.state === 'loading') return <p className="routines-note" aria-busy="true">Loading routines…</p>
  if (view.state === 'refused') return <p className="routines-note routines-refused" role="alert">{view.message}</p>
  if (view.state === 'empty') return <p className="routines-note">{view.hint}</p>
  return (
    <ul className="routines" aria-label="Routines">
      {view.rows.map(row => <RoutineItem key={row.id} row={row} busy={busy} history={history} edits={edits} onToggle={onToggle} onDelete={onDelete} />)}
    </ul>
  )
}

type ItemProps = Pick<RoutinesListProps, 'busy' | 'history' | 'edits' | 'onToggle' | 'onDelete'> & { readonly row: RoutineRow }

function RoutineItem({ row, busy, history, edits, onToggle, onDelete }: ItemProps) {
  const [open, setOpen] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const runs = useId()
  const edit = useRef<HTMLButtonElement>(null)
  const closed = useRef(true)
  const running = edits.running.includes(row.id)
  useEffect(() => {
    if (editor === null && !closed.current) edit.current?.focus()
    closed.current = editor === null
  }, [editor])
  const save = async (from: Editor) => {
    setEditor({ ...from, saving: true })
    const answered = await edits.onReschedule(row, from.text)
    setEditor(afterSave(from, answered))
  }
  return (
    <li className="routine" aria-busy={busy === row.id || running}>
      <span className="routine-name">{row.name}</span>
      <span className="routine-when">{row.when}</span>
      {running && <span className="routine-state" role="status">{RUNNING_WORDS}</span>}
      <span className="routine-controls">
        <button type="button" aria-expanded={open} aria-controls={runs} aria-label={`Past runs of ${row.name}`} onClick={() => setOpen(!open)}>Past runs</button>
        {canRun(row, edits.controls) && (
          <button type="button" disabled={busy !== null || running} aria-label={`Run ${row.name} now`} onClick={() => edits.onRun(row)}>Run now</button>
        )}
        {edits.controls.reschedule && (
          <button
            ref={edit} type="button" aria-expanded={editor !== null} disabled={busy !== null} aria-label={`Edit schedule of ${row.name}`}
            onClick={() => setEditor(held => held ?? openEditor(row))}
          >
            Edit schedule…
          </button>
        )}
        <button type="button" disabled={busy !== null} aria-label={`${row.paused ? 'Resume' : 'Pause'} ${row.name}`} onClick={() => onToggle(row)}>
          {row.paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" disabled={busy !== null} aria-label={`Delete ${row.name}…`} onClick={() => onDelete(row)}>Delete…</button>
      </span>
      {editor !== null && edits.controls.reschedule && (
        <ScheduleEditor
          name={row.name} editor={editor} saveable={canSave(editor, row)} onType={text => setEditor(typedInto(editor, text))}
          onSave={() => void save(editor)} onCancel={() => setEditor(null)}
        />
      )}
      {open && <PastRuns id={runs} routine={row.id} name={row.name} history={history} />}
    </li>
  )
}

export interface ScheduleEditorProps {
  readonly name: string
  readonly editor: Editor
  /** Whether Save would send something: a schedule that is not blank and not the one the routine has. */
  readonly saveable: boolean
  readonly onType: (text: string) => void
  readonly onSave: () => void
  readonly onCancel: () => void
}

/**
 * The field that changes one routine's schedule, under its row. It is no `form`, because the Details panel around it is one, and Enter
 * here saves this schedule and must not save the bot. Escape cancels it alone, so the panel stays open.
 */
export function ScheduleEditor({ name, editor, saveable, onType, onSave, onCancel }: ScheduleEditorProps) {
  const [field, hint] = [useId(), useId()]
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const keyed = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    } else if (event.key === 'Enter' && event.target === input.current) {
      event.preventDefault()
      if (saveable) onSave()
    }
  }
  return (
    <div className="routine-edit" onKeyDown={keyed}>
      <label htmlFor={field}>Schedule for {name}</label>
      <input
        ref={input} id={field} type="text" value={editor.text} maxLength={SCHEDULE_MAX} readOnly={editor.saving} autoComplete="off" spellCheck={false}
        aria-describedby={hint} onChange={event => onType(event.target.value)}
      />
      <p id={hint} className="routine-hint">{SCHEDULE_HINT}</p>
      {editor.words !== null && <p className="routines-note routines-refused" role="alert">{editor.words}</p>}
      <span className="routine-edit-actions">
        <button type="button" className="primary" disabled={!saveable} onClick={onSave}>Save</button>
        <button type="button" onClick={onCancel}>Cancel</button>
        {editor.saving && <span className="routine-hint" role="status">Saving…</span>}
      </span>
    </div>
  )
}

/** Mounted while a routine's Past runs is open, so each time it opens it asks Hermes afresh. */
function PastRuns({ id, routine, name, history }: { readonly id: string; readonly routine: RoutineId; readonly name: string; readonly history: RunHistory }) {
  const [held, setHeld] = useState<{ readonly listed: CommandOutcome<readonly RoutineRun[]> | null; readonly answers: number }>({ listed: null, answers: 0 })
  const [polled, poll] = useState(0)
  const read = useRef(history.read)
  read.current = history.read
  useEffect(() => {
    let current = true
    void read.current(routine).then(answered => {
      if (current) setHeld(before => ({ listed: afterReread(before.listed, answered), answers: before.answers + 1 }))
    })
    return () => { current = false }
  }, [routine, history.revision, polled])
  const wait = rereadAfter(held.listed)
  useEffect(() => {
    if (wait === null || held.answers === 0) return
    const timer = window.setTimeout(() => poll(count => count + 1), wait)
    return () => window.clearTimeout(timer)
  }, [wait, held.answers])
  return <RunsList id={id} name={name} view={runsViewOf(held.listed, { now: Date.now(), timeZone: TIME_ZONE }, history.bot)} onOpen={history.onOpen} />
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
      {chat !== null && <button type="button" aria-label={`Open run from ${run.when}`} onClick={() => onOpen(chat.bot, chat.sessionId)}>Open run</button>}
      {run.why !== null && <span className="run-why">{run.why}</span>}
    </li>
  )
}
