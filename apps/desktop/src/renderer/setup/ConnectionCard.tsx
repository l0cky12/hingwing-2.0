import type { Link } from '@highwing/hermes/domain'
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { press } from '../chrome/Chrome'
import { run } from '../store'
import { cardOf, type Editor as EditorView, type Summary } from './card-view'
import { CHOICES, KINDS as KIND_ORDER, textsOf, type Kind, type Typed } from './form'
import type { CardSetup } from './screens'

const line = (size: number, width: number) =>
  ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }) as const
const Server = ({ size = 15, width = 1.9 }) => <svg {...line(size, width)}><rect x="3" y="3.5" width="18" height="7" rx="2" /><rect x="3" y="13.5" width="18" height="7" rx="2" /><path d="M7 7h.01M7 17h.01" /></svg>
const Laptop = ({ size = 15, width = 1.9 }) => <svg {...line(size, width)}><rect x="4" y="4.5" width="16" height="11" rx="1.5" /><path d="M2 19.5h20" /></svg>
const Globe = ({ size = 15, width = 1.9 }) => <svg {...line(size, width)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
export const People = () => <svg {...line(15, 1.9)}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8" /></svg>
export const Bubble = () => <svg {...line(15, 1.9)}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12z" /></svg>

export interface Segment<V extends string> { readonly value: V; readonly label: string; readonly icon: ReactNode }

export function Segmented<V extends string>({ labelledBy, value, segments, onPick }: {
  readonly labelledBy: string
  readonly value: V
  readonly segments: readonly Segment<V>[]
  readonly onPick: (value: V) => void
}) {
  const name = useId()
  return (
    <div className="seg" role="radiogroup" aria-labelledby={labelledBy}>
      {segments.map(segment => (
        <label key={segment.value}>
          <input type="radio" name={name} checked={segment.value === value} onChange={() => onPick(segment.value)} />
          {segment.icon}{segment.label}
        </label>
      ))}
    </div>
  )
}

const ICONS: { readonly [K in Kind]: (props: { readonly size?: number; readonly width?: number }) => ReactNode } = { remote: Server, url: Globe, local: Laptop }

const KINDS: readonly Segment<Kind>[] = KIND_ORDER.map(value => {
  const Icon = ICONS[value]
  return { value, label: CHOICES[value].label, icon: <Icon /> }
})

/** Fills after it mounts: a region that mounts holding its words is not announced, and a passing check can remount Settings. */
function Announce({ words }: { readonly words: string | null }) {
  const [said, setSaid] = useState<string | null>(null)
  useEffect(() => setSaid(words), [words])
  return <p className="sr" role="status">{said}</p>
}

function SummaryRow({ summary, folded, change, onChange }: {
  readonly summary: Summary
  readonly folded: boolean
  readonly change: RefObject<HTMLButtonElement | null>
  readonly onChange: () => void
}) {
  const { action } = summary
  const Tile = ICONS[summary.kind]
  return (
    <div className="row machine">
      <span className="tile"><Tile size={22} width={1.6} /></span>
      <div className="text" role="status">
        <p className="label">{summary.title}{summary.online && <span className="state online">Online</span>}</p>
        {summary.linkMessage !== null ? <p className="said">{summary.linkMessage}</p> : summary.host !== null && <p className="host">{summary.host}</p>}
      </div>
      <div className="control">
        {action !== null && <button type="button" className="btn" onClick={() => void press(action.run)}>{action.label}</button>}
        {folded && <button ref={change} type="button" className="btn change" onClick={onChange}>Change</button>}
      </div>
    </div>
  )
}

function Editor({ setup, view, onFold }: { readonly setup: CardSetup; readonly view: EditorView; readonly onFold: () => void }) {
  const [kind, setKind] = useState<Kind>(view.seed?.kind ?? 'remote')
  const [texts, setTexts] = useState(() => textsOf(view.seed ?? undefined))
  const [typo, setTypo] = useState<Extract<Typed, { ok: false }> | null>(null)
  const ids = useId()
  const kinds = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const connect = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    (field.current ?? kinds.current?.querySelector<HTMLInputElement>('input:checked'))?.focus()
  }, [])
  // The check disabled the form, which dropped focus.
  useLayoutEffect(() => {
    if (setup.at === 'failed') (CHOICES[setup.target.kind].field !== null ? field : connect).current?.focus()
  }, [setup])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const typed = CHOICES[kind].read(texts[kind])
    setTypo(typed.ok ? null : typed)
    if (typed.ok) void run({ do: 'checkTarget', target: typed.target })
  }
  const problem = typo ?? view.problem
  const { foot, cancel } = view
  const asks = CHOICES[kind].field
  const warning = asks?.warning(texts[kind]) ?? null

  return (
    <form className="edit-form" aria-label="Change the connection" onSubmit={submit}>
      <fieldset className="edit" disabled={view.disabled}>
        <div className="row">
          <div className="text"><p className="label" id={`${ids}-kind`}>Where Hermes runs</p></div>
          <div className="control" ref={kinds}>
            <Segmented labelledBy={`${ids}-kind`} value={kind} segments={KINDS} onPick={picked => { setKind(picked); setTypo(null) }} />
          </div>
        </div>
        {asks !== null && (
          <div className="row field">
            <div className="text"><label className="label" htmlFor={`${ids}-field`}>{asks.label}</label></div>
            <div className="control">
              <input
                ref={field} id={`${ids}-field`} type="text" spellCheck={false} autoCapitalize="off" autoComplete="off"
                placeholder={asks.placeholder} aria-describedby={warning === null ? `${ids}-hint` : `${ids}-hint ${ids}-warning`} value={texts[kind]}
                onChange={event => { setTexts({ ...texts, [kind]: event.target.value }); setTypo(null) }}
              />
              <p className="hint" id={`${ids}-hint`}>{asks.hint}</p>
              {warning !== null && <p className="caution" id={`${ids}-warning`} role="status">{warning}</p>}
            </div>
          </div>
        )}
      </fieldset>
      {problem !== null && (
        <div className="problem" role="alert">
          <h4>{problem.words}</h4>
          {problem.fix !== null && <p>{problem.fix}</p>}
        </div>
      )}
      <div className="edit-foot">
        {foot.show === 'note' && <p className="note">Highwing keeps the current connection until a check passes.</p>}
        {foot.show === 'progress' && (
          <div className="note">
            <p className="progress" role="status" aria-label="Checking"><span className="glyph" />{foot.words}</p>
            {foot.hint !== null && <p className="hint">{foot.hint}</p>}
          </div>
        )}
        {cancel !== null && (
          <button type="button" className="btn" disabled={cancel === 'saving'} onClick={cancel === 'fold' ? onFold : () => void run({ do: cancel === 'stop' ? 'stopCheck' : 'keepTarget' })}>
            {cancel === 'stop-waiting' ? 'Stop waiting' : 'Cancel'}
          </button>
        )}
        <button ref={connect} type="submit" className="btn primary" disabled={view.disabled}>Connect</button>
      </div>
    </form>
  )
}

export function ConnectionCard({ setup, link }: { readonly setup: CardSetup; readonly link: Link | undefined }) {
  const [editing, setEditing] = useState(false)
  const [seen, setSeen] = useState(setup.at)
  if (seen !== setup.at) {
    setSeen(setup.at)
    setEditing(false)
  }
  const view = cardOf(setup, link, editing)
  const change = useRef<HTMLButtonElement>(null)
  const open = view.editor !== null
  const wasOpen = useRef(open || setup.at === 'saved')
  useLayoutEffect(() => {
    if (wasOpen.current && !open) change.current?.focus()
    wasOpen.current = open
  }, [open])

  return (
    <div className="card">
      {view.summary !== null && <SummaryRow summary={view.summary} folded={!open} change={change} onChange={() => setEditing(true)} />}
      {view.editor !== null && <Editor setup={setup} view={view.editor} onFold={() => setEditing(false)} />}
      <Announce words={view.news} />
    </div>
  )
}
