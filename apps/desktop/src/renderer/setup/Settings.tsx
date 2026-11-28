import { shownBot, shownChat, type AvatarTone } from '@highwing/hermes/domain'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { Accent, Mode, NoticeKind, OnClose, ShowWork, Theme } from '../../ipc-contract'
import { botIn } from '../bots/roster-view'
import { accentTone, toneOfBot } from '../chrome/accent'
import { COMMAND_KEY, MAC } from '../keys'
import { capsOf, SHORTCUTS } from '../shortcuts'
import { run, useTopic } from '../store'
import { AppearanceRows } from './AppearanceRows'
import { Bubble, ConnectionCard, line, People, Segmented, Server, type Look, type Segment } from './ConnectionCard'
import { Models } from './Models'
import { PasswordManagers } from './PasswordManagers'
import type { CardSetup } from './screens'
import { PAGES, settingsViewOf, whereOf, type Check, type Page, type RowId } from './settings-view'
import { Skills } from './Skills'
import { UNREPORTED, usageNeedsRead, usageView, type UsageAsk, type UsageView } from './usage-view'

const Chip = () => <svg {...line(16, 1.8)}><rect x="6" y="6" width="12" height="12" rx="2.5" /><path d="M9.5 2.5v3.5M14.5 2.5v3.5M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5" /></svg>
const Contrast = () => <svg {...line(16, 1.8)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7a5 5 0 0 1 0 10z" fill="currentColor" /></svg>
const Cross = () => <svg {...line(14, 2)}><path d="M6 6l12 12M18 6 6 18" /></svg>
const Keyboard = () => <svg {...line(16, 1.8)}><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><path d="M6.5 9.5h.01M10 9.5h.01M14 9.5h.01M17.5 9.5h.01M6.5 12.5h.01M17.5 12.5h.01M9 15.5h6" /></svg>
const Search = () => <svg {...line(16, 1.8)}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
const WindowIcon = () => <svg {...line(16, 1.8)}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 9h18" /></svg>
const Bell = () => <svg {...line(16, 1.8)}><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></svg>
const Key = () => <svg {...line(16, 1.8)}><circle cx="8" cy="15" r="4" /><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" /></svg>
const Spark = () => <svg {...line(16, 1.8)}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5" /></svg>
const Shield = () => <svg {...line(16, 1.8)}><path d="M12 3 5 5.8v5.4c0 4.4 3 8 7 9.8 4-1.8 7-5.4 7-9.8V5.8z" /></svg>
const Gauge = () => <svg {...line(16, 1.8)}><path d="M4 18a8 8 0 1 1 16 0" /><path d="m12 18 4-5" /></svg>
const Pen = () => <svg {...line(16, 1.8)}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>
const Info = () => <svg {...line(16, 1.8)}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></svg>
const Quit = () => <svg {...line(15, 1.9)}><path d="M10 7V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-1" /><path d="M4 12h10M11 8.5 14.5 12 11 15.5" /></svg>
const Tray = () => <svg {...line(15, 1.9)}><rect x="4" y="4" width="16" height="11" rx="2" /><path d="M3 20h18" /></svg>
const Wrench = () => <svg {...line(15, 1.9)}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z" /></svg>
const List = () => <svg {...line(15, 1.9)}><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></svg>

const PAGE_ICONS: { readonly [P in Page]: () => ReactNode } = {
  connection: () => <Server size={16} width={1.8} />, models: Chip, appearance: Contrast, composer: Pen, window: WindowIcon, notifications: Bell, passwords: Key, skills: Spark, permissions: Shield,
  keys: Keyboard, usage: Gauge, about: Info
}

const SIDEBAR: readonly Segment<Mode>[] = [
  { value: 'bots', label: 'Bots', icon: <People /> },
  { value: 'chats', label: 'Chats', icon: <Bubble /> }
]

type Scheme = 'light' | 'dark'

const THEMES: readonly { readonly value: Theme; readonly label: string; readonly schemes: readonly Scheme[] }[] = [
  { value: 'system', label: 'System', schemes: ['light', 'dark'] },
  { value: 'light', label: 'Light', schemes: ['light'] },
  { value: 'dark', label: 'Dark', schemes: ['dark'] }
]

const MiniWindow = ({ scheme, tone }: { readonly scheme: Scheme; readonly tone: AvatarTone | null }) => (
  <span className="mini-window" data-scheme={scheme} data-accent={tone ?? undefined}>
    <span className="mini-side"><span /><span /><span /></span>
    <span className="mini-chat"><span /><span /><span className="mine" /><span className="mini-composer"><span /></span></span>
  </span>
)

const looksOf = (tone: AvatarTone | null): readonly Segment<Theme>[] => THEMES.map(({ value, label, schemes }) => ({
  value, label, icon: <span className="mini" aria-hidden="true">{schemes.map(scheme => <MiniWindow key={scheme} scheme={scheme} tone={tone} />)}</span>
}))

const orb = (tone: AvatarTone) => <span className={`orb tone-${tone}`} aria-hidden="true" />

const ACCENTS: readonly Segment<Accent>[] = [
  { value: 'bot', label: 'Bot', icon: <span className="orb bot" aria-hidden="true"><People /></span> },
  { value: 'ink', label: 'Ink', icon: orb('ink') },
  { value: 'slate', label: 'Slate', icon: orb('slate') },
  { value: 'plum', label: 'Plum', icon: orb('plum') },
  { value: 'olive', label: 'Olive', icon: orb('olive') },
  { value: 'mauve', label: 'Mauve', icon: orb('mauve') },
  { value: 'umber', label: 'Umber', icon: orb('umber') }
]

const SHOW_WORK: readonly Segment<ShowWork>[] = [
  { value: 'replies', label: 'Replies only', icon: <Bubble /> },
  { value: 'actions', label: 'Actions', icon: <Wrench /> },
  { value: 'all', label: 'Everything', icon: <List /> }
]

const CLOSES: readonly Segment<OnClose>[] = [
  { value: 'quit', label: 'Quit', icon: <Quit /> },
  { value: 'stay', label: 'Keep in the tray', icon: <Tray /> }
]

const NOTICE_ROWS: readonly { readonly kind: NoticeKind; readonly id: RowId; readonly label: string; readonly desc: string }[] = [
  { kind: 'asks', id: 'notice-asks', label: 'Approvals and questions', desc: 'When a bot waits on you in a chat you aren’t looking at.' },
  { kind: 'replies', id: 'notice-replies', label: 'Finished replies', desc: 'When a reply ends in a chat you aren’t looking at.' },
  { kind: 'jobs', id: 'notice-jobs', label: 'Scheduled jobs', desc: 'When a scheduled job finishes.' }
]


const CHECK_SAID: { readonly [C in Exclude<Check, 'idle'>]: string } = { checking: 'checking', failed: 'check failed' }

const Count = ({ n }: { readonly n: number }) => (
  <span className="count"><span aria-hidden="true">{n}</span><span className="sr"> ({n} {n === 1 ? 'match' : 'matches'})</span></span>
)

function Choice<V extends string>({ label, desc, value, segments, hidden, look = 'seg', onPick }: {
  readonly label: string
  readonly desc: string
  readonly value: V
  readonly segments: readonly Segment<V>[]
  readonly hidden: boolean
  /** Cards and tiles take a line of their own below the label. */
  readonly look?: Look
  readonly onPick: (value: V) => void
}) {
  const id = useId()
  return (
    <div className={look === 'seg' ? 'row' : 'row wrapped'} hidden={hidden}>
      <div className="text">
        <p className="label" id={id}>{label}</p>
        <p className="desc" id={`${id}-desc`}>{desc}</p>
      </div>
      <div className="control"><Segmented labelledBy={id} describedBy={`${id}-desc`} value={value} segments={segments} look={look} onPick={onPick} /></div>
    </div>
  )
}

function NoticeRows({ off }: { readonly off: (row: RowId) => boolean }) {
  const ids = useId()
  const notices = useTopic('notices')
  return NOTICE_ROWS.map(({ kind, id, label, desc }) => (
    <div key={kind} className="row" hidden={off(id)}>
      <div className="text">
        <p className="label" id={`${ids}-${kind}`}>{label}</p>
        <p className="desc" id={`${ids}-${kind}-desc`}>{desc}</p>
      </div>
      <div className="control">
        <input
          type="checkbox" role="switch" checked={notices?.[kind] ?? true} disabled={notices === undefined} aria-labelledby={`${ids}-${kind}`} aria-describedby={`${ids}-${kind}-desc`}
          onChange={() => notices !== undefined && void run({ do: 'setNotice', kind, on: !notices[kind] })}
        />
      </div>
    </div>
  ))
}

/** The composer's send key and spell check. Each holds across restarts, in every window. */
export function ComposerRows({ off }: { readonly off: (row: RowId) => boolean }) {
  const ids = useId()
  const sendKey = useTopic('sendKey')
  const spellCheck = useTopic('spellCheck')
  return (
    <>
      <div className="row" hidden={off('send-key')}>
        <div className="text">
          <p className="label" id={`${ids}-send-key`}>Send with {COMMAND_KEY}+Enter</p>
          <p className="desc" id={`${ids}-send-key-desc`}>Enter adds a new line. When off, Enter sends and Shift+Enter adds a line.</p>
        </div>
        <div className="control">
          <input
            type="checkbox" role="switch" aria-labelledby={`${ids}-send-key`} aria-describedby={`${ids}-send-key-desc`}
            checked={sendKey === 'modEnter'} onChange={event => void run({ do: 'setSendKey', sendKey: event.target.checked ? 'modEnter' : 'enter' })}
          />
        </div>
      </div>
      <div className="row" hidden={off('spell-check')}>
        <div className="text">
          <p className="label" id={`${ids}-spell`}>Check spelling</p>
          <p className="desc" id={`${ids}-spell-desc`}>Underline misspelled words and suggest fixes.</p>
        </div>
        <div className="control">
          <input
            type="checkbox" role="switch" aria-labelledby={`${ids}-spell`} aria-describedby={`${ids}-spell-desc`}
            checked={spellCheck ?? true} onChange={event => void run({ do: 'setSpellCheck', spellCheck: event.target.checked })}
          />
        </div>
      </div>
    </>
  )
}

function Usage() {
  const sessionId = shownChat(useTopic('open'))?.sessionId ?? null
  const live = useTopic(sessionId === null ? null : `session:${sessionId}`)?.sync.state === 'live'
  const [ask, setAsk] = useState<UsageAsk>({ at: 'idle' })
  const askRef = useRef(ask)
  askRef.current = ask
  useEffect(() => {
    if (sessionId === null || !usageNeedsRead(sessionId, live, askRef.current)) return
    let current = true
    setAsk({ at: 'reading', sessionId })
    void run({ do: 'accountUsage', sessionId }).then(outcome => {
      if (current) setAsk({ at: 'settled', sessionId, outcome })
    })
    return () => { current = false }
  }, [sessionId, live])
  return <UsageCard view={usageView(sessionId, ask)} />
}

export function UsageCard({ view }: { readonly view: UsageView }) {
  return (
    <div className="card rows">
      {view.state === 'needs-chat' && <div className="row"><div className="text"><p className="label">Open a chat to see what this Hermes reports.</p></div></div>}
      {view.state === 'reading' && <div className="row"><div className="text"><p className="desc">Reading usage…</p></div></div>}
      {view.state === 'failed' && <div className="row"><div className="text"><p className="label">{view.message}</p></div></div>}
      {view.state === 'unreported' && <div className="row"><div className="text"><p className="label">{UNREPORTED}</p></div></div>}
      {view.state === 'reported' && view.lines.map((line, index) => (
        <div key={`${index}-${line}`} className="row"><div className="text"><p className="label usage-line">{line}</p></div></div>
      ))}
    </div>
  )
}

function About({ off }: { readonly off: (row: RowId) => boolean }) {
  const about = useTopic('about')
  const hermes = about === undefined ? null
    : about.hermes.state === 'known' ? about.hermes.version
    : about.hermes.state === 'offline' ? 'Not connected.'
    : 'This Hermes hasn’t reported a version.'
  return (
    <div className="card rows">
      <div className="row" hidden={off('about-app')}>
        <div className="text"><p className="label">App</p></div>
        <div className="control">{about?.app ?? ''}</div>
      </div>
      <div className="row" hidden={off('about-hermes')}>
        <div className="text"><p className="label">Hermes</p></div>
        <div className="control">{hermes}</div>
      </div>
    </div>
  )
}

export function Settings({ setup, mode, theme, accent, onRequestClose, onShowShortcuts }: {
  readonly setup: CardSetup
  readonly mode: Mode
  readonly theme: Theme
  readonly accent: Accent
  readonly onRequestClose: () => void
  readonly onShowShortcuts: () => void
}) {
  const saving = setup.at === 'checking' && setup.step === 'save'
  const link = useTopic('link')
  const book = useTopic('servers')
  const onClose = useTopic('onClose') ?? 'quit'
  const showWork = useTopic('showWork') ?? 'all'
  const tone = accentTone(accent, toneOfBot(useTopic('bots'), shownChat(useTopic('open'))?.bot ?? null))
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
  const shown = (at: Page) => view.pages.includes(at)
  const cards: { readonly [P in Page]: ReactNode } = {
    connection: <ConnectionCard setup={setup} link={link} {...(book === undefined ? {} : { book })} />,
    // Mounted only while shown: each asks Hermes as it mounts.
    models: shown('models') && <Models labelledBy={`${ids}-models`} />,
    appearance: (
      <div className="card rows">
        <Choice label="Theme" desc="System follows your computer’s light or dark setting." value={theme} segments={looksOf(tone)} hidden={off('theme')} look="looks" onPick={picked => void run({ do: 'setTheme', theme: picked })} />
        <Choice label="Accent" desc="Bot uses the color of the open chat’s bot." value={accent} segments={ACCENTS} hidden={off('accent')} look="tones" onPick={picked => void run({ do: 'setAccent', accent: picked })} />
        <Choice label="Show the bot’s work" desc="Replies only hides thinking and tool calls, and shows the bot hopping while it works." value={showWork} segments={SHOW_WORK} hidden={off('show-work')} onPick={picked => void run({ do: 'setShowWork', showWork: picked })} />
        <Choice label="Show in the sidebar" desc="Bots shows your bots. Chats shows the chats of the open bot." value={mode} segments={SIDEBAR} hidden={off('sidebar')} onPick={picked => void run({ do: 'setMode', mode: picked })} />
        <AppearanceRows off={off} />
      </div>
    ),
    composer: <div className="card rows"><ComposerRows off={off} /></div>,
    window: (
      <div className="card rows">
        <Choice label="When the window closes" desc="Quit leaves Highwing. Keep in the tray leaves it running." value={onClose} segments={CLOSES} hidden={off('on-close')} onPick={picked => void run({ do: 'setOnClose', onClose: picked })} />
      </div>
    ),
    notifications: <div className="card rows"><NoticeRows off={off} /></div>,
    passwords: shown('passwords') && <PasswordManagers labelledBy={`${ids}-passwords`} />,
    skills: shown('skills') && <Skills />,
    permissions: (
      <div className="card rows">
        <div className="row" hidden={off('permissions')}>
          <div className="text"><p className="label">Commands are approved on the composer.</p></div>
        </div>
        {/* Mounted only while shown: it asks Hermes as it mounts. */}
        {!off('denied') && <DenyRules />}
      </div>
    ),
    keys: (
      <div className="card rows">
        <div className="row" hidden={off('shortcuts')}>
          <div className="text">
            <p className="label">All shortcuts</p>
            <p className="desc">Every shortcut Highwing has, grouped by what it does.</p>
          </div>
          <div className="control">
            <button type="button" className="btn" aria-keyshortcuts={MAC ? 'Meta+/' : 'Control+/'} onClick={onShowShortcuts}>Show all</button>
          </div>
        </div>
        {SHORTCUTS.map(shortcut => (
          <div key={shortcut.id} className="row" hidden={off(`key:${shortcut.id}`)}>
            <div className="text"><p className="label">{shortcut.label}</p><p className="desc">{whereOf(shortcut)}</p></div>
            <div className="control keys">{capsOf(shortcut, MAC).map(cap => <kbd key={cap}>{cap}</kbd>)}</div>
          </div>
        ))}
      </div>
    ),
    usage: shown('usage') && <Usage />,
    about: <About off={off} />
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
            <section key={id} className="group" hidden={!shown(id)} aria-labelledby={view.titlesPages ? `${ids}-${id}` : `${ids}-title`}>
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

type DenyRead =
  | { readonly at: 'reading' }
  | { readonly at: 'read'; readonly rules: readonly string[] }
  | { readonly at: 'refused'; readonly words: string }

/** Read again when the window comes back to the front: the rules change only in the bot's config.yaml, outside Highwing. */
function DenyRules() {
  const bot = shownBot(useTopic('open'))
  const bots = useTopic('bots')
  const name = bot === null ? null : botIn(bots, bot)?.name ?? null
  const [read, setRead] = useState<DenyRead>({ at: 'reading' })
  const ids = useId()

  useEffect(() => {
    setRead({ at: 'reading' })
    let asked = 0
    const ask = () => {
      const mine = ++asked
      void run({ do: 'denyRules', bot }).then(outcome => {
        if (mine === asked) setRead(outcome.ok ? { at: 'read', rules: outcome.value } : { at: 'refused', words: outcome.refusal.message })
      })
    }
    ask()
    window.addEventListener('focus', ask)
    return () => {
      asked = -1
      window.removeEventListener('focus', ask)
    }
  }, [bot])

  return (
    <>
      <div className="row">
        <div className="text">
          <p className="label" id={`${ids}-denied`}>Denied commands</p>
          <p className="desc">{name ?? 'This bot'} never runs a command that matches one of these, even with YOLO on. To change them, edit approvals.deny in the bot’s config.yaml.</p>
          {read.at === 'read' && read.rules.length === 0 && <p className="desc">No commands are denied.</p>}
          {read.at === 'refused' && <p className="desc">{read.words}</p>}
        </div>
      </div>
      {read.at === 'read' && read.rules.length > 0 && (
        <ul className="rules" aria-labelledby={`${ids}-denied`}>
          {read.rules.map((rule, index) => <li key={index} className="row"><code>{rule}</code></li>)}
        </ul>
      )}
    </>
  )
}
