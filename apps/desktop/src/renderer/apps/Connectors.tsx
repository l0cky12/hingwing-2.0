import {
  CONNECTOR_FILTERS, connectorsView, shownBot, shownChat, STANDING_WORDS, type CommandOutcome, type AppEntry, type AppsBoard, type BotId, type ConnectorFilter, type ConnectorShelf, type ConnectorsQuery, type ConnectorsView, type ServerSetup, type Toolset, type ToolServer
} from '@highwing/hermes/domain'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { connectorsKeys } from '../keys'
import { line } from '../setup/ConnectionCard'
import { nameOf, useSkillSwitches } from '../setup/Skills'
import { run, useTopic } from '../store'
import { useSwitches } from '../switches'
import { ToolServerForm, useToolServers } from './ToolServers'
import { namedTools, STATES, toolCount } from './tool-servers-view'

type Tab = 'skills' | 'plugins' | 'connectors' | 'tools'
const TABS: readonly { readonly tab: Tab; readonly label: string }[] = [
  { tab: 'skills', label: 'Skills' }, { tab: 'plugins', label: 'Plugins' }, { tab: 'connectors', label: 'Connectors' }, { tab: 'tools', label: 'Tools' }
]
const FILTER_WORDS: { readonly [F in ConnectorFilter]: string } = { all: 'All', added: 'Added', available: 'Available' }
const SHELF_WORDS: { readonly [S in ConnectorShelf]: string } = { added: 'Added', available: 'Available' }

const Cross = () => <svg {...line(14, 2)}><path d="M6 6l12 12M18 6 6 18" /></svg>
const Search = () => <svg {...line(16, 1.8)}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
const GridPlus = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
    <rect x="2" y="2" width="4.5" height="4.5" rx="1" /><rect x="9.5" y="2" width="4.5" height="4.5" rx="1" /><rect x="2" y="9.5" width="4.5" height="4.5" rx="1" />
    <path d="M11.75 9.5v4.5M9.5 11.75H14" />
  </svg>
)

export function ConnectorsButton({ onOpen }: { readonly onOpen: () => void }) {
  const keys = connectorsKeys()
  return <button type="button" className="connectors-open" aria-label="Connectors" title={`Connectors (${keys.shown})`} aria-keyshortcuts={keys.aria} onClick={onOpen}><GridPlus /></button>
}

interface Waiting {
  readonly slug: string
  readonly opId: string | null
  readonly url: string | null
}

