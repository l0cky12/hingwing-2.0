import { versionLabel, type AdmissionId, type ChatVersions, type Landing, type PromptId, type PromptReply, type QueuedAction, type Relay, type Told, type TurnId, type Version, type Versions } from '@highwing/hermes/domain'
import { fieldId, findInThread, multiReply, type FindMatch, type PendingRow, type PromptButton, type PromptCard, type ThreadEnd, type ThreadNode, type ThreadView, type TurnView } from '@highwing/thread'
import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Avatar } from '../bots/Avatar'
import { SentAttachments } from './Attachments'
import { AskCard, type RequestAnswer } from './Asks'
import { Command, CopyButton } from './Copy'
import { isCommandKey } from '../keys'
import { Helper, Moa, Notice, Plan, Reasoning } from './Helpers'
import { FIND_OPEN, FindBar, reveal, useFindMarks, type FindState } from './Find'
import { isOpen, NONE_OPEN, toggled, type OpenState } from './open'
import { Given, Reactions } from './Reactions'
import { placeRelays } from './relays'
import { cx, Elapsed, Stat, Step } from './Step'
import { Markdown, PhraseText } from './text'

type Answer = (promptId: PromptId, reply: PromptReply) => Promise<Told | undefined>

interface NodeProps {
  readonly node: ThreadNode
  readonly endTone: 'live' | 'asking' | null
  readonly elapsed: string | null
  readonly open: OpenState
  readonly onToggle: (key: string, byDefault?: boolean) => void
  readonly onAnswer: Answer
}

const ROLE_CLASS = { primary: 'primary', plain: null, decline: 'deny' } as const

interface PromptProps {
  readonly nodeKey: string
  readonly card: PromptCard
  readonly asking: boolean
  readonly onAnswer: Answer
}

const TOLD_WORDS = {
  turn: null,
  next: "The turn couldn't take this, so it goes as your next message.",
  unsure: "Hermes didn't confirm it read this, so Highwing didn't send it again."
} as const satisfies Record<Told, string | null>

function Prompt({ nodeKey, card, asking, onAnswer }: PromptProps) {
  const [told, setTold] = useState<Told | undefined>(undefined)
  const toldWords = told === undefined ? null : TOLD_WORDS[told]
  if (card.state === 'answered') {
    return (
      <div className="approval answered">
        <p data-find={fieldId(nodeKey, 'words')}>{card.words}</p>
        {card.command !== null && <Command nodeKey={nodeKey} command={card.command} />}
        {toldWords !== null && <p className="notice">{toldWords}</p>}
      </div>
    )
  }
  const answer = (reply: PromptReply) => void onAnswer(card.promptId, reply)
  const deny = (tell: string) => void onAnswer(card.promptId, { kind: 'deny', tell }).then(setTold)
  return (
    <div className={cx('approval', asking && 'live')} role="group" aria-label={card.heading} {...(asking ? { 'data-end': 'asking' } : {})}>
      <h3 data-find={fieldId(nodeKey, 'heading')}>{card.heading}</h3>
      {card.command !== null && <Command nodeKey={nodeKey} command={card.command} />}
      {card.why !== null && <p className="why" data-find={fieldId(nodeKey, 'why')}>{card.why}</p>}
      {card.pick.kind === 'one'
        ? <Buttons buttons={card.pick.buttons} freeText={card.pick.freeText} tell={card.tell} command={card.command} busy={card.busy} onAnswer={answer} onTell={deny} />
        : <Checks choices={card.pick.choices} busy={card.busy} onAnswer={answer} />}
      {card.error !== null && <p className="err" data-find={fieldId(nodeKey, 'error')}>{card.error}</p>}
    </div>
  )
}

interface PickProps {
  readonly busy: boolean
  readonly onAnswer: (reply: PromptReply) => void
}

interface ButtonsProps extends PickProps {
  readonly buttons: readonly PromptButton[]
  readonly freeText: boolean
  /** Offers a denial that carries words for Hermes about what to do instead. */
  readonly tell: boolean
  readonly command: string | null
  readonly onTell: (words: string) => void
}

