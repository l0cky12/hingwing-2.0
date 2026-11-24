import type { PromptId, PromptReply } from '@highwing/hermes/domain'
import { fieldId, findInThread, type FindMatch, type PromptCard, type ThreadEnd, type ThreadNode, type ThreadView, type TurnView } from '@highwing/thread'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CopyButton } from './Copy'
import { isCommandKey } from '../keys'
import { FIND_OPEN, FindBar, reveal, useFindMarks, type FindState } from './Find'
import { cx, Elapsed, Stat, Step } from './Step'
import { Markdown, PhraseText } from './text'

type Answer = (promptId: PromptId, reply: PromptReply) => void

interface NodeProps {
  readonly node: ThreadNode
  readonly endTone: 'live' | 'asking' | null
  readonly elapsed: string | null
  readonly opened: ReadonlySet<string>
  readonly onToggle: (key: string) => void
  readonly onAnswer: Answer
}

const ROLE_CLASS = { primary: 'primary', plain: null, decline: 'deny' } as const

function Command({ nodeKey, command }: { readonly nodeKey: string; readonly command: string }) {
  return <div className="copyable"><pre data-find={fieldId(nodeKey, 'command')}>{command}</pre><CopyButton text={command} name="Copy command" /></div>
}

interface PromptProps {
  readonly nodeKey: string
  readonly card: PromptCard
  readonly asking: boolean
  readonly onAnswer: Answer
}

function Prompt({ nodeKey, card, asking, onAnswer }: PromptProps) {
  const [text, setText] = useState('')
  if (card.state === 'answered') {
    return (
      <div className="approval answered">
        <p data-find={fieldId(nodeKey, 'words')}>{card.words}</p>
        {card.command !== null && <Command nodeKey={nodeKey} command={card.command} />}
      </div>
    )
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (text.trim() !== '') onAnswer(card.promptId, { kind: 'text', value: text.trim() })
  }
  return (
    <div className={cx('approval', asking && 'live')} role="group" aria-label={card.heading} {...(asking ? { 'data-end': 'asking' } : {})}>
      <h3 data-find={fieldId(nodeKey, 'heading')}>{card.heading}</h3>
      {card.command !== null && <Command nodeKey={nodeKey} command={card.command} />}
      {card.why !== null && <p className="why" data-find={fieldId(nodeKey, 'why')}>{card.why}</p>}
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
      {card.error !== null && <p className="err" data-find={fieldId(nodeKey, 'error')}>{card.error}</p>}
    </div>
  )
}

function Node({ node, endTone, elapsed, opened, onToggle, onAnswer }: NodeProps) {
  switch (node.kind) {
    case 'prose':
      return (
        <div className="prose">
          <Markdown source={node.markdown} caret={node.streaming} nodeKey={node.key} />
          {!node.streaming && <CopyButton text={node.markdown} name="Copy reply" />}
        </div>
      )
    case 'step':
      return <Step step={node.step} live={endTone === 'live'} elapsed={elapsed} open={opened.has(node.key)} onToggle={onToggle} />
    case 'group': {
      const open = opened.has(node.key)
      return (
        <div className={cx('group', open && 'open', endTone === 'live' && 'live')} {...(endTone === 'live' ? { 'data-end': 'live' } : {})}>
          <button className="head" aria-expanded={open} onClick={() => onToggle(node.key)}>
            <span className="title" data-find={fieldId(node.key, 'title')}><PhraseText words={node.title} /></span>
            <span className="count">{node.count} steps</span>
            <Elapsed elapsed={elapsed} />
            <span className="chev" aria-hidden="true" />
            <span className="meta"><Stat stat={node.stat} /></span>
          </button>
          <div className="steps">
            {node.steps.map(step => <Step key={step.key} step={step} live={false} elapsed={null} open={opened.has(step.key)} onToggle={onToggle} />)}
          </div>
        </div>
      )
    }
    case 'prompt':
      return <Prompt nodeKey={node.key} card={node.card} asking={endTone === 'asking'} onAnswer={onAnswer} />
    case 'notice':
      return <p className={node.tone === 'error' ? 'err' : 'notice'} data-find={fieldId(node.key, 'text')}>{node.text}</p>
  }
}