function useApps(bot: BotId | null) {
  const [board, setBoard] = useState<AppsBoard | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [waiting, setWaiting] = useState<Waiting | null>(null)
  const openRef = useRef(true)
  const signingIn = useRef(false)
  const opId = waiting?.opId ?? null

  useEffect(() => {
    openRef.current = true
    let stopped = false
    void run({ do: 'apps', bot }).then(outcome => {
      if (stopped || !openRef.current) return
      if (outcome.ok) {
        setBoard(outcome.value)
        setProblem(null)
      } else setProblem(outcome.refusal.message)
    })
    return () => {
      stopped = true
      openRef.current = false
    }
  }, [bot])

  useEffect(() => {
    if (opId === null) return
    let stopped = false
    let id = 0
    const tick = async () => {
      const outcome = await run({ do: 'appSignIn', opId, bot })
      if (stopped || !openRef.current) return
      if (!outcome.ok) {
        signingIn.current = false
        setWaiting(null)
        setProblem(outcome.refusal.message)
        return
      }
      if (!outcome.value.settled) return
      stopped = true
      clearInterval(id)
      signingIn.current = false
      const next = await run({ do: 'apps', bot })
      if (!openRef.current) return
      if (next.ok) setBoard(next.value)
      else setProblem(next.refusal.message)
      setWaiting(null)
    }
    id = window.setInterval(() => void tick(), 400)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [opId, bot])

  const connect = (app: AppEntry) => {
    if (signingIn.current) return
    signingIn.current = true
    setWaiting({ slug: app.slug, opId: null, url: null })
    void run({ do: 'connectApp', slug: app.slug, bot, connectionId: app.account?.connectionId ?? null }).then(async outcome => {
      if (!openRef.current) return
      if (!outcome.ok) {
        signingIn.current = false
        setWaiting(null)
        setProblem(outcome.refusal.message)
        return
      }
      const { url, settled } = outcome.value
      if (url !== null) void run({ do: 'browse', url })
      if (settled || outcome.value.opId === '') {
        signingIn.current = false
        setWaiting(null)
        const next = await run({ do: 'apps', bot })
        if (!openRef.current) return
        if (next.ok) setBoard(next.value)
        else setProblem(next.refusal.message)
        return
      }
      setWaiting({ slug: app.slug, opId: outcome.value.opId, url })
    })
  }

  const remove = (app: AppEntry) => {
    const connectionId = app.account?.connectionId
    if (connectionId === undefined || signingIn.current) return
    void run({ do: 'removeApp', connectionId, bot }).then(async outcome => {
      if (!openRef.current) return
      if (!outcome.ok) {
        setProblem(outcome.refusal.message)
        return
      }
      const next = await run({ do: 'apps', bot })
      if (!openRef.current) return
      if (next.ok) setBoard(next.value)
      else setProblem(next.refusal.message)
    })
  }

  return { board, problem, waiting, connect, remove }
}

type Listed<T> = { readonly at: 'reading' } | { readonly at: 'read'; readonly items: readonly T[] } | { readonly at: 'refused'; readonly words: string }

function useListed<T>(ask: () => Promise<CommandOutcome<readonly T[]>>, key: string | null) {
  const [read, setRead] = useState<Listed<T>>({ at: 'reading' })
  useEffect(() => {
    let stopped = false
    setRead({ at: 'reading' })
    void ask().then(outcome => {
      if (!stopped) setRead(outcome.ok ? { at: 'read', items: outcome.value } : { at: 'refused', words: outcome.refusal.message })
    })
    return () => { stopped = true }
  }, [key])
  return [read, (items: readonly T[]) => setRead({ at: 'read', items })] as const
}

function usePlugins(bot: BotId | null) {
  const [read, setRead] = useListed(() => run({ do: 'plugins', bot }), bot)
  const [restart, setRestart] = useState<ReadonlySet<string>>(new Set())
  const switches = useSwitches(bot, read.at === 'read' ? read.items : null, plugin => plugin.key, async (plugin, enabled) => {
    const done = await run({ do: 'setPlugin', bot, key: plugin.key, enabled })
    if (done.ok) {
      setRead(done.value.plugins)
      setRestart(keys => new Set(done.value.restart ? [...keys, plugin.key] : [...keys].filter(key => key !== plugin.key)))
    }
    return done
  })
  return { read, restart, ...switches }
}

interface CardProps {
  readonly name: string
  readonly kind?: string
  readonly logo?: string | null
  readonly detail: string
  readonly mono?: boolean
  readonly toolNames?: string
  readonly state?: { readonly standing: string; readonly words: string }
  readonly later?: boolean
  readonly children?: ReactNode
}

function Card({ name, kind, logo = null, detail, mono = false, toolNames = '', state, later = false, children }: CardProps) {
  const [broken, setBroken] = useState<string | null>(null)
  return (
    <li className="hub-card">
      <span className="hub-tile" aria-hidden="true">
        {logo !== null && broken !== logo ? <img alt="" src={logo} onError={() => setBroken(logo)} /> : name.slice(0, 1).toUpperCase()}
      </span>
      <div className="hub-copy">
        <p className="hub-name">{name}{kind !== undefined && <span className="hub-kind">{kind}</span>}</p>
        {detail !== '' && <p className="hub-detail" data-mono={mono || undefined} title={detail}>{detail}</p>}
        {toolNames !== '' && <p className="hub-detail" data-mono title={toolNames}>{toolNames}</p>}
        {later && <p className="hub-later">Takes effect when Hermes restarts.</p>}
      </div>
      <div className="hub-side">
        {state !== undefined && <p className="hub-state" data-standing={state.standing}>{state.words}</p>}
        {children}
      </div>
    </li>
  )
}

function AppCard({ app, waiting, onConnect, onRemove }: { readonly app: AppEntry; readonly waiting: Waiting | null; readonly onConnect: () => void; readonly onRemove: () => void }) {
  const mine = waiting?.slug === app.slug
  const again = mine ? waiting.url : null
  const reconnect = app.account !== null
  const state = mine ? { standing: 'connecting', words: 'Connecting…' }
    : app.account === null ? { standing: 'available', words: 'Available' }
    : { standing: app.account.standing, words: STANDING_WORDS[app.account.standing] }
  return (
    <Card name={app.name} kind={`App · ${app.category}`} logo={app.logo} detail={app.description} state={state}>
      <div className="hub-actions">
        {again !== null && <button type="button" onClick={() => void run({ do: 'browse', url: again })}>Open sign-in again</button>}
        <button type="button" aria-label={`${reconnect ? 'Reconnect' : 'Connect'} ${app.name}`} disabled={waiting !== null} onClick={onConnect}>{reconnect ? 'Reconnect' : 'Connect'}</button>
        {reconnect && <button type="button" aria-label={`Remove ${app.name}`} disabled={waiting !== null} onClick={onRemove}>Remove</button>}
      </div>
    </Card>
  )
}

function ServerCard({ server, busy, onRemove }: { readonly server: ToolServer; readonly busy: boolean; readonly onRemove: () => void }) {
  return (
    <Card name={server.name} kind={server.removable ? 'MCP · Custom' : 'MCP · Plugin'} detail={server.where} mono state={{ standing: server.state, words: STATES[server.state](server.tools) }}>
      {server.removable && (
        <div className="hub-actions"><button type="button" disabled={busy} aria-label={`Remove tool server ${server.name}`} onClick={onRemove}>Remove</button></div>
      )}
    </Card>
  )
}

interface ConnectorsProps {
  readonly apps: ReturnType<typeof useApps>
  readonly servers: ReturnType<typeof useToolServers>
  readonly view: ConnectorsView
  readonly reading: boolean
  readonly query: ConnectorsQuery
  readonly onQuery: (query: ConnectorsQuery) => void
}

function ConnectorsPanel({ apps, servers, view, reading, query: { text, filter }, onQuery }: ConnectorsProps) {
  const [adding, setAdding] = useState(false)
  const unsupported = servers.read.at === 'refused' && servers.read.unsupported

  const add = async (setup: ServerSetup) => {
    if (await servers.add(setup)) setAdding(false)
  }

  return (
    <>
      <div className="hub-search">
        <Search />
        <input
          type="search" aria-label="Search connectors" placeholder={`Search ${view.total} ${view.total === 1 ? 'connector' : 'connectors'}`}
          autoFocus spellCheck={false} autoComplete="off" value={text} onChange={event => onQuery({ text: event.target.value, filter })}
        />
        {!unsupported && (
          <button type="button" aria-expanded={adding} onClick={() => { setAdding(true); servers.quiet() }}>Add your own</button>
        )}
      </div>
      {adding && <ToolServerForm testing={servers.testing} busy={servers.busy} onAdd={setup => void add(setup)} onCancel={() => { setAdding(false); servers.quiet() }} />}
      <p className="tool-said" role="status">{servers.testing ? 'Testing…' : servers.said?.ok === true ? servers.said.words : ''}</p>
      {servers.said?.ok === false && <p className="tool-problem" role="alert">{servers.said.words}</p>}
      {apps.problem !== null && <p className="hub-note" role="alert">{apps.problem}</p>}
      {servers.read.at === 'refused' && (
        <div className="hub-note">
          <p role="alert">{servers.read.words}</p>
          {!servers.read.unsupported && <button type="button" disabled={servers.busy} onClick={() => void servers.reread()}>Try again</button>}
        </div>
      )}
      <div className="hub-chips" role="group" aria-label="Show">
        {CONNECTOR_FILTERS.map(shown => (
          <button key={shown} type="button" aria-pressed={filter === shown} onClick={() => onQuery({ text, filter: shown })}>
            {FILTER_WORDS[shown]} <span className="hub-count">{view.counts[shown]}</span>
          </button>
        ))}
      </div>
      {reading && <p className="hub-note" role="status">Asking Hermes…</p>}
      {view.sections.map(section => (
        <section key={section.shelf} aria-label={SHELF_WORDS[section.shelf]}>
          <h3 className="hub-heading">{SHELF_WORDS[section.shelf]} <span className="hub-count">{section.cards.length}</span></h3>
          <ul className="hub-grid">
            {section.cards.map(card => (card.kind === 'app'
              ? <AppCard key={`app:${card.app.slug}`} app={card.app} waiting={apps.waiting} onConnect={() => apps.connect(card.app)} onRemove={() => apps.remove(card.app)} />
              : <ServerCard key={`server:${card.server.name}`} server={card.server} busy={servers.busy} onRemove={() => void servers.remove(card.server.name)} />))}
          </ul>
        </section>
      ))}
      {!reading && view.total > 0 && view.sections.length === 0 && <p className="hub-note">No connectors match.</p>}
      {!reading && view.total === 0 && apps.problem === null && servers.read.at === 'read' && <p className="hub-note">No connectors yet.</p>}
    </>
  )
}

function SkillsPanel({ name, switches }: { readonly name: string; readonly switches: ReturnType<typeof useSkillSwitches> }) {
  const { library, problem, of } = switches
  return (
    <>
      <p className="hub-lead">A skill turned off stays installed, and {name} won’t use it until you turn it on.</p>
      {(library === undefined || library.state === 'reading') && <p className="hub-note" role="status">Reading skills…</p>}
      {library?.state === 'failed' && <p className="hub-note" role="alert">{library.message}</p>}
      {library?.state === 'listed' && library.skills.length === 0 && <p className="hub-note">{name} has no skills.</p>}
      {library?.state === 'listed' && library.skills.length > 0 && (
        <ul className="hub-grid">
          {library.skills.map(skill => (
            <Card key={skill.name} name={skill.name} detail={skill.description}>
              <input type="checkbox" role="switch" className="hub-switch" aria-label={`Use ${skill.name}`} {...of(skill)} />
            </Card>
          ))}
        </ul>
      )}
      {problem !== null && <p className="hub-note" role="alert">{problem}</p>}
    </>
  )
}

const sourceWords = (source: string) => source.charAt(0).toUpperCase() + source.slice(1)

function PluginsPanel({ name, plugins: { read, restart, problem, of } }: { readonly name: string; readonly plugins: ReturnType<typeof usePlugins> }) {
  return (
    <>
      {read.at === 'reading' && <p className="hub-note" role="status">Asking Hermes…</p>}
      {read.at === 'refused' && <p className="hub-note" role="alert">{read.words}</p>}
      {read.at === 'read' && read.items.length === 0 && <p className="hub-note">{name} has no plugins.</p>}
      {read.at === 'read' && read.items.length > 0 && (
        <ul className="hub-grid">
          {read.items.map(plugin => (
            <Card
              key={plugin.key} name={plugin.name} kind={[plugin.version === '' ? null : `v${plugin.version}`, sourceWords(plugin.source)].filter(Boolean).join(' · ')}
              detail={plugin.description} later={restart.has(plugin.key)}
            >
              <input type="checkbox" role="switch" className="hub-switch" aria-label={`Use ${plugin.name}`} {...of(plugin)} />
            </Card>
          ))}
        </ul>
      )}
      {problem !== null && <p className="hub-note" role="alert">{problem}</p>}
    </>
  )
}

function ToolsPanel({ read }: { readonly read: Listed<Toolset> }) {
  return (
    <>
      {read.at === 'reading' && <p className="hub-note" role="status">Asking Hermes…</p>}
      {read.at === 'refused' && <p className="hub-note" role="alert">{read.words}</p>}
      {read.at === 'read' && read.items.length === 0 && <p className="hub-note">Hermes has no toolsets.</p>}
      {read.at === 'read' && read.items.length > 0 && (
        <ul className="hub-grid">
          {read.items.map(toolset => (
            <Card
              key={toolset.name} name={toolset.name} detail={toolset.description} toolNames={namedTools(toolset.tools)}
              state={toolset.enabled ? { standing: 'on', words: `On · ${toolCount(toolset.toolCount)}` } : { standing: 'off', words: 'Off' }}
            />
          ))}
        </ul>
      )}
    </>
  )
}

export function Connectors({ onClose }: { readonly onClose: () => void }) {
  const ids = useId()
  const open = useTopic('open')
  const bot = shownBot(open)
  const name = nameOf(bot, useTopic('bots'))
  const [tab, setTab] = useState<Tab>('connectors')
  const tabs = useRef(new Map<Tab, HTMLButtonElement>())
  const switches = useSkillSwitches()
  const sessionId = shownChat(open)?.sessionId ?? null
  const plugins = usePlugins(bot)
  const [toolsets] = useListed(() => run({ do: 'tools', sessionId }), sessionId)
  const apps = useApps(bot)
  const servers = useToolServers(bot)
  const [query, setQuery] = useState<ConnectorsQuery>({ text: '', filter: 'all' })
  const view = connectorsView(apps.board, servers.read.at === 'read' ? servers.read.servers : [], query)
  const reading = (apps.board === null && apps.problem === null) || servers.read.at === 'reading'
  const counts: { readonly [T in Tab]: number | null } = {
    skills: switches.library?.state === 'listed' ? switches.library.skills.length : null,
    plugins: plugins.read.at === 'read' ? plugins.read.items.length : null,
    connectors: reading ? null : view.total,
    tools: toolsets.at === 'read' ? toolsets.items.length : null
  }

  const root = useRef<HTMLElement>(null)
  // A Remove or Connect that settles takes its button, and focus, with it, so Escape is heard from the whole window while focus is on this screen or on the page body.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || document.querySelector('dialog:modal') !== null) return
      const at = document.activeElement
      if (at !== null && at !== document.body && root.current?.contains(at) !== true) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const step = (event: KeyboardEvent<HTMLButtonElement>, at: number) => {
    const by = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (by === 0) return
    event.preventDefault()
    const next = TABS[(at + by + TABS.length) % TABS.length]!.tab
    setTab(next)
    tabs.current.get(next)?.focus()
  }

  return (
    <section ref={root} className="screen hub" aria-labelledby={`${ids}-title`}>
      <header className="hub-head">
        <h2 id={`${ids}-title`} className="sr">Connectors</h2>
        <div className="hub-tabs" role="tablist" aria-label="Sections">
          {TABS.map(({ tab: shown, label }, at) => (
            <button
              key={shown} ref={button => { if (button === null) tabs.current.delete(shown); else tabs.current.set(shown, button) }}
              type="button" role="tab" id={`${ids}-${shown}`} aria-selected={tab === shown} aria-controls={`${ids}-${shown}-panel`} tabIndex={tab === shown ? 0 : -1}
              onClick={() => setTab(shown)} onKeyDown={event => step(event, at)}
            >
              <span className="hub-tab-name">{label}</span>{counts[shown] !== null && <> <span className="hub-count">{counts[shown]}</span></>}
            </button>
          ))}
        </div>
        <p className="hub-for">Configuring: <span>{name}</span></p>
        <button type="button" className="hub-close" aria-label="Close" onClick={onClose}><Cross /></button>
      </header>
      <main>
        <div className="hub-page">
          <div role="tabpanel" id={`${ids}-skills-panel`} aria-labelledby={`${ids}-skills`} hidden={tab !== 'skills'}><SkillsPanel name={name} switches={switches} /></div>
          <div role="tabpanel" id={`${ids}-plugins-panel`} aria-labelledby={`${ids}-plugins`} hidden={tab !== 'plugins'}><PluginsPanel name={name} plugins={plugins} /></div>
          <div role="tabpanel" id={`${ids}-connectors-panel`} aria-labelledby={`${ids}-connectors`} hidden={tab !== 'connectors'}><ConnectorsPanel apps={apps} servers={servers} view={view} reading={reading} query={query} onQuery={setQuery} /></div>
          <div role="tabpanel" id={`${ids}-tools-panel`} aria-labelledby={`${ids}-tools`} hidden={tab !== 'tools'}><ToolsPanel read={toolsets} /></div>
        </div>
      </main>
    </section>
  )
}
