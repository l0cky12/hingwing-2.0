import type { BotId, CommandOutcome, Routine } from '@highwing/hermes/domain'
import { useEffect, useState } from 'react'
import { routinesViewOf, type RoutinesView } from './routines-view'

export interface RoutinesProps {
  readonly bot: BotId
  /** The bot's name as shown. */
  readonly name: string
  /** The `routines` topic. The list is first asked for once it arrives, and again whenever it changes. */
  readonly revision: number | undefined
  readonly onList: (bot: BotId) => Promise<CommandOutcome<readonly Routine[]>>
}

/** A bot's Routines tab: the jobs Hermes runs for it on a schedule. */
export function Routines({ bot, name, revision, onList }: RoutinesProps) {
  const [listed, setListed] = useState<{ readonly bot: BotId; readonly outcome: CommandOutcome<readonly Routine[]> } | null>(null)
  useEffect(() => {
    if (revision === undefined) return
    let current = true
    void onList(bot).then(outcome => { if (current) setListed({ bot, outcome }) })
    return () => { current = false }
  }, [bot, revision, onList])
  return <RoutinesList view={routinesViewOf(listed?.bot === bot ? listed.outcome : null, name)} />
}

export function RoutinesList({ view }: { readonly view: RoutinesView }) {
  if (view.state === 'loading') return <p className="routines-note" aria-busy="true">Loading routines…</p>
  if (view.state === 'refused') return <p className="routines-note routines-refused" role="alert">{view.message}</p>
  if (view.state === 'empty') return <p className="routines-note">{view.hint}</p>
  return (
    <ul className="routines" aria-label="Routines">
      {view.rows.map(row => (
        <li key={row.id} className="routine">
          <span className="routine-name">{row.name}</span>
          <span className="routine-when">{row.when}</span>
        </li>
      ))}
    </ul>
  )
}