const END_CLASS = {
  tip: 'working', paused: 'paused', done: 'complete', failed: 'error', stopped: 'interrupted', lost: 'lost'
} as const satisfies Record<Exclude<ThreadEnd['kind'], 'at'>, string>

function End({ turnKey, end }: { readonly turnKey: string; readonly end: ThreadEnd }) {
  if (end.kind === 'at') return null
  const words = end.kind === 'tip' ? <><span><PhraseText words={end.words} /></span><Elapsed elapsed={end.elapsed} /></> : end.kind === 'done' ? <span className="sr">{end.words}</span> : <span data-find={fieldId(turnKey, 'end')}>{end.words}</span>
  return <div className={`tip ${END_CLASS[end.kind]}`} role="status" data-end={end.kind}><span className="glyph" />{words}</div>
}

/** Acts on a sent message by its stored row and text: `onEdit` puts it in the composer, `onRegenerate` asks again for its reply. */
export type Rewrite = (rowId: number, text: string) => void

function Pencil() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12">
      <path d="M2 10 2.6 7.6 8.2 2a1 1 0 0 1 1.4 0l.4.4a1 1 0 0 1 0 1.4L4.4 9.4Z M7.4 2.8l1.8 1.8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

interface TurnProps {
  readonly turn: TurnView
  readonly opened: ReadonlySet<string>
  readonly onToggle: (key: string) => void
  readonly onAnswer: Answer
  readonly canEdit: boolean
  readonly showsRegenerate: boolean
  readonly canRegenerate: boolean
  readonly onEdit: Rewrite
  readonly onRegenerate: Rewrite
}

const Turn = memo(function Turn({ turn, opened, onToggle, onAnswer, canEdit, showsRegenerate, canRegenerate, onEdit, onRegenerate }: TurnProps) {
  const { end, rowId, request } = turn
  return (
    <article className="turn">
      {turn.time !== null && <p className="when">{turn.time}</p>}
      {request !== null && (
        <p className="request" data-find={fieldId(turn.key, 'request')}>
          {request}
          <span className="actions">
            <CopyButton text={request} name="Copy request" />
            {rowId !== null && <button type="button" className="copy edit" aria-label="Edit message" disabled={!canEdit} onClick={() => onEdit(rowId, request)}><Pencil /></button>}
          </span>
        </p>
      )}
      <div className="thread">
        {turn.nodes.map(node => (
          <Node key={node.key} node={node} endTone={end.kind === 'at' && end.nodeKey === node.key ? end.tone : null} elapsed={end.kind === 'at' && end.tone === 'live' && end.nodeKey === node.key ? end.elapsed : null} opened={opened} onToggle={onToggle} onAnswer={onAnswer} />
        ))}
        <End turnKey={turn.key} end={end} />
      </div>
      {turn.tokens !== null && <p className="used">{turn.tokens}</p>}
      {showsRegenerate && rowId !== null && request !== null && (
        <div className="turn-actions">
          <button type="button" className="regenerate" disabled={!canRegenerate} onClick={() => onRegenerate(rowId, request)}>Regenerate</button>
        </div>
      )}
    </article>
  )
})

const PENDING_WORDS = { sending: 'Sending', queued: 'Queued' } as const

interface ThreadProps {
  readonly view: ThreadView
  readonly onAnswer: Answer
  readonly onLoadEarlier: () => void
  readonly onFindClosed: () => void
  readonly onFindScrolled: () => void
  readonly canEdit: boolean
  readonly regenerateTurnKey: string | null
  readonly canRegenerate: boolean
  readonly onEdit: Rewrite
  readonly onRegenerate: Rewrite
}