function Buttons({ buttons, freeText, tell, command, busy, onAnswer, onTell }: ButtonsProps) {
  const [text, setText] = useState('')
  const [telling, setTelling] = useState(false)
  const [confirming, setConfirming] = useState<PromptButton | null>(null)
  if (busy && confirming !== null) setConfirming(null)
  const words = text.trim()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (words === '') return
    if (telling) onTell(words)
    else onAnswer({ kind: 'text', value: words })
  }
  const stopTelling = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    setTelling(false)
    setText('')
  }
  return (
    <>
      <div className="choices">
        {buttons.map(button => (
          <button key={button.label} className={ROLE_CLASS[button.role] ?? undefined} disabled={busy} onClick={() => (button.confirm === null ? onAnswer(button.reply) : setConfirming(button))}>
            {button.label}
          </button>
        ))}
      </div>
      {tell && !telling && <button type="button" className="tell" disabled={busy} onClick={() => setTelling(true)}>Tell Hermes what to do instead</button>}
      {(freeText || telling) && (
        <form className="answer" onSubmit={submit}>
          <input
            aria-label={telling ? 'What Hermes should do instead' : 'Type an answer'} value={text} disabled={busy} autoFocus={telling}
            onChange={event => setText(event.target.value)} onKeyDown={telling ? stopTelling : undefined}
          />
          <button disabled={busy || (telling && words === '')}>{telling ? "Don't run and send" : 'Answer'}</button>
        </form>
      )}
      {confirming !== null && confirming.confirm !== null && (
        <Confirm
          words={confirming.confirm} label={confirming.label} command={command}
          onCancel={() => setConfirming(null)}
          onConfirm={() => { setConfirming(null); onAnswer(confirming.reply) }}
        />
      )}
    </>
  )
}

interface ConfirmProps {
  readonly words: NonNullable<PromptButton['confirm']>
  readonly label: string
  readonly command: string | null
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

function Confirm({ words, label, command, onCancel, onConfirm }: ConfirmProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const title = useId()
  const body = useId()
  useLayoutEffect(() => {
    const box = dialog.current
    if (box === null) return
    box.showModal()
    cancel.current?.focus()
    // Closed before React removes it, so the browser hands focus back to the button that opened it.
    return () => box.close()
  }, [])
  return (
    <dialog
      ref={dialog} className="confirm-dialog" aria-labelledby={title} aria-describedby={body}
      onCancel={event => { event.preventDefault(); onCancel() }}
      onKeyDown={event => {
        // The thread's find bar closes on an Escape nobody claimed, and its handler would stop the dialog's own cancel.
        if (event.key === 'Escape') event.stopPropagation()
      }}
    >
      <h2 id={title}>{words.title}</h2>
      <p id={body}>{words.body}</p>
      {command !== null && <pre>{command}</pre>}
      <div className="actions">
        <button ref={cancel} type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={onConfirm}>{label}</button>
      </div>
    </dialog>
  )
}

function Checks({ choices, busy, onAnswer }: PickProps & { readonly choices: readonly string[] }) {
  const [picked, setPicked] = useState<readonly string[]>([])
  const [other, setOther] = useState<string | null>(null)
  const reply = multiReply({ picked, other: other ?? '' })
  const toggle = (choice: string) => setPicked(held => (held.includes(choice) ? held.filter(each => each !== choice) : [...held, choice]))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (reply !== null) onAnswer(reply)
  }
  return (
    <form onSubmit={submit}>
      <fieldset className="picks" disabled={busy}>
        <legend>Pick all that apply</legend>
        {choices.map(choice => (
          <label key={choice}><input type="checkbox" checked={picked.includes(choice)} onChange={() => toggle(choice)} />{choice}</label>
        ))}
        <label><input type="checkbox" checked={other !== null} onChange={() => setOther(held => (held === null ? '' : null))} />Other</label>
        {other !== null && (
          <div className="answer">
            <input aria-label="Other answer" value={other} autoFocus onChange={event => setOther(event.target.value)} />
          </div>
        )}
        <div className="choices">
          <button className="primary" disabled={reply === null}>Answer</button>
          <button type="button" className="deny" onClick={() => onAnswer({ kind: 'text', value: '' })}>Skip</button>
        </div>
      </fieldset>
    </form>
  )
}

