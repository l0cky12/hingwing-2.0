import { shownChat } from '@highwing/hermes/domain'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Mode, OnClose, Theme } from '../../ipc-contract'
import { Bar } from '../chrome/Chrome'
import { COMMAND_KEY } from '../keys'
import { run, useTopic } from '../store'
import { Bubble, ConnectionCard, Monitor, Moon, People, Segmented, Sun, type Segment } from './ConnectionCard'
import { PasswordManagers } from './PasswordManagers'
import type { CardSetup } from './screens'
import { usageNeedsRead, usageView, type UsageAsk } from './usage-view'

const SIDEBAR: readonly Segment<Mode>[] = [
  { value: 'bots', label: 'Bots', icon: <People /> },
  { value: 'chats', label: 'Chats', icon: <Bubble /> }
]

const THEMES: readonly Segment<Theme>[] = [
  { value: 'system', label: 'System', icon: <Monitor /> },
  { value: 'light', label: 'Light', icon: <Sun /> },
  { value: 'dark', label: 'Dark', icon: <Moon /> }
]

const icon = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
const Quit = () => <svg {...icon}><path d="M10 7V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-1" /><path d="M4 12h10M11 8.5 14.5 12 11 15.5" /></svg>
const Tray = () => <svg {...icon}><rect x="4" y="4" width="16" height="11" rx="2" /><path d="M3 20h18" /></svg>

const CLOSES: readonly Segment<OnClose>[] = [
  { value: 'quit', label: 'Quit', icon: <Quit /> },
  { value: 'stay', label: 'Keep in the tray', icon: <Tray /> }
]

const SHORTCUTS: readonly { readonly label: string; readonly key: string; readonly onlyIn: string | null }[] = [
  { label: 'Command palette', key: 'K', onlyIn: null },
  { label: 'Settings', key: ',', onlyIn: null },
  { label: 'New chat', key: 'N', onlyIn: 'In a chat' },
  { label: 'Find in chat', key: 'F', onlyIn: 'In a chat' }
]

const UNREPORTED = 'This Hermes does not report usage.'

interface PanelProps {
  readonly setup: CardSetup
  readonly mode: Mode
  readonly theme: Theme
}

const panel = (render: (props: PanelProps) => ReactNode) => render

