import {
  APPROVAL_WORDS, BOT_TEMPLATES, botsIn, CONNECTOR_FILTERS, connectorsView, pluginsView, scheduleWords, shownBot, shownChat, STANDING_WORDS, TOOLSET_WORDS, type BotCreated, type BotTemplate, type TemplateAnswers, type CatalogPlugin, type CommandOutcome, type AppEntry, type AppsBoard, type BotId, type Bots, type ConnectorFilter, type ConnectorShelf, type ConnectorsQuery, type ConnectorsView, type ServerSetup, type SessionId, type Toolset, type ToolServer
} from '@highwing/hermes/domain'
import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { nameProblem } from '../bots/bot-form'
import { pictureOf } from '../bots/look'
import { FaceArt } from '../bots/LookPicker'
import { useImage } from '../chat/Image'
import { connectorsKeys } from '../keys'
import { line } from '../setup/ConnectionCard'
import { run, useTopic } from '../store'
import { useSwitches } from '../switches'
import { TABS, tabAfterKey, type Tab } from './connectors-tabs'
import { afterInstall, askWords, catalogKind, installedKind, AVAILABLE_PAGE } from './plugins-view'
import { TemplateDialog } from './Templates'
import { ToolServerForm, useToolServers } from './ToolServers'
import { namedTools, STATES, toolCount } from './tool-servers-view'

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

type Installing = { readonly name: string; readonly at: 'confirming' | 'installing' } | null

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
  const [catalog, setCatalog] = useState<Listed<CatalogPlugin>>({ at: 'reading' })
  const [installing, setInstalling] = useState<Installing>(null)
  const [said, setSaid] = useState<{ readonly ok: boolean; readonly words: string } | null>(null)
  const openRef = useRef(true)

  useEffect(() => {
    openRef.current = true
    return () => { openRef.current = false }
  }, [])

  const readCatalog = () => {
    setCatalog({ at: 'reading' })
    void run({ do: 'pluginCatalog' }).then(outcome => {
      if (openRef.current) setCatalog(outcome.ok ? { at: 'read', items: outcome.value } : { at: 'refused', words: outcome.refusal.message })
    })
  }
  useEffect(readCatalog, [])

  const ask = (name: string) => {
    if (installing?.at === 'installing') return
    setInstalling({ name, at: 'confirming' })
    setSaid(null)
  }

  const install = async (name: string) => {
    setInstalling({ name, at: 'installing' })
    const outcome = await run({ do: 'installPlugin', bot, name })
    if (!openRef.current) return
    // Hermes places a plugin before it turns it on, so an install refused at that step still leaves it installed, off.
    const next = await run({ do: 'plugins', bot })
    if (!openRef.current) return
    if (next.ok) setRead(next.value)
    setInstalling(null)
    setSaid(afterInstall(outcome, next))
  }

  return { read, restart, ...switches, catalog, installing, said, readCatalog, ask, cancel: () => setInstalling(null), install }
}

interface CardProps {
  readonly name: string
  readonly kind?: string
  readonly logo?: string | null
  readonly detail: string
  readonly mono?: boolean
  readonly toolNames?: string
  readonly lines?: readonly ReactNode[]
  readonly tile?: ReactNode
  readonly state?: { readonly standing: string; readonly words: string }
  readonly later?: boolean
  readonly below?: ReactNode
  readonly children?: ReactNode
}

function Card({ name, kind, logo = null, tile, detail, mono = false, toolNames = '', lines = [], state, later = false, below, children }: CardProps) {
  const [broken, setBroken] = useState<string | null>(null)
  return (
    <li className="hub-card">
      <span className="hub-tile" aria-hidden="true">
        {tile ?? (logo !== null && broken !== logo ? <img alt="" src={logo} onError={() => setBroken(logo)} /> : name.slice(0, 1).toUpperCase())}
      </span>
      <div className="hub-copy">
        <p className="hub-name">{name}{kind !== undefined && <span className="hub-kind">{kind}</span>}</p>
        {detail !== '' && <p className="hub-detail" data-mono={mono || undefined} data-wrap={lines.length > 0 || undefined} title={detail}>{detail}</p>}
        {toolNames !== '' && <p className="hub-detail" data-mono title={toolNames}>{toolNames}</p>}
        {later && <p className="hub-later">Takes effect when Hermes restarts.</p>}
        {lines.map((words, at) => <p key={at} className="hub-detail" data-wrap>{words}</p>)}
        {below}
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

const nameOf = (bot: BotId | null, bots: Bots | undefined): string =>
  (bot !== null && bots?.state === 'listed' ? botsIn(bots.roster).find(listed => listed.id === bot)?.name : undefined) ?? 'This bot'

function useSkillSwitches() {
  const library = useTopic('skills')
  const bot = library?.bot ?? null
  const switches = useSwitches(bot, library?.state === 'listed' ? library.skills : null, skill => skill.name, (skill, enabled) => run({ do: 'setSkill', bot, name: skill.name, enabled }))
  return { library, ...switches }
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

function useShownOnce(at: { readonly current: Element | null }, watching: boolean): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!watching || at.current === null) return
    const watch = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      setShown(true)
      watch.disconnect()
    })
    watch.observe(at.current)
    return () => watch.disconnect()
  }, [watching])
  return shown
}