export function Node({ node, endTone, elapsed, open: state, onToggle, onAnswer }: NodeProps) {
  const { opened } = state
  const live = endTone === 'live'
  switch (node.kind) {
    case 'prose':
      return (
        <div className="prose">
          <Markdown source={node.markdown} caret={node.streaming} nodeKey={node.key} />
          {!node.streaming && <CopyButton text={node.markdown} name="Copy reply" />}
        </div>
      )
    case 'step':
      return <Step step={node.step} live={live} elapsed={elapsed} open={opened.has(node.key)} onToggle={onToggle} />
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
    case 'reasoning':
      return <Reasoning nodeKey={node.key} text={node.text} streaming={node.streaming} duration={node.duration} open={isOpen(state, node.key, false)} live={live} elapsed={elapsed} onToggle={onToggle} />
    case 'helper':
      return <Helper nodeKey={node.key} helper={node.helper} open={isOpen(state, node.key, false)} live={live} elapsed={elapsed} onToggle={onToggle} />
    case 'plan':
      return <Plan nodeKey={node.key} plan={node.plan} open={isOpen(state, node.key, node.plan.openByDefault)} live={live} elapsed={elapsed} onToggle={onToggle} />
    case 'notice':
      return <Notice node={node} open={isOpen(state, node.key, false)} onToggle={onToggle} />
    case 'closed':
      return <div className="approval answered"><p data-find={fieldId(node.key, 'words')}>{node.words}</p></div>
    case 'moa':
      return <Moa node={node} open={isOpen(state, node.key, false)} onToggle={onToggle} />
    case 'status':
      return <p className="notice said" data-find={fieldId(node.key, 'text')}>{node.text}</p>
    case 'steer':
      return <p className="steer" data-find={fieldId(node.key, 'text')}>{node.text}</p>
  }
}

const END_CLASS = {
  tip: 'working', paused: 'paused', done: 'complete', failed: 'error', stopped: 'interrupted', lost: 'lost'
} as const satisfies Record<Exclude<ThreadEnd['kind'], 'at' | 'none'>, string>

function End({ turnKey, end }: { readonly turnKey: string; readonly end: ThreadEnd }) {
  if (end.kind === 'at' || end.kind === 'none') return null
  const words = end.kind === 'tip' ? <><span><PhraseText words={end.words} /></span><Elapsed elapsed={end.elapsed} /></> : end.kind === 'done' ? <span className="sr">{end.words}</span> : <span data-find={fieldId(turnKey, 'end')}>{end.words}</span>
  return <div className={`tip ${END_CLASS[end.kind]}`} role="status" data-end={end.kind}><span className="glyph" />{words}</div>
}

/** Acts on a sent message by its stored row and text: `onEdit` puts it in the composer, `onRegenerate` asks again for its reply. */
export type Rewrite = (rowId: number, text: string) => void

export type ReactOn = (turn: TurnId, emoji: string | null) => void

function Fork() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="3" cy="2.5" r="1.3" />
      <circle cx="9" cy="2.5" r="1.3" />
      <circle cx="6" cy="9.5" r="1.3" />
      <path d="M3 3.8v.7a1.5 1.5 0 0 0 1.5 1.5h3A1.5 1.5 0 0 0 9 4.5v-.7M6 6v2.2" />
    </svg>
  )
}

function Pencil() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12">
      <path d="M2 10 2.6 7.6 8.2 2a1 1 0 0 1 1.4 0l.4.4a1 1 0 0 1 0 1.4L4.4 9.4Z M7.4 2.8l1.8 1.8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

export function VersionSwitch({ versions, onVersion }: { readonly versions: Versions; readonly onVersion: (version: Version) => void }) {
  const { versions: all, current } = versions
  const step = (by: 1 | -1) => {
    const target = all[current + by]
    return <button type="button" aria-label={by === 1 ? 'Next version' : 'Previous version'} disabled={target === undefined} onClick={() => target !== undefined && onVersion(target)}><span aria-hidden="true">{by === 1 ? '›' : '‹'}</span></button>
  }
  return <span className="versions" role="group" aria-label="Versions">{step(-1)}<span>{versionLabel(versions)}</span>{step(1)}</span>
}

interface TurnProps {
  readonly turn: TurnView
  readonly open: OpenState
  readonly onToggle: (key: string, byDefault?: boolean) => void
  readonly onAnswer: Answer
  readonly canEdit: boolean
  readonly showsRegenerate: boolean
  readonly canRegenerate: boolean
  readonly canBranch: boolean
  readonly onEdit: Rewrite
  readonly onRegenerate: Rewrite
  readonly onBranch: (rowId: number) => void
  readonly versions: readonly Versions[]
  readonly onVersion: (version: Version) => void
  readonly canReact: boolean
  readonly onReact: ReactOn
}

