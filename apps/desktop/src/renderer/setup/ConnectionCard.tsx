import type { Link, PickMode, Target } from '@highwing/hermes/domain'
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { NO_SERVERS, type Into, type ServerBook, type WindowCommand } from '../../ipc-contract'
import { press } from '../chrome/Chrome'
import { run } from '../store'
import { cardOf, type Editor as EditorView, type ServerRow, type Summary, type Ways } from './card-view'
import { CHOICES, KINDS as KIND_ORDER, textsOf, type Kind, type Typed } from './form'
import type { CardSetup } from './screens'

export const line = (size: number, width: number) =>
  ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }) as const
export const Server = ({ size = 15, width = 1.9 }) => <svg {...line(size, width)}><rect x="3" y="3.5" width="18" height="7" rx="2" /><rect x="3" y="13.5" width="18" height="7" rx="2" /><path d="M7 7h.01M7 17h.01" /></svg>
const Laptop = ({ size = 15, width = 1.9 }) => <svg {...line(size, width)}><rect x="4" y="4.5" width="16" height="11" rx="1.5" /><path d="M2 19.5h20" /></svg>
const Globe = ({ size = 15, width = 1.9 }) => <svg {...line(size, width)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
const Terminal = ({ size = 15, width = 1.9 }) => <svg {...line(size, width)}><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="m7.5 9.5 3 2.5-3 2.5M13 14.5h3.5" /></svg>
const Bolt = () => <svg {...line(15, 1.9)}><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" /></svg>
const Rows = () => <svg {...line(15, 1.9)}><path d="M9 6.5h11M9 12h11M9 17.5h11M4 6.5h.01M4 12h.01M4 17.5h.01" /></svg>
const Up = () => <svg {...line(15, 2)}><path d="m6 14.5 6-6 6 6" /></svg>
const Down = () => <svg {...line(15, 2)}><path d="m6 9.5 6 6 6-6" /></svg>
export const People = () => <svg {...line(15, 1.9)}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8" /></svg>
export const Bubble = () => <svg {...line(15, 1.9)}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12z" /></svg>

export interface Segment<V extends string> { readonly value: V; readonly label: string; readonly icon: ReactNode }
export type Look = 'seg' | 'looks' | 'tones'

export function Segmented<V extends string>({ labelledBy, describedBy, value, segments, look = 'seg', onPick }: {
  readonly labelledBy: string
  readonly describedBy?: string
  readonly value: V
  readonly segments: readonly Segment<V>[]
  readonly look?: Look
  readonly onPick: (value: V) => void
}) {
  const name = useId()
  return (
    <div className={look} role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy}>
      {segments.map(segment => (
        <label key={segment.value}>
          <input type="radio" name={name} checked={segment.value === value} onChange={() => onPick(segment.value)} />
          {segment.icon}{segment.label}
        </label>
      ))}
    </div>
  )
}

const ICONS: { readonly [K in Kind]: (props: { readonly size?: number; readonly width?: number }) => ReactNode } = { remote: Server, ssh: Terminal, url: Globe, local: Laptop }

const KINDS: readonly Segment<Kind>[] = KIND_ORDER.map(value => {
  const Icon = ICONS[value]
  return { value, label: CHOICES[value].label, icon: <Icon /> }
})

/** Fills after it mounts: a region that mounts holding its words is not announced, and a passing check can remount Settings. */
function Announce({ words, shown }: { readonly words: string | null; readonly shown: boolean }) {
  const [said, setSaid] = useState<string | null>(null)
  useEffect(() => setSaid(words), [words])
  return <p className={said !== null && shown ? 'passed' : 'sr'} role="status">{said}</p>
}

const PICKS: readonly Segment<PickMode>[] = [
  { value: 'fastest', label: 'Fastest', icon: <Bolt /> },
  { value: 'order', label: 'In order', icon: <Rows /> }
]

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

type Edit = Extract<WindowCommand, { readonly do: 'useServer' | 'arrangeWays' | 'removeServer' }>