function General({ mode, theme }: { readonly mode: Mode; readonly theme: Theme }) {
  const ids = useId()
  const onClose = useTopic('onClose') ?? 'quit'
  return (
    <>
      <section className="group" aria-labelledby={`${ids}-appearance`}>
        <h3 id={`${ids}-appearance`}>Appearance</h3>
        <div className="card">
          <div className="row">
            <div className="text">
              <p className="label" id={`${ids}-theme`}>Theme</p>
              <p className="desc">System follows your computer’s light or dark setting.</p>
            </div>
            <div className="control">
              <Segmented labelledBy={`${ids}-theme`} value={theme} segments={THEMES} onPick={picked => void run({ do: 'setTheme', theme: picked })} />
            </div>
          </div>
        </div>
      </section>
      <section className="group" aria-labelledby={`${ids}-passwords`}>
        <h3 id={`${ids}-passwords`}>Password managers</h3>
        <PasswordManagers labelledBy={`${ids}-passwords`} />
      </section>
      <section className="group" aria-labelledby={`${ids}-sidebar`}>
        <h3 id={`${ids}-sidebar`}>Sidebar</h3>
        <div className="card">
          <div className="row">
            <div className="text">
              <p className="label" id={`${ids}-show`}>Show in the sidebar</p>
              <p className="desc">Bots shows your bots. Chats shows the chats of the open bot.</p>
            </div>
            <div className="control">
              <Segmented labelledBy={`${ids}-show`} value={mode} segments={SIDEBAR} onPick={picked => void run({ do: 'setMode', mode: picked })} />
            </div>
          </div>
        </div>
      </section>
      <section className="group" aria-labelledby={`${ids}-window`}>
        <h3 id={`${ids}-window`}>Window</h3>
        <div className="card">
          <div className="row">
            <div className="text">
              <p className="label" id={`${ids}-close`}>When the window closes</p>
              <p className="desc">Quit leaves Highwing. Keep in the tray leaves it running.</p>
            </div>
            <div className="control">
              <Segmented labelledBy={`${ids}-close`} value={onClose} segments={CLOSES} onPick={picked => void run({ do: 'setOnClose', onClose: picked })} />
            </div>
          </div>
        </div>
      </section>
      <section className="group short" aria-labelledby={`${ids}-keys`}>
        <h3 id={`${ids}-keys`}>Keyboard shortcuts</h3>
        <div className="card">
          {SHORTCUTS.map(({ label, key, onlyIn }) => (
            <div key={key} className="row">
              <div className="text"><p className="label">{label}{onlyIn !== null && <span className="where">{onlyIn}</span>}</p></div>
              <div className="control keys"><kbd>{COMMAND_KEY}</kbd><kbd>{key}</kbd></div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

function Permissions() {
  return (
    <section className="group">
      <div className="card">
        <div className="row">
          <div className="text"><p className="label">Commands are approved on the composer.</p></div>
        </div>
      </div>
    </section>
  )
}

function Machine({ setup }: { readonly setup: CardSetup }) {
  const link = useTopic('link')
  const ids = useId()
  return (
    <section className="group" aria-labelledby={`${ids}-connection`}>
      <h3 id={`${ids}-connection`}>Connection</h3>
      <ConnectionCard setup={setup} link={link} />
    </section>
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
  const view = usageView(sessionId, ask)
  return (
    <section className="group">
      <div className="card">
        {view.state === 'needs-chat' && <div className="row"><div className="text"><p className="label">Open a chat to see what this Hermes reports.</p></div></div>}
        {view.state === 'reading' && <div className="row"><div className="text"><p className="desc">Reading usage…</p></div></div>}
        {view.state === 'failed' && <div className="row"><div className="text"><p className="label">{view.message}</p></div></div>}
        {view.state === 'unreported' && <div className="row"><div className="text"><p className="label">{UNREPORTED}</p></div></div>}
        {view.state === 'reported' && view.lines.map((line, index) => (
          <div key={`${index}-${line}`} className="row"><div className="text"><p className="label">{line}</p></div></div>
        ))}
      </div>
    </section>
  )
}

function About() {
  const about = useTopic('about')
  const hermes = about === undefined ? null
    : about.hermes.state === 'known' ? about.hermes.version
    : about.hermes.state === 'offline' ? 'Not connected.'
    : 'This Hermes hasn’t reported a version.'
  return (
    <section className="group">
      <div className="card">
        <div className="row">
          <div className="text"><p className="label">App</p></div>
          <div className="control">{about?.app ?? ''}</div>
        </div>
        <div className="row">
          <div className="text"><p className="label">Hermes</p></div>
          <div className="control">{hermes}</div>
        </div>
      </div>
    </section>
  )
}

const SECTIONS = [
  { id: 'general', label: 'General', Panel: panel(({ mode, theme }) => <General mode={mode} theme={theme} />) },
  { id: 'permissions', label: 'Permissions', Panel: panel(() => <Permissions />) },
  { id: 'machine', label: 'Hermes machine', Panel: panel(({ setup }) => <Machine setup={setup} />) },
  { id: 'usage', label: 'Usage', Panel: panel(() => <Usage />) },
  { id: 'about', label: 'About', Panel: panel(() => <About />) }
] as const

type SectionId = (typeof SECTIONS)[number]['id']

function sectionBy(id: SectionId): (typeof SECTIONS)[number] {
  for (const section of SECTIONS) if (section.id === id) return section
  throw new Error(`No settings section ${id}`)
}

export function Settings({ setup, mode, theme, onRequestClose }: { readonly setup: CardSetup; readonly mode: Mode; readonly theme: Theme; readonly onRequestClose: () => void }) {
  const saving = setup.at === 'checking' && setup.step === 'save'
  const heading = useRef<HTMLHeadingElement>(null)
  const [current, setCurrent] = useState<SectionId>(setup.at === 'saved' ? 'machine' : 'general')
  const section = sectionBy(current)

  useLayoutEffect(() => {
    if (setup.at !== 'saved') heading.current?.focus()
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || document.querySelector('dialog:modal') !== null) return
      event.preventDefault()
      onRequestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onRequestClose])

  return (
    <div className="screen">
      <Bar where="Settings">
        <button type="button" aria-keyshortcuts="Escape" disabled={saving} onClick={onRequestClose}>Close</button>
      </Bar>
      <main>
        <div className="settings">
          <h2 ref={heading} tabIndex={-1}>Settings</h2>
          <nav aria-label="Settings sections">
            {SECTIONS.map(item => (
              <button type="button" key={item.id} aria-current={item.id === section.id ? 'page' : undefined} onClick={() => setCurrent(item.id)}>{item.label}</button>
            ))}
          </nav>
          <div className="panel">
            <section.Panel setup={setup} mode={mode} theme={theme} />
          </div>
        </div>
      </main>
    </div>
  )
}