export const Turn = memo(function Turn({ turn, open, onToggle, onAnswer, canEdit, showsRegenerate, canRegenerate, canBranch, onEdit, onRegenerate, onBranch, versions, onVersion, canReact, onReact }: TurnProps) {
  const { end, rowId, request, reactions } = turn
  const regenerates = showsRegenerate && rowId !== null && request !== null
  const live = end.kind === 'tip' || (end.kind === 'at' && end.tone === 'live')
  return (
    <article className={cx('turn', live && 'live-turn', end.kind === 'none' && 'interlude')} data-row={rowId ?? undefined}>
      {turn.time !== null && <p className="when">{turn.time}</p>}
      <SentAttachments attachments={turn.attachments} />
      {request !== null && (
        <p className="request" data-find={fieldId(turn.key, 'request')}>
          {request}
          <span className="actions">
            {versions.map(group => <VersionSwitch key={group.versions[0]?.sessionId} versions={group} onVersion={onVersion} />)}
            <CopyButton text={request} name="Copy request" />
            {rowId !== null && <button type="button" className="copy edit" aria-label="Edit message" disabled={!canEdit} onClick={() => onEdit(rowId, request)}><Pencil /></button>}
            {rowId !== null && <button type="button" className="copy branch" aria-label="Branch from here" disabled={!canBranch} onClick={() => onBranch(rowId)}><Fork /></button>}
          </span>
        </p>
      )}
      <div className="thread">
        {turn.nodes.map(node => (
          <Node key={node.key} node={node} endTone={end.kind === 'at' && end.nodeKey === node.key ? end.tone : null} elapsed={end.kind === 'at' && end.tone === 'live' && end.nodeKey === node.key ? end.elapsed : null} open={open} onToggle={onToggle} onAnswer={onAnswer} />
        ))}
        <End turnKey={turn.key} end={end} />
      </div>
      {turn.tokens !== null && <p className="used">{turn.tokens}</p>}
      {(regenerates || reactions !== null) && (
        <div className="turn-actions">
          {reactions !== null && <Given given={reactions.given} disabled={!canReact} onReact={emoji => onReact(reactions.turn, emoji)} />}
          {regenerates && <button type="button" className="regenerate" disabled={!canRegenerate} onClick={() => onRegenerate(rowId, request)}>Regenerate</button>}
          {reactions !== null && <Reactions given={reactions.given} disabled={!canReact} onReact={emoji => onReact(reactions.turn, emoji)} />}
        </div>
      )}
    </article>
  )
})

export const RelayTurn = memo(function RelayTurn({ relay }: { readonly relay: Relay }) {
  const { name, state } = relay
  return (
    <article className="turn relay">
      <p className="request">
        {relay.text}
        <span className="actions"><CopyButton text={relay.text} name="Copy request" /></span>
      </p>
      <div className="relay-reply" role="group" aria-label={name}>
        <p className="relay-from"><Avatar bot={relay} size={22} /><span>{name}</span></p>
        {state.s === 'waiting' && <p className="notice" role="status">Waiting for {name}</p>}
        {state.s === 'answered' && <div className="prose"><Markdown source={state.reply} caret={false} nodeKey={relay.id} /><CopyButton text={state.reply} name="Copy reply" /></div>}
        {state.s === 'failed' && <p className="err">{state.words}</p>}
      </div>
    </article>
  )
})

const LISTED_WORDS = {
  queued: 'Queued',
  steering: 'On its way into this turn',
  lost: "Hermes restarted during this message and can't finish it. Messages behind it wait until you discard it."
} as const satisfies Record<QueuedRow['status'], string>

const ACTION_WORDS = {
  sendNow: { label: 'Send now', pressed: 'Sending…' },
  edit: { label: 'Edit', pressed: 'Saving…' },
  cancel: { label: 'Cancel', pressed: 'Cancelling…' },
  release: { label: 'Discard', pressed: 'Discarding…' }
} as const satisfies Record<QueuedAction, { label: string; pressed: string }>

export type QueuedRow = Extract<PendingRow, { readonly admissionId: AdmissionId }>

export interface QueueControls {
  readonly canAct: boolean
  readonly pressed: ReadonlyMap<AdmissionId, QueuedAction>
  readonly onAct: (row: QueuedRow, action: QueuedAction) => void
}

function Listed({ row, queue }: { readonly row: QueuedRow; readonly queue: QueueControls }) {
  const sent = queue.pressed.get(row.admissionId)
  return (
    <div className="queued">
      <p className="notice">{LISTED_WORDS[row.status]}</p>
      {row.status === 'queued' && row.from === 'elsewhere' && <p className="notice">From another app</p>}
      {row.actions.map(action => (
        <button key={action} type="button" disabled={!queue.canAct || sent !== undefined} onClick={() => queue.onAct(row, action)}>
          {sent === action ? ACTION_WORDS[action].pressed : ACTION_WORDS[action].label}
        </button>
      ))}
    </div>
  )
}

