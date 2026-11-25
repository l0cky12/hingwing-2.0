import type { BackgroundProcess, CommandOutcome, ControlAction, ProcessId, SessionControl } from '@highwing/hermes/domain'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { countsDown, goalParts, heartbeatParts, loopParts, pressesOf, processesWords, processState, ranWords, VERDICT_WORDS, type Card, type Press } from './stack'

interface StatusStackProps {
  readonly processes: readonly BackgroundProcess[]
  readonly control: SessionControl | null
  readonly disabled: boolean
  readonly onKill: (processId: ProcessId) => Promise<CommandOutcome>
  readonly onControl: (action: ControlAction) => Promise<CommandOutcome<string | null>>
}

type Row = Card | 'processes'
type Said = { readonly words: string; readonly refused: boolean } | null

function useNow(ticking: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [ticking])
  return now
}

interface PanelProps {
  readonly title: string
  readonly parts: readonly string[]
  readonly open: boolean
  readonly onToggle: () => void
  readonly children: ReactNode
}

function Panel({ title, parts, open, onToggle, children }: PanelProps) {
  return (
    <div className={open ? 'panel open' : 'panel'}>
      <button type="button" className="head" aria-expanded={open} onClick={onToggle}>
        <span className="title">{title}</span>
        {parts.map(part => <span key={part} className="count"> {part}</span>)}
        <span className="chev" aria-hidden="true" />
      </button>
      {open && <div className="record">{children}</div>}
    </div>
  )
}

export function StatusStack({ processes, control, disabled, onKill, onControl }: StatusStackProps) {
  const [open, setOpen] = useState<ReadonlySet<Row>>(new Set())
  const [sending, setSending] = useState(false)
  const [asking, setAsking] = useState<{ readonly card: Card; readonly press: Press } | null>(null)
  const [said, setSaid] = useState<Said>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const goal = control?.goal ?? null
  const loop = control?.loop ?? null
  const heartbeat = control?.heartbeat ?? null
  const now = useNow(loop !== null && countsDown(loop))
  const off = disabled || sending

  const toggle = (row: Row) => setOpen(held => {
    const next = new Set(held)
    if (!next.delete(row)) next.add(row)
    return next
  })

  const send = async <T,>(call: () => Promise<CommandOutcome<T>>, words: (value: T) => string | null) => {
    setSending(true)
    setSaid(null)
    const outcome = await call().finally(() => setSending(false))
    const shown = outcome.ok ? words(outcome.value) : outcome.refusal.message
    setSaid(shown === null ? null : { words: shown, refused: !outcome.ok })
  }

  const settle = () => {
    setAsking(null)
    trigger.current?.focus()
  }

  const presses = (card: Card, status: Parameters<typeof pressesOf>[1], waiting = false) => (
    <>
      <div className="presses">
        {pressesOf(card, status, waiting).map(press => (
          <button
            key={press.act} type="button" aria-label={`${press.words} ${card}`} disabled={off}
            onClick={event => {
              trigger.current = event.currentTarget
              if (press.ask === null) void send(() => onControl({ act: press.act }), words => words)
              else setAsking({ card, press })
            }}
          >
            {press.words}
          </button>
        ))}
      </div>
      {asking?.card === card && (
        <div className="confirm" role="alert">
          <p>{asking.press.ask}</p>
          <button type="button" className="primary" disabled={off} onClick={() => { settle(); void send(() => onControl({ act: asking.press.act }), words => words) }}>
            {asking.press.words} {card}
          </button>
          <button type="button" autoFocus onClick={settle}>Cancel</button>
        </div>
      )}
    </>
  )

  return (
    <>
      {(processes.length > 0 || goal !== null || loop !== null || heartbeat !== null) && (
        <section className="status-stack" aria-label="Working beside the chat">
          {processes.length > 0 && (
            <Panel title={processesWords(processes)} parts={[]} open={open.has('processes')} onToggle={() => toggle('processes')}>
              {processes.map(process => (
                <section key={process.id} className="process">
                  <p className="process-head">
                    <code>{process.command}</code>
                    <span>{processState(process)}</span>
                    {process.state.s === 'running' && (
                      <button type="button" aria-label="Stop process" disabled={off} onClick={() => void send(() => onKill(process.id), () => null)}>Stop</button>
                    )}
                  </p>
                  {process.tail !== '' && <pre>{process.tail}</pre>}
                </section>
              ))}
            </Panel>
          )}
          {goal !== null && (
            <Panel title="Goal" parts={goalParts(goal)} open={open.has('goal')} onToggle={() => toggle('goal')}>
              <p>{goal.title}</p>
              {goal.verdict !== null && <p className="quiet">Last check: {VERDICT_WORDS[goal.verdict.is]}{goal.verdict.why === null ? '' : `. ${goal.verdict.why}`}</p>}
              {goal.subgoals.length > 0 && (
                <>
                  <h4>Criteria</h4>
                  <ol>{goal.subgoals.map((criterion, index) => <li key={index}>{criterion}</li>)}</ol>
                </>
              )}
              {presses('goal', goal.status, goal.waiting !== null)}
            </Panel>
          )}
          {loop !== null && (
            <Panel title="Loop" parts={loopParts(loop, now)} open={open.has('loop')} onToggle={() => toggle('loop')}>
              <p>{loop.prompt}</p>
              <p className="quiet">{ranWords(loop.ticks.fired, loop.ticks.max)}</p>
              {presses('loop', loop.status)}
            </Panel>
          )}
          {heartbeat !== null && (
            <Panel title="Heartbeat" parts={heartbeatParts(heartbeat)} open={open.has('heartbeat')} onToggle={() => toggle('heartbeat')}>
              <p>{heartbeat.prompt}</p>
              <p className="quiet">{ranWords(heartbeat.fired, 0)}</p>
              {presses('heartbeat', heartbeat.status)}
            </Panel>
          )}
        </section>
      )}
      <p className={said?.refused ? 'stack-said err' : 'stack-said'} role="status">{said?.words}</p>
    </>
  )
}
