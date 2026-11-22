import type { PromptId, PromptReply } from '@highwing/hermes/domain'
import type { PromptCard, ThreadEnd, ThreadNode, ThreadView, TurnView } from '@highwing/thread'
import { memo, useCallback, useState, type FormEvent } from 'react'
import { cx, Stat, Step } from './Step'
import { Markdown, PhraseText } from './text'

type Answer = (promptId: PromptId, reply: PromptReply) => void

interface NodeProps {
  readonly node: ThreadNode
  /** The end mark's tone when it sits on this node. */
  readonly end: 'live' | 'asking' | null
  readonly opened: ReadonlySet<string>
  readonly onToggle: (key: string) => void
  readonly onAnswer: Answer
}

const ROLE_CLASS = { primary: 'primary', plain: null, decline: 'deny' } as const

function Prompt({ card, asking, onAnswer }: { readonly card: PromptCard; readonly asking: boolean; readonly onAnswer: Answer }) {
  const [text, setText] = useState('')
  if (card.state === 'answered') {
    return <div className="approval answered"><p>{card.words}</p>{card.command !== null && <pre>{card.command}</pre>}</div>
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (text.trim() !== '') onAnswer(card.promptId, { kind: 'text', value: text.trim() })
  }
  return (
    <div className={cx('approval', asking && 'live')} role="group" aria-label={card.heading} {...(asking ? { 'data-end': 'asking' } : {})}>
      <h3>{card.heading}</h3>
      {card.command !== null && <pre>{card.command}</pre>}
      {card.why !== null && <p className="why">{card.why}</p>}
      <div className="choices">
        {card.buttons.map(button => (
          <button key={button.label} className={ROLE_CLASS[button.role] ?? undefined} disabled={card.busy} onClick={() => onAnswer(card.promptId, button.reply)}>
            {button.label}
          </button>
        ))}
      </div>
      {card.freeText && (
        <form className="answer" onSubmit={submit}>
          <input aria-label="Type an answer" value={text} disabled={card.busy} onChange={event => setText(event.target.value)} />
          <button disabled={card.busy}>Answer</button>
        </form>
      )}
      {card.error !== null && <p className="err">{card.error}</p>}
    </div>
  )
}

function Node({ node, end, opened, onToggle, onAnswer }: NodeProps) {
  switch (node.kind) {
    case 'prose':
      return <div className="prose"><Markdown source={node.markdown} caret={node.streaming} /></div>
    case 'step':
      return <Step step={node.step} live={end === 'live'} open={opened.has(node.key)} onToggle={onToggle} />
    case 'group': {
      const open = opened.has(node.key)
      return (
        <div className={cx('group', open && 'open', end === 'live' && 'live')} {...(end === 'live' ? { 'data-end': 'live' } : {})}>
          <button className="head" aria-expanded={open} onClick={() => onToggle(node.key)}>
            <span className="title"><PhraseText words={node.title} /></span>
            <span className="count">{node.count} steps</span>
            <span className="chev" aria-hidden="true" />
            <span className="meta"><Stat stat={node.stat} /></span>
          </button>
          <div className="steps">
            {node.steps.map(step => <Step key={step.key} step={step} live={false} open={opened.has(step.key)} onToggle={onToggle} />)}
          </div>
        </div>
      )
    }
    case 'prompt':
      return <Prompt card={node.card} asking={end === 'asking'} onAnswer={onAnswer} />
    case 'notice':
      return <p className={node.tone === 'error' ? 'err' : 'notice'}>{node.text}</p>
  }
}

const END_CLASS = {
  tip: 'working', paused: 'paused', done: 'complete', failed: 'error', stopped: 'interrupted', lost: 'lost'
} as const satisfies Record<Exclude<ThreadEnd['kind'], 'at'>, string>

function End({ end }: { readonly end: ThreadEnd }) {
  if (end.kind === 'at') return null
  const words = end.kind === 'tip' ? <span><PhraseText words={end.words} /></span> : end.kind === 'done' ? <span className="sr">{end.words}</span> : <span>{end.words}</span>
  return <div className={`tip ${END_CLASS[end.kind]}`} role="status" data-end={end.kind}><span className="glyph" />{words}</div>
}

interface TurnProps {
  readonly turn: TurnView
  readonly opened: ReadonlySet<string>
  readonly onToggle: (key: string) => void
  readonly onAnswer: Answer
}

const Turn = memo(function Turn({ turn, opened, onToggle, onAnswer }: TurnProps) {
  const { end } = turn
  return (
    <article className="turn">
      {turn.request !== null && <p className="request">{turn.request}</p>}
      <div className="thread">
        {turn.nodes.map(node => (
          <Node key={node.key} node={node} end={end.kind === 'at' && end.nodeKey === node.key ? end.tone : null} opened={opened} onToggle={onToggle} onAnswer={onAnswer} />
        ))}
        <End end={end} />
      </div>
    </article>
  )
})

const PENDING_WORDS = { sending: 'Sending', queued: 'Queued' } as const

interface ThreadProps {
  readonly view: ThreadView
  readonly onAnswer: Answer
  readonly onLoadEarlier: () => void
}

/** Draws `threadView(session)` node for node. Which rows are open is this window's own state. */
export function Thread({ view, onAnswer, onLoadEarlier }: ThreadProps) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const onToggle = useCallback((key: string) => setOpened(held => {
    const next = new Set(held)
    if (!next.delete(key)) next.add(key)
    return next
  }), [])
  return (
    <div id="transcript">
      {view.earlier === 'more' && <button className="earlier" onClick={onLoadEarlier}>Show earlier turns</button>}
      {view.earlier === 'loading' && <p className="earlier">Loading earlier turns</p>}
      {view.turns.map(turn => <Turn key={turn.key} turn={turn} opened={opened} onToggle={onToggle} onAnswer={onAnswer} />)}
      {view.pending.map(message => (
        <article key={message.key} className="turn pending">
          <p className="request">{message.text}</p>
          <p className={message.status === 'failed' ? 'err' : 'notice'}>{message.status === 'failed' ? message.detail : PENDING_WORDS[message.status]}</p>
        </article>
      ))}
    </div>
  )
}
