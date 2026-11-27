import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { Mode, Theme } from '../../ipc-contract'
import { COMMAND_KEY } from '../keys'
import { run, useTopic } from '../store'
import { Bubble, ConnectionCard, line, Monitor, Moon, People, Segmented, Server, Sun, type Segment } from './ConnectionCard'
import type { CardSetup } from './screens'
import { PAGES, settingsViewOf, type Check, type Page, type RowId } from './settings-view'

const Contrast = () => <svg {...line(16, 1.8)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7a5 5 0 0 1 0 10z" fill="currentColor" /></svg>
const Cross = () => <svg {...line(14, 2)}><path d="M6 6l12 12M18 6 6 18" /></svg>
const Keyboard = () => <svg {...line(16, 1.8)}><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><path d="M6.5 9.5h.01M10 9.5h.01M14 9.5h.01M17.5 9.5h.01M6.5 12.5h.01M17.5 12.5h.01M9 15.5h6" /></svg>
const Search = () => <svg {...line(16, 1.8)}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>

const PAGE_ICONS: { readonly [P in Page]: () => ReactNode } = { connection: () => <Server size={16} width={1.8} />, appearance: Contrast, keys: Keyboard }

const SIDEBAR: readonly Segment<Mode>[] = [
  { value: 'bots', label: 'Bots', icon: <People /> },
  { value: 'chats', label: 'Chats', icon: <Bubble /> }
]

const THEMES: readonly Segment<Theme>[] = [
  { value: 'system', label: 'System', icon: <Monitor /> },
  { value: 'light', label: 'Light', icon: <Sun /> },
  { value: 'dark', label: 'Dark', icon: <Moon /> }
]

const SHORTCUTS: readonly { readonly id: RowId; readonly label: string; readonly key: string; readonly where: string }[] = [
  { id: 'palette', label: 'Command palette', key: 'K', where: 'Works anywhere in Highwing.' },
  { id: 'new-chat', label: 'New chat', key: 'N', where: 'Works on the chat screen.' },
  { id: 'find', label: 'Find in chat', key: 'F', where: 'Works in an open chat.' }
]

const CHECK_SAID: { readonly [C in Exclude<Check, 'idle'>]: string } = { checking: 'checking', failed: 'check failed' }

const Count = ({ n }: { readonly n: number }) => (
  <span className="count"><span aria-hidden="true">{n}</span><span className="sr"> ({n} {n === 1 ? 'match' : 'matches'})</span></span>
)

function Choice<V extends string>({ label, desc, value, segments, hidden, onPick }: {
  readonly label: string
  readonly desc: string
  readonly value: V
  readonly segments: readonly Segment<V>[]
  readonly hidden: boolean
  readonly onPick: (value: V) => void
}) {
  const id = useId()
  return (
    <div className="row" hidden={hidden}>
      <div className="text">
        <p className="label" id={id}>{label}</p>
        <p className="desc" id={`${id}-desc`}>{desc}</p>
      </div>
      <div className="control"><Segmented labelledBy={id} describedBy={`${id}-desc`} value={value} segments={segments} onPick={onPick} /></div>
    </div>
  )
}

export function Settings({ setup, mode, theme, onRequestClose }: { readonly setup: CardSetup; readonly mode: Mode; readonly theme: Theme; readonly onRequestClose: () => void }) {
  const saving = setup.at === 'checking' && setup.step === 'save'
  const link = useTopic('link')
  const heading = useRef<HTMLHeadingElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const ids = useId()
  const search = useRef<HTMLInputElement>(null)
  const pane = useRef<HTMLElement>(null)
  const [page, setPage] = useState<Page>('connection')
  const [query, setQuery] = useState('')
  const [seen, setSeen] = useState(setup.at)
  if (seen !== setup.at) {
    setSeen(setup.at)
    if (setup.at === 'saved') {
      setPage('connection')
      setQuery('')
    }
  }
  const check: Check = setup.at === 'checking' || setup.at === 'failed' ? setup.at : 'idle'
  const view = settingsViewOf(page, query, check)

  useLayoutEffect(() => {
    if (setup.at !== 'saved') heading.current?.focus()
  }, [])
  useLayoutEffect(() => {
    pane.current?.scrollTo({ top: 0 })
  }, [page, query])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented || event.isComposing || document.querySelector('dialog:modal') !== null) return
      event.preventDefault()
      onRequestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onRequestClose])

  const open = (picked: Page) => {
    setPage(picked)
    setQuery('')
  }
  const openConnectionAndFocusTitle = () => {
    flushSync(() => open('connection'))
    title.current?.focus()
  }
  const clear = () => {
    setQuery('')
    search.current?.focus()
  }

  const off = (row: RowId) => !view.rows.has(row)
  const cards: { readonly [P in Page]: ReactNode } = {
    connection: <ConnectionCard setup={setup} link={link} />,
    appearance: (
      <div className="card rows">
        <Choice label="Theme" desc="System follows your computer’s light or dark setting." value={theme} segments={THEMES} hidden={off('theme')} onPick={picked => void run({ do: 'setTheme', theme: picked })} />
        <Choice label="Show in the sidebar" desc="Bots shows your bots. Chats shows the chats of the open bot." value={mode} segments={SIDEBAR} hidden={off('sidebar')} onPick={picked => void run({ do: 'setMode', mode: picked })} />
      </div>
    ),
    keys: (
      <div className="card rows">
        {SHORTCUTS.map(({ id, label, key, where }) => (
          <div key={id} className="row" hidden={off(id)}>
            <div className="text"><p className="label">{label}</p><p className="desc">{where}</p></div>
            <div className="control keys"><kbd>{COMMAND_KEY}</kbd><kbd>{key}</kbd></div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="settings">
      <div className="settings-side">
        <div className="settings-head"><h1 ref={heading} tabIndex={-1}>Settings</h1></div>
        <div className="settings-search">
          <Search />
          <input
            ref={search} type="search" aria-label="Search settings" placeholder="Search settings" spellCheck={false} autoComplete="off" value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Escape' || query === '' || event.nativeEvent.isComposing) return
              event.preventDefault()
              setQuery('')
            }}
          />
          {query !== '' && <button type="button" className="clear" aria-label="Clear search" onClick={clear}><Cross /></button>}
        </div>
        <nav className="settings-pages" aria-label="Settings pages">
          {PAGES.map(({ id, label }) => {
            const Icon = PAGE_ICONS[id]
            return (
              <button key={id} type="button" aria-current={view.current === id ? 'page' : undefined} data-hit={view.hits.has(id) || undefined} onClick={() => open(id)}>
                <Icon />{label}
                {id === 'connection' && check !== 'idle' && view.hiddenCheck !== null && <span className="dot" data-check={check}><span className="sr"> ({CHECK_SAID[check]})</span></span>}
                {view.hits.has(id) && <Count n={view.hits.get(id)!} />}
              </button>
            )
          })}
        </nav>
      </div>
      <main ref={pane}>
        <div className="settings-body">
          <header className="settings-title">
            <h2 ref={title} id={`${ids}-title`} tabIndex={-1}>{view.heading}</h2>
            <p>{view.lede}</p>
          </header>
          {view.hiddenCheck !== null && (
            <div className="settings-away" data-check={check}>
              <p aria-hidden="true">{view.hiddenCheck}</p>
              <button type="button" className="btn" aria-describedby={`${ids}-away`} onClick={openConnectionAndFocusTitle}>Show connection</button>
            </div>
          )}
          {PAGES.map(({ id, label }) => (
            <section key={id} className="group" hidden={!view.pages.includes(id)} aria-labelledby={view.titlesPages ? `${ids}-${id}` : `${ids}-title`}>
              {view.titlesPages && <h3 id={`${ids}-${id}`}>{label}</h3>}
              {cards[id]}
            </section>
          ))}
          {view.emptyAdvice !== null && (
            <div className="settings-none">
              <p>{view.emptyAdvice}</p>
              <button type="button" className="btn" onClick={clear}>Clear search</button>
            </div>
          )}
          <p className="sr" role="status">{view.announcement}</p>
          <p className="sr" role="status" id={`${ids}-away`}>{view.hiddenCheck}</p>
        </div>
      </main>
      <header className="bar">
        <button type="button" aria-keyshortcuts="Escape" disabled={saving} onClick={onRequestClose}>Close</button>
      </header>
    </div>
  )
}