export function Thread({ view, onAnswer, onLoadEarlier, onFindClosed, onFindScrolled, canEdit, regenerateTurnKey, canRegenerate, onEdit, onRegenerate }: ThreadProps) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const [find, setFind] = useState<FindState | null>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const navigated = useRef(false)

  const onToggle = useCallback((key: string) => {
    setOpened(held => {
      const next = new Set(held)
      if (!next.delete(key)) next.add(key)
      return next
    })
    setFind(held => (held?.openedByFind.has(key) ? { ...held, openedByFind: new Set([...held.openedByFind].filter(row => row !== key)) } : held))
  }, [])

  const query = find?.query ?? ''
  const matches = useMemo(() => findInThread(view, query), [view, query])
  const at = find?.current ?? null
  const found = at === null ? -1 : matches.findIndex(match => match.field === at.field && match.start === at.start)
  const current = found === -1 ? null : found
  const currentRange = useFindMarks(transcript, matches, current)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isCommandKey(event, 'f') || transcript.current?.checkVisibility() !== true) return
      event.preventDefault()
      if (findInput.current === null) setFind(FIND_OPEN)
      else {
        findInput.current.focus()
        findInput.current.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useLayoutEffect(() => {
    if (!navigated.current) return
    navigated.current = false
    const scroller = transcript.current?.closest('main')
    if (currentRange.current === null || !scroller) return
    reveal(currentRange.current, scroller)
    onFindScrolled()
  }, [find, currentRange, onFindScrolled])

  const show = (held: FindState, match: FindMatch, asked: ReadonlySet<string>, navigate: boolean) => {
    const fresh = match.opens.filter(key => !asked.has(key) && !opened.has(key))
    if (fresh.length > 0) setOpened(rows => new Set([...rows, ...fresh]))
    navigated.current = navigate
    setFind({
      ...held,
      current: { field: match.field, start: match.start, asked: new Set([...asked, ...match.opens]) },
      openedByFind: new Set([...held.openedByFind, ...fresh])
    })
  }

  const step = (direction: 1 | -1) => {
    if (find === null || matches.length === 0) return
    const next = current === null ? (direction === 1 ? 0 : matches.length - 1) : (current + direction + matches.length) % matches.length
    show(find, matches[next]!, new Set(), true)
  }

  useLayoutEffect(() => {
    const match = current === null ? undefined : matches[current]
    if (find?.current == null || match === undefined || match.opens.every(key => find.current!.asked.has(key))) return
    show(find, match, find.current.asked, false)
  })

  const closeFind = () => {
    if (find === null) return
    setOpened(held => new Set([...held].filter(key => !find.openedByFind.has(key))))
    setFind(null)
    onFindClosed()
  }

  const close = useRef(closeFind)
  useLayoutEffect(() => {
    close.current = closeFind
  })
  const finding = find !== null
  useEffect(() => {
    if (!finding) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || transcript.current?.checkVisibility() !== true) return
      event.preventDefault()
      close.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [finding])

  return (
    <>
      {find !== null && (
        <FindBar
          query={find.query} total={matches.length} current={current} earlier={view.earlier} inputRef={findInput}
          onQuery={next => setFind({ ...find, query: next, current: null })}
          onStep={step} onClose={closeFind} onLoadEarlier={onLoadEarlier}
        />
      )}
      <div id="transcript" ref={transcript}>
        {view.earlier === 'more' && <button className="earlier" onClick={onLoadEarlier}>Show earlier turns</button>}
        {view.earlier === 'loading' && <p className="earlier">Loading earlier turns</p>}
        {view.turns.map(turn => (
          <Turn
            key={turn.key} turn={turn} opened={opened} onToggle={onToggle} onAnswer={onAnswer}
            canEdit={canEdit} showsRegenerate={turn.key === regenerateTurnKey} canRegenerate={canRegenerate} onEdit={onEdit} onRegenerate={onRegenerate}
          />
        ))}
        {view.pending.map(message => (
          <article key={message.key} className="turn pending">
            <p className="request" data-find={fieldId(message.key, 'text')}>{message.text}</p>
            {message.status === 'failed'
              ? <p className="err" data-find={fieldId(message.key, 'detail')}>{message.detail}</p>
              : <p className="notice">{PENDING_WORDS[message.status]}</p>}
          </article>
        ))}
      </div>
    </>
  )
}