export function PluginTile({ name, image }: { readonly name: string; readonly image: string | null }) {
  const at = useRef<HTMLSpanElement>(null)
  const shown = useShownOnce(at, image !== null)
  const [broken, setBroken] = useState<string | null>(null)
  const art = useImage(shown && image !== null ? { kind: 'web', url: image } : null)
  const letter = name.slice(0, 1).toUpperCase()
  if (image === null) return letter
  return (
    <span ref={at} className="hub-art">
      {!shown || art.s === 'loading' ? null : art.s === 'ready' && broken !== art.url ? <img alt="" src={art.url} onError={() => setBroken(art.url)} /> : letter}
    </span>
  )
}

interface OfferProps {
  readonly plugin: CatalogPlugin
  readonly installing: Installing
  readonly onAsk: () => void
  readonly onInstall: () => void
  readonly onCancel: () => void
}

export function OfferCard({ plugin, installing, onAsk, onInstall, onCancel }: OfferProps) {
  const mine = installing?.name === plugin.name ? installing.at : null
  const below = mine === 'confirming' && (
    <>
      {plugin.repo !== '' && <p className="hub-detail" data-mono title={plugin.repo}>{plugin.repo}</p>}
      <p className="hub-ask">{askWords(plugin)}</p>
    </>
  )
  return (
    <Card
      name={plugin.name} kind={catalogKind(plugin)} tile={<PluginTile name={plugin.name} image={plugin.image} />} detail={plugin.description} below={below}
      {...(mine === 'installing' ? { state: { standing: 'connecting', words: 'Installing…' } } : {})}
    >
      <div className="hub-actions">
        {mine === 'confirming' && <button type="button" aria-label={`Cancel installing ${plugin.name}`} onClick={onCancel}>Cancel</button>}
        {mine === 'confirming' && <button type="button" aria-label={`Install ${plugin.name}`} onClick={onInstall}>Install</button>}
        {mine === null && <button type="button" aria-label={`Install ${plugin.name}`} disabled={installing?.at === 'installing'} onClick={onAsk}>Install</button>}
      </div>
    </Card>
  )
}