function ServerRows({ rows, busy, onEdit }: { readonly rows: readonly ServerRow[]; readonly busy: boolean; readonly onEdit: (edit: Edit) => void }) {
  const id = useId()
  return (
    <>
      <p className="caption" id={id}>Servers</p>
      <ul className="card rows servers" aria-labelledby={id}>
        {rows.map(row => (
          <li key={row.id} className="row" aria-current={row.current || undefined}>
            <div className="text">
              <p className="label">{row.name}{row.current && <span className="state online">In use</span>}</p>
              {row.ways !== null && <p className="desc">{row.ways}</p>}
            </div>
            {!row.current && (
              <div className="control">
                <button type="button" className="btn" aria-label={`Use ${row.name}`} disabled={busy} onClick={() => onEdit({ do: 'useServer', server: row.id })}>Use</button>
                <button type="button" className="btn" aria-label={`Remove ${row.name}`} disabled={busy} onClick={() => onEdit({ do: 'removeServer', server: row.id })}>Remove</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}

function WayRows({ ways, busy, onEdit }: { readonly ways: Ways; readonly busy: boolean; readonly onEdit: (edit: Edit) => void }) {
  const ids = useId()
  const arrange = (order: readonly Target[], pick: PickMode = ways.pick) => onEdit({ do: 'arrangeWays', ways: order, pick })
  return (
    <>
      <div className="row">
        <div className="text">
          <p className="label" id={`${ids}-pick`}>Pick</p>
          <p className="desc" id={`${ids}-pick-desc`}>Fastest uses the way that answers soonest. In order uses the first that answers.</p>
        </div>
        <fieldset className="control" disabled={busy}>
          <Segmented labelledBy={`${ids}-pick`} describedBy={`${ids}-pick-desc`} value={ways.pick} segments={PICKS} onPick={pick => arrange(ways.order, pick)} />
        </fieldset>
      </div>
      <ol className="ways" aria-label="Ways in, first in priority at the top">
        {ways.rows.map(row => (
          <li key={row.key} className="row way" aria-current={row.inUse || undefined}>
            <div className="text">
              <p className="label">{row.label}{row.inUse && <span className="state online">In use</span>}</p>
              {row.host !== null && <p className="host">{row.host}</p>}
            </div>
            <div className="control">
              {row.time !== null && <span className="time">{row.time}</span>}
              <button type="button" className="btn icon" aria-label={`Move ${row.name} up`} disabled={busy || row.up === null} onClick={() => row.up !== null && arrange(row.up)}><Up /></button>
              <button type="button" className="btn icon" aria-label={`Move ${row.name} down`} disabled={busy || row.down === null} onClick={() => row.down !== null && arrange(row.down)}><Down /></button>
              <button type="button" className="btn" aria-label={`Remove ${row.name}`} disabled={busy} onClick={() => arrange(row.without)}>Remove</button>
            </div>
          </li>
        ))}
      </ol>
    </>
  )
}

function Editor({ setup, view, onFold }: { readonly setup: CardSetup; readonly view: EditorView; readonly onFold: () => void }) {
  const [kind, setKind] = useState<Kind>(view.seed?.kind ?? view.kind)
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
    if (setup.at === 'failed' && document.activeElement === document.body) (CHOICES[setup.target.kind].field !== null ? field : connect).current?.focus()
  }, [setup])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const typed = CHOICES[kind].read(texts[kind])
    setTypo(typed.ok ? null : typed)
    if (typed.ok) void run({ do: 'checkTarget', target: typed.target, into: view.into })
  }
  const problem = typo ?? view.problem
  const { foot, cancel } = view
  const asks = CHOICES[kind].field
  const warning = asks?.warning(texts[kind]) ?? null
  const onCancel = cancel === 'fold' ? onFold : () => void run({ do: cancel === 'stop' ? 'stopCheck' : 'keepTarget' })
  // Settings closes on an Escape nobody took, so the editor takes it first, as its Cancel.
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || view.disabled || cancel === null) return
    event.preventDefault()
    onCancel()
  }

  return (
    <form className="edit-form" aria-label={view.title} onSubmit={submit} onKeyDown={onKeyDown}>
      <fieldset className="edit" disabled={view.disabled}>
        <div className="row wrapped">
          <div className="text"><p className="label" id={`${ids}-kind`}>{view.asks}</p></div>
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
          <p className="what">{problem.words}</p>
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
          <button type="button" className="btn" disabled={cancel === 'saving'} onClick={onCancel}>
            {cancel === 'stop-waiting' ? 'Stop waiting' : 'Cancel'}
          </button>
        )}
        <button ref={connect} type="submit" className="btn primary" disabled={view.disabled}>Connect</button>
      </div>
    </form>
  )
}

/**
 * The Connection page: the saved servers when there are several, the server in use with its ways in, and the editor that
 * changes it or adds to it. A first run shows the editor alone. `book` comes from the `servers` topic.
 */
export function ConnectionCard({ setup, link, book = NO_SERVERS }: { readonly setup: CardSetup; readonly link: Link | undefined; readonly book?: ServerBook }) {
  const [editing, setEditing] = useState<Into | null>(null)
  const [seen, setSeen] = useState(setup.at)
  const [refused, setRefused] = useState<string | null>(null)
  // A passed check keeps no target, and the news of an added way names the way that was checked.
  const [checked, setChecked] = useState<Target | null>(null)
  if (setup.at === 'checking' && checked !== setup.target) setChecked(setup.target)
  if (seen !== setup.at) {
    setSeen(setup.at)
    setEditing(null)
  }
  const view = cardOf(setup, link, editing, book, checked)
  const change = useRef<HTMLButtonElement>(null)
  const addWay = useRef<HTMLButtonElement>(null)
  const addServer = useRef<HTMLButtonElement>(null)
  const open = view.editor !== null
  const wasOpen = useRef<Into | null>(view.editor?.into ?? (setup.at === 'saved' ? setup.into : null))
  // Focus goes back to the button that opened the editor, or to the first of the others when a passed check took that button away.
  useLayoutEffect(() => {
    const openers = { replace: change, addWay, addServer }
    if (wasOpen.current !== null && !open) (openers[wasOpen.current].current ?? change.current ?? addWay.current)?.focus()
    wasOpen.current = view.editor?.into ?? null
  }, [open, view.editor?.into])

  const edit = (command: Edit) => {
    setRefused(null)
    void run(command).then(outcome => setRefused(outcome.ok ? null : outcome.refusal.message))
  }
  const openEditor = (into: Into) => {
    setRefused(null)
    setEditing(into)
  }

  return (
    <>
      {view.servers.length > 0 && <ServerRows rows={view.servers} busy={view.busy} onEdit={edit} />}
      <div className="card">
        {view.summary !== null && <SummaryRow summary={view.summary} folded={view.change} change={change} onChange={() => openEditor('replace')} />}
        {view.ways !== null && <WayRows ways={view.ways} busy={view.busy} onEdit={edit} />}
        {view.editor !== null && <Editor key={view.editor.into} setup={setup} view={view.editor} onFold={() => setEditing(null)} />}
        <Announce words={view.news} shown={!open} />
      </div>
      {refused !== null && <p className="refused" role="alert">{refused}</p>}
      {view.adds && (
        <div className="adds">
          <button ref={addWay} type="button" onClick={() => openEditor('addWay')}>Add a way in</button>
          <button ref={addServer} type="button" onClick={() => openEditor('addServer')}>Add a server</button>
        </div>
      )}
    </>
  )
}
