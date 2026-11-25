import { fieldId, type HelperView, type PlanEntryView, type PlanView, type ThreadNode } from '@highwing/thread'
import { cx, Elapsed } from './Step'
import { PhraseText } from './text'

export interface NodeState {
  readonly open: boolean
  readonly live: boolean
  readonly elapsed: string | null
  readonly onToggle: (key: string, byDefault?: boolean) => void
}

const idOf = (part: string, key: string) => `${part}-${key.replace(/[^\w-]/g, '-')}`
const liveEnd = (live: boolean) => (live ? { 'data-end': 'live' } : {})
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

interface ReasoningProps extends NodeState {
  readonly nodeKey: string
  readonly text: string
  readonly streaming: boolean
  readonly duration: string | null
}

export function Reasoning({ nodeKey, text, streaming, duration, open, live, elapsed, onToggle }: ReasoningProps) {
  const body = idOf('reasoning', nodeKey)
  const title = streaming ? 'Thinking' : duration === null ? 'Thought' : `Thought for ${duration}`
  return (
    <div className={cx('reasoning', open && 'open', live && 'live', streaming && 'streaming')} {...liveEnd(live)}>
      <button className="head" aria-expanded={open} aria-controls={body} onClick={() => onToggle(nodeKey)}>
        <span className="title">{title}</span><Elapsed elapsed={elapsed} /><span className="chev" aria-hidden="true" />
      </button>
      <p className="text" id={body} hidden={!open} data-find={fieldId(nodeKey, 'text')}>{text}</p>
    </div>
  )
}

type Disclosure = Pick<NodeState, 'open' | 'onToggle'>

