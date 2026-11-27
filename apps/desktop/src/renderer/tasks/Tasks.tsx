import type { TaskBoard, TaskCard } from '@highwing/hermes/domain'
import { useCallback, useEffect, useState } from 'react'
import { Bar } from '../chrome/Chrome'
import { run } from '../store'

type Read = { readonly state: 'reading' } | { readonly state: 'refused'; readonly message: string } | { readonly state: 'read'; readonly board: TaskBoard }
const READING: Read = { state: 'reading' }

export interface Note { readonly id: string; readonly words: string }

export function Board({ board, note, onPick }: { readonly board: TaskBoard; readonly note: Note | null; readonly onPick: (card: TaskCard) => void }) {
  // Hermes sends all eight columns, empty or not.
  const lanes = board.columns.filter(column => column.cards.length > 0)
  if (lanes.length === 0) return <p className="notice">No tasks yet.</p>
  return (
    <div className="board">
      {lanes.map(column => (
        <section key={column.name} className="lane" aria-label={column.name}>
          <h3>{column.name} <span>{column.cards.length}</span></h3>
          {column.cards.map(card => (
            <div key={card.id} className="task">
              <button type="button" onClick={() => onPick(card)}>
                <span className="title">{card.title}</span>
                {card.assignee !== null && <span className="by">{card.assignee}</span>}
                {card.summary !== null && <span className="summary">{card.summary}</span>}
              </button>
              {note?.id === card.id && <p className="notice caution" role="status">{note.words}</p>}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

export function Tasks({ onClose }: { readonly onClose: () => void }) {
  const [read, setRead] = useState<Read>(READING)
  const [note, setNote] = useState<Note | null>(null)

  const refresh = useCallback(() => {
    setRead(READING)
    setNote(null)
    void window.highwing.taskBoard().then(outcome => setRead(outcome.ok ? { state: 'read', board: outcome.value } : { state: 'refused', message: outcome.refusal.message }))
  }, [])
  useEffect(refresh, [refresh])

  const open = async ({ id }: TaskCard) => {
    const found = await window.highwing.taskChat(id)
    if (!found.ok) return setNote({ id, words: found.refusal.message })
    if (found.value === null) return setNote({ id, words: 'This task has no chat yet.' })
    const opened = await run({ do: 'open', ref: { kind: 'chat', sessionId: found.value.sessionId, bot: found.value.bot } })
    if (opened.ok) onClose()
    else setNote({ id, words: opened.refusal.message })
  }

  return (
    <div className="screen">
      <Bar where="Tasks">
        <button type="button" disabled={read.state === 'reading'} onClick={refresh}>Refresh</button>
        <button type="button" onClick={onClose}>Close</button>
      </Bar>
      <main>
        <div className="tasks">
          <h2>Tasks</h2>
          {read.state === 'reading' && <p className="notice" role="status">Reading the task board…</p>}
          {read.state === 'refused' && <p className="notice caution" role="status">{read.message}</p>}
          {read.state === 'read' && <Board board={read.board} note={note} onPick={card => void open(card)} />}
        </div>
      </main>
    </div>
  )
}