export function Pending({ row, queue }: { readonly row: PendingRow; readonly queue: QueueControls }) {
  return (
    <article className="turn pending">
      <SentAttachments attachments={row.attachments} />
      <p className="request" data-find={fieldId(row.key, 'text')}>{row.text}</p>
      {row.status === 'failed'
        ? <p className="err" data-find={fieldId(row.key, 'detail')}>{row.detail}</p>
        : row.status === 'sending' ? <p className="notice">Sending</p> : <Listed row={row} queue={queue} />}
    </article>
  )
}

interface ThreadProps {
  readonly view: ThreadView
  /** The messages handed to other bots from this chat, oldest first. */
  readonly relays: readonly Relay[]
  readonly onAnswer: Answer
  readonly onAnswerRequest: RequestAnswer
  readonly onLoadEarlier: () => void
  readonly onFindClosed: () => void
  readonly onFindScrolled: () => void
  readonly canEdit: boolean
  readonly regenerateTurnKey: string | null
  readonly canRegenerate: boolean
  readonly canBranch: boolean
  readonly onEdit: Rewrite
  readonly onRegenerate: Rewrite
  readonly onBranch: (rowId: number) => void
  readonly versions: ChatVersions
  readonly onVersion: (version: Version) => void
  readonly queue: QueueControls
  readonly canReact: boolean
  readonly onReact: ReactOn
}

const landingOf = ({ versions, current }: Versions) => versions[current]?.landing
const NO_GROUPS: readonly Versions[] = []

export function Thread({ view, relays, onAnswer, onAnswerRequest, onLoadEarlier, onFindClosed, onFindScrolled, canEdit, regenerateTurnKey, canRegenerate, canBranch, onEdit, onRegenerate, onBranch, versions, onVersion, queue, canReact, onReact }: ThreadProps) {
  const [open, setOpen] = useState<OpenState>(NONE_OPEN)
  const [find, setFind] = useState<FindState | null>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const navigated = useRef(false)

  const onToggle = useCallback((key: string, byDefault = false) => {
    setOpen(held => toggled(held, key, byDefault))
    setFind(held => (held?.openedByFind.has(key) ? { ...held, openedByFind: new Set([...held.openedByFind].filter(row => row !== key)) } : held))
  }, [])

  const groupsAt = useMemo(() => {
    const held = new Map<Landing | undefined, Versions[]>()
    for (const group of versions) held.set(landingOf(group), [...(held.get(landingOf(group)) ?? []), group])
    return (landing: Landing | null): readonly Versions[] => (landing === null ? undefined : held.get(landing)) ?? NO_GROUPS
  }, [versions])
  const atEnd = groupsAt('end')

  const relayed = useMemo(() => placeRelays(relays, view.turns.map(turn => turn.key)), [relays, view.turns])
  const relayTurns = (held: readonly Relay[] = []) => held.map(relay => <RelayTurn key={relay.id} relay={relay} />)

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
    const fresh = match.opens.filter(key => !asked.has(key) && !open.opened.has(key))
    if (fresh.length > 0) setOpen(held => ({ ...held, opened: new Set([...held.opened, ...fresh]) }))
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
    setOpen(held => ({ ...held, opened: new Set([...held.opened].filter(key => !find.openedByFind.has(key))) }))
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
        {relayTurns(relayed.first)}
        {view.turns.map(turn => (
          <Fragment key={turn.key}>
            <Turn
              turn={turn} open={open} onToggle={onToggle} onAnswer={onAnswer}
              canEdit={canEdit} showsRegenerate={turn.key === regenerateTurnKey} canRegenerate={canRegenerate} canBranch={canBranch}
              onEdit={onEdit} onRegenerate={onRegenerate} onBranch={onBranch} versions={groupsAt(turn.rowId)} onVersion={onVersion}
              canReact={canReact} onReact={onReact}
            />
            {relayTurns(relayed.after.get(turn.key))}
          </Fragment>
        ))}
        {relayTurns(relayed.last)}
        {atEnd.length > 0 && <p className="versions-end">{atEnd.map(group => <VersionSwitch key={group.versions[0]?.sessionId} versions={group} onVersion={onVersion} />)}</p>}
        {view.asks.map(card => <AskCard key={card.key} card={card} onAnswer={onAnswerRequest} />)}
        {view.pending.map(row => <Pending key={row.key} row={row} queue={queue} />)}
      </div>
    </>
  )
}