export function Moa({ node, open, onToggle }: { readonly node: Extract<ThreadNode, { kind: 'moa' }> } & Disclosure) {
  const body = idOf('moa', node.key)
  return (
    <div className={cx('moa', open && 'open')}>
      <button className="head" aria-expanded={open} aria-controls={body} onClick={() => onToggle(node.key)}>
        <span className="title" data-find={fieldId(node.key, 'title')}>{node.title}</span>
        {node.meta !== null && <span className="count" data-find={fieldId(node.key, 'words')}>{node.meta}</span>}
        <span className="chev" aria-hidden="true" />
      </button>
      <div className="answers" id={body} hidden={!open}>
        {node.references.map(({ label, text }, index) => (
          <div key={index}>
            <h4 data-find={fieldId(node.key, `label ${index}`)}>{label}</h4>
            <p className="text" data-find={fieldId(node.key, `body ${index}`)}>{text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

const TONE_CLASS = { info: 'notice', warn: 'notice caution', error: 'err' } as const

export function Notice({ node, open, onToggle }: { readonly node: Extract<ThreadNode, { kind: 'notice' }> } & Disclosure) {
  const { key, tone, text, detail } = node
  if (detail === null) return <p className={TONE_CLASS[tone]} data-find={fieldId(key, 'text')}>{text}</p>
  const body = idOf('detail', key)
  return (
    <div className={cx(TONE_CLASS[tone], 'detailed', open && 'open')}>
      <p>
        <span data-find={fieldId(key, 'text')}>{text}</span>
        <button type="button" className="details" aria-expanded={open} aria-controls={body} onClick={() => onToggle(key)}>Details<span className="chev" aria-hidden="true" /></button>
      </p>
      <p className="detail" id={body} hidden={!open} data-find={fieldId(key, 'detail')}>{detail}</p>
    </div>
  )
}

const STATE_WORDS = { queued: 'waiting to start', working: 'working', done: 'done', failed: 'failed' } as const

interface HelperProps extends NodeState {
  readonly nodeKey: string
  readonly helper: HelperView
}

export function Helper({ nodeKey, helper, open, live, elapsed, onToggle }: HelperProps) {
  const sub = idOf('sub', nodeKey)
  const now = idOf('now', nodeKey)
  const running = helper.state === 'queued' || helper.state === 'working'
  return (
    <div className={cx('helper', running && 'working', helper.state === 'failed' && 'failed', open && 'open', live && 'live')} {...liveEnd(live)}>
      <button className="head" aria-expanded={open} {...(open ? { 'aria-controls': sub } : helper.now === null ? {} : { 'aria-describedby': now })} onClick={() => onToggle(nodeKey)}>
        <span className="kind">Helper</span>
        <span className="title" data-find={fieldId(nodeKey, 'title')}>{helper.goal}</span>
        {helper.count > 0 && <span className="count">{plural(helper.count, 'step')}</span>}
        <Elapsed elapsed={elapsed} />
        <span className="chev" aria-hidden="true" />
        <span className="meta">
          {helper.ended !== null && <span className="failed">{helper.ended}</span>}
          {helper.duration !== null && <span>{helper.duration}</span>}
        </span>
        {helper.state !== 'failed' && <span className="sr">{STATE_WORDS[helper.state]}</span>}
      </button>
      {helper.now !== null && <span className="now" id={now} aria-live="polite"><PhraseText words={helper.now} /></span>}
      {open && (
        <div className="sub" id={sub}>
          <ol aria-label="Helper steps">
            {helper.steps.map(step => step.kind === 'step'
              ? (
                <li key={step.key} className={step.latest ? 'latest' : undefined}>
                  <span className="title" data-find={fieldId(step.key, 'title')}><PhraseText words={step.title} /></span>
                  {step.latest && <span className="sr">latest step</span>}
                </li>
              )
              : (
                <li key={step.key} className="nested">
                  <span className="kind">Helper</span>
                  <span className="title" data-find={fieldId(step.key, 'title')}>{step.goal}</span>
                  {step.more > 0 && <span className="more">and {plural(step.more, 'helper')} of its own</span>}
                  <span className="sr">{STATE_WORDS[step.state]}</span>
                </li>
              ))}
          </ol>
          {helper.summary !== null && <section className="reply"><h4>Helper's summary</h4><p data-find={fieldId(nodeKey, 'detail')}>{helper.summary}</p></section>}
        </div>
      )}
    </div>
  )
}

const ENTRY_WORDS = { todo: 'to do', doing: 'in progress', done: 'done', cancelled: 'cancelled' } as const

interface Branch { readonly entry: PlanEntryView; readonly children: Branch[] }

function branches(entries: readonly PlanEntryView[]): Branch[] {
  const top: Branch[] = []
  const path: Branch[] = []
  for (const entry of entries) {
    const branch: Branch = { entry, children: [] }
    path.length = Math.min(entry.depth, path.length)
    ;(path.at(-1)?.children ?? top).push(branch)
    path.push(branch)
  }
  return top
}

function Entries({ rows }: { readonly rows: readonly Branch[] }) {
  return rows.map(({ entry, children }) => (
    <li key={entry.key} className={entry.state === 'todo' ? undefined : entry.state}>
      <span className="item">
        <span className="box" aria-hidden="true" />
        <span className="text" data-find={fieldId(entry.key, 'text')}>{entry.text}</span>
        <span className="sr">{ENTRY_WORDS[entry.state]}</span>
      </span>
      {children.length > 0 && <ul><Entries rows={children} /></ul>}
    </li>
  ))
}

interface PlanProps extends NodeState {
  readonly nodeKey: string
  readonly plan: PlanView
}

export function Plan({ nodeKey, plan, open, live, elapsed, onToggle }: PlanProps) {
  const list = idOf('plan', nodeKey)
  const finished = plan.total > 0 && plan.done === plan.total
  return (
    <div className={cx('plan', finished && 'finished', open && 'open', live && 'live')} {...liveEnd(live)}>
      {finished && <span className="tick" aria-hidden="true" />}
      <button className="head" aria-expanded={open} {...(open ? { 'aria-controls': list } : {})} onClick={() => onToggle(nodeKey, plan.openByDefault)}>
        <span className="title">Plan</span>
        <span className="count">{plan.done} of {plan.total} done</span>
        {plan.cancelled > 0 && <span className="count">{plan.cancelled} cancelled</span>}
        <Elapsed elapsed={elapsed} />
        <span className="chev" aria-hidden="true" />
      </button>
      {open && <ul className="items" id={list} aria-label="Plan" aria-live="polite"><Entries rows={branches(plan.entries)} /></ul>}
    </div>
  )
}