function PluginsPanel({ name, plugins }: { readonly name: string; readonly plugins: ReturnType<typeof usePlugins> }) {
  const { read: installed, restart, problem, of, catalog, installing, said } = plugins
  const [query, setQuery] = useState<ConnectorsQuery>({ text: '', filter: 'all' })
  const [limit, setLimit] = useState(AVAILABLE_PAGE)
  const items = installed.at === 'read' ? installed.items : null
  const offered = catalog.at === 'read' ? catalog.items : null
  const view = useMemo(() => (items === null ? null : pluginsView(items, offered ?? [], query)), [items, offered, query])
  const art = useMemo(() => new Map((offered ?? []).map(plugin => [plugin.name, plugin.image])), [offered])
  const onQuery = (next: ConnectorsQuery) => {
    setQuery(next)
    setLimit(AVAILABLE_PAGE)
  }
  const { text, filter } = query

  return (
    <>
      {installed.at === 'reading' && <p className="hub-note" role="status">Asking Hermes…</p>}
      {installed.at === 'refused' && <p className="hub-note" role="alert">{installed.words}</p>}
      {view !== null && (
        <>
          <div className="hub-search">
            <Search />
            <input
              type="search" aria-label="Search plugins" placeholder={`Search ${view.total} ${view.total === 1 ? 'plugin' : 'plugins'}`}
              spellCheck={false} autoComplete="off" value={text} onChange={event => onQuery({ text: event.target.value, filter })}
            />
          </div>
          <p className="tool-said" role="status">{said?.ok === true ? said.words : ''}</p>
          {said?.ok === false && <p className="tool-problem" role="alert">{said.words}</p>}
          {catalog.at === 'reading' && <p className="hub-note" role="status">{"Loading Hermes's plugin catalog…"}</p>}
          {catalog.at === 'refused' && (
            <div className="hub-note">
              <p role="alert">{catalog.words}</p>
              <button type="button" onClick={plugins.readCatalog}>Try again</button>
            </div>
          )}
          <div className="hub-chips" role="group" aria-label="Show">
            {CONNECTOR_FILTERS.map(shown => (
              <button key={shown} type="button" aria-pressed={filter === shown} onClick={() => onQuery({ text, filter: shown })}>
                {FILTER_WORDS[shown]} <span className="hub-count">{view.counts[shown]}</span>
              </button>
            ))}
          </div>
          {view.added.length > 0 && (
            <section aria-label={SHELF_WORDS.added}>
              <h3 className="hub-heading">{SHELF_WORDS.added} <span className="hub-count">{view.added.length}</span></h3>
              <ul className="hub-grid" data-art>
                {view.added.map(plugin => (
                  <Card
                    key={plugin.key} name={plugin.name} kind={installedKind(plugin)} tile={<PluginTile name={plugin.name} image={art.get(plugin.catalogName ?? plugin.name) ?? null} />}
                    detail={plugin.description} later={restart.has(plugin.key)}
                  >
                    <input type="checkbox" role="switch" className="hub-switch" aria-label={`Use ${plugin.name}`} {...of(plugin)} />
                  </Card>
                ))}
              </ul>
            </section>
          )}
          {view.available.length > 0 && (
            <section aria-label={SHELF_WORDS.available}>
              <h3 className="hub-heading">{SHELF_WORDS.available} <span className="hub-count">{view.available.length}</span></h3>
              <ul className="hub-grid" data-art>
                {view.available.slice(0, limit).map(plugin => (
                  <OfferCard
                    key={plugin.name} plugin={plugin} installing={installing}
                    onAsk={() => plugins.ask(plugin.name)} onInstall={() => void plugins.install(plugin.name)} onCancel={plugins.cancel}
                  />
                ))}
              </ul>
              {view.available.length > limit && <div className="hub-note"><button type="button" onClick={() => setLimit(limit + AVAILABLE_PAGE)}>Show more</button></div>}
            </section>
          )}
          {view.total > 0 && view.counts.all === 0 && <p className="hub-note">No plugins match.</p>}
          {view.total === 0 && catalog.at !== 'reading' && <p className="hub-note">{name} has no plugins.</p>}
        </>
      )}
      {problem !== null && <p className="hub-note" role="alert">{problem}</p>}
    </>
  )
}

type ToolsetsState = { readonly at: 'reading' } | { readonly at: 'read'; readonly for: BotId | null; readonly toolsets: readonly Toolset[]; readonly locked: string | null } | { readonly at: 'refused'; readonly words: string }

function useToolsets(bot: BotId | null, sessionId: SessionId | null) {
  const [read, setRead] = useState<ToolsetsState>({ at: 'reading' })
  useEffect(() => {
    let stopped = false
    setRead({ at: 'reading' })
    void run({ do: 'tools', bot, sessionId }).then(outcome => {
      if (!stopped) setRead(outcome.ok ? { at: 'read', for: bot, ...outcome.value } : { at: 'refused', words: outcome.refusal.message })
    })
    return () => { stopped = true }
  }, [bot, sessionId])
  const switches = useSwitches(bot, read.at === 'read' && read.locked === null ? read.toolsets : null, toolset => toolset.name, async (toolset, enabled) => {
    const done = await run({ do: 'setToolset', bot, name: toolset.name, enabled })
    if (done.ok) {
      const { name, enabled: now } = done.value
      setRead(held => (held.at === 'read' && held.for === bot ? { ...held, toolsets: held.toolsets.map(row => (row.name === name ? { ...row, enabled: now } : row)) } : held))
    }
    return done
  })
  return { read, ...switches }
}

interface ToolsetListProps {
  readonly name: string
  readonly toolsets: readonly Toolset[]
  readonly locked: string | null
  readonly of: (toolset: Toolset) => { readonly checked: boolean; readonly disabled: boolean; readonly onChange: () => void }
}

export function ToolsetList({ name, toolsets, locked, of }: ToolsetListProps) {
  return (
    <>
      {locked === null ? <p className="hub-lead">{`Changes reach each of ${name}'s chats from its next message. Group chats keep the tools they started with.`}</p> : <p className="hub-note">{locked}</p>}
      {toolsets.length === 0 && <p className="hub-note">Hermes has no toolsets.</p>}
      {toolsets.length > 0 && (
        <ul className="hub-grid">
          {toolsets.map(toolset => locked === null ? (
            <Card key={toolset.name} name={toolset.label} {...(toolset.place === null ? {} : { kind: toolset.place })} detail={toolset.description}>
              <input type="checkbox" role="switch" className="hub-switch" aria-label={`Use ${toolset.label}`} {...of(toolset)} />
            </Card>
          ) : (
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

function ToolsPanel({ name, tools: { read, problem, of } }: { readonly name: string; readonly tools: ReturnType<typeof useToolsets> }) {
  return (
    <>
      {read.at === 'reading' && <p className="hub-note" role="status">Asking Hermes…</p>}
      {read.at === 'refused' && <p className="hub-note" role="alert">{read.words}</p>}
      {read.at === 'read' && <ToolsetList name={name} toolsets={read.toolsets} locked={read.locked} of={of} />}
      {problem !== null && <p className="hub-note" role="alert">{problem}</p>}
    </>
  )
}

const UNDRAWN: CommandOutcome<BotCreated> = { ok: false, refusal: { kind: 'rejected', message: "Highwing couldn't draw this template's picture." } }

const turnsOn = (template: BotTemplate) => (
  <>Turns on: {template.toolsets.map((toolset, at) => <Fragment key={toolset}>{at > 0 && ', '}<span className="hub-whole">{TOOLSET_WORDS[toolset]}</span></Fragment>)}</>
)

function TemplatesPanel() {
  const [chosen, setChosen] = useState<BotTemplate | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const bots = useTopic('bots')
  const create = async (template: BotTemplate, answers: TemplateAnswers) => {
    const picture = await pictureOf({ from: 'face', ...template.face }, answers.name).catch(() => null)
    return picture === null ? UNDRAWN : run({ do: 'createFromTemplate', template: template.id, answers, picture })
  }
  const close = () => {
    setChosen(null)
    opener.current?.focus()
  }
  return (
    <>
      <p className="hub-lead">Start a new bot from a template.</p>
      <ul className="hub-grid">
        {BOT_TEMPLATES.map(template => (
          <Card
            key={template.id} name={template.name} kind="Template" detail={template.summary} tile={<FaceArt {...template.face} size={30} />}
            lines={[turnsOn(template), `Approval: ${APPROVAL_WORDS[template.approval].name}`, ...(template.schedule === null ? [] : [scheduleWords(template.schedule.defaultTime)])]}
          >
            <div className="hub-actions">
              <button type="button" aria-label={`Use template ${template.name}`} onClick={event => { opener.current = event.currentTarget; setChosen(template) }}>Use template</button>
            </div>
          </Card>
        ))}
      </ul>
      {chosen !== null && (
        <TemplateDialog key={chosen.id} template={chosen} problemOf={name => nameProblem(name, bots)} onCreate={answers => create(chosen, answers)} onOpen={bot => run({ do: 'open', ref: { kind: 'bot', bot } })} onClose={close} />
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
  const toolsets = useToolsets(bot, sessionId)
  const apps = useApps(bot)
  const servers = useToolServers(bot)
  const [query, setQuery] = useState<ConnectorsQuery>({ text: '', filter: 'all' })
  const view = connectorsView(apps.board, servers.read.at === 'read' ? servers.read.servers : [], query)
  const reading = (apps.board === null && apps.problem === null) || servers.read.at === 'reading'
  const counts: { readonly [T in Tab]: number | null } = {
    skills: switches.library?.state === 'listed' ? switches.library.skills.length : null,
    plugins: plugins.read.at === 'read' ? plugins.read.items.length : null,
    connectors: reading ? null : view.total,
    tools: toolsets.read.at === 'read' ? toolsets.read.toolsets.length : null,
    templates: BOT_TEMPLATES.length
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
    const next = tabAfterKey(at, event.key)
    if (next === null) return
    event.preventDefault()
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
        {tab !== 'templates' && <p className="hub-for">Configuring: <span>{name}</span></p>}
        <button type="button" className="hub-close" aria-label="Close" onClick={onClose}><Cross /></button>
      </header>
      <main>
        <div className="hub-page">
          <div role="tabpanel" id={`${ids}-skills-panel`} aria-labelledby={`${ids}-skills`} hidden={tab !== 'skills'}><SkillsPanel name={name} switches={switches} /></div>
          <div role="tabpanel" id={`${ids}-plugins-panel`} aria-labelledby={`${ids}-plugins`} hidden={tab !== 'plugins'}><PluginsPanel name={name} plugins={plugins} /></div>
          <div role="tabpanel" id={`${ids}-connectors-panel`} aria-labelledby={`${ids}-connectors`} hidden={tab !== 'connectors'}><ConnectorsPanel apps={apps} servers={servers} view={view} reading={reading} query={query} onQuery={setQuery} /></div>
          <div role="tabpanel" id={`${ids}-tools-panel`} aria-labelledby={`${ids}-tools`} hidden={tab !== 'tools'}><ToolsPanel name={name} tools={toolsets} /></div>
          <div role="tabpanel" id={`${ids}-templates-panel`} aria-labelledby={`${ids}-templates`} hidden={tab !== 'templates'}><TemplatesPanel /></div>
        </div>
      </main>
    </section>
  )
}
