import { randomUUID } from 'node:crypto'
import { DONE, refusalOf, refused, SessionActor } from './actor'
import { botModels, createBot } from './bot-admin'
import type { Bots } from './domain/bots'
import type { Command, Outcome, ResultOf } from './domain/command'
import type { OpenChat } from './domain/open'
import type { ServerRequest } from './domain/reduce'
import type { Link, Session, SessionContent, SessionId, Sidebar } from './domain/session'
import { slashLineOf, type SlashCatalog, type SlashLine } from './domain/slash'
import { chatDesk } from './open'
import { botList } from './roster'
import { deriveSidebar, sessionList } from './sidebar'
import { connect, systemClock, type Clock, type Dialer } from './wire/link'
import { parseCatalog, parseDirective, parseEvent, parseServerRequest, type ParsedEvent } from './wire/parse'

export type { Command, Outcome, Refusal, ResultOf } from './domain/command'
export type { Clock, Dialer, WireSocket } from './wire/link'
export { checkTarget, type CheckOptions, type CheckResult } from './wire/check'
export { DialError } from './wire/link'
export { remoteRoute, type Route } from './wire/remote'
export { liveDialer } from './wire/tickets'

/** A value that changes. `subscribe` calls back on every change, not for the current value. */
export interface Feed<T> {
  get(): T
  subscribe(listener: (value: T) => void): () => void
}

export interface Hermes {
  readonly link: Feed<Link>
  /** The chats of the open chat's bot, or of the socket's own profile when the open chat has no bot. It follows the open chat to another bot. */
  readonly sidebar: Feed<Sidebar>
  /** The commands and skills a `/` line can run, read once per connection. Empty when Hermes has no catalog or refused it. */
  readonly slash: Feed<SlashCatalog>
  /**
   * The bots of this Hermes, read on every new socket and again when sessions change. `unsupported`
   * on a Hermes with no `profiles.list`. A listed roster stays while the link is down.
   */
  readonly bots: Feed<Bots>
  /**
   * Which chat the window shows. Before any click it is the default bot's chat, or the newest chat
   * on a Hermes that cannot switch bots. After that only `run({ do: 'open' })` (a bot, a new chat or
   * a chat from the sidebar), `run({ do: 'start' })` and a `/new` move it, and a bot's Bot Chat
   * follows the bot to the Bot Chat Hermes names for it.
   */
  readonly open: Feed<OpenChat>
  /**
   * Watch one session. The listener gets the current value at once and every later one. A session is
   * kept attached while a window watches it, while the gateway lists it as running, while its own
   * run is open, and while it has unsent messages. It is detached 60 s after none of those hold.
   * Call the returned function to stop watching.
   */
  watch(id: SessionId, listener: (session: Session) => void): () => void
  /** Never rejects for an expected failure: that is a `Refusal`. Most outcomes also show up in the feeds. */
  run<C extends Command>(command: C): Promise<Outcome<ResultOf<C>>>
  close(): Promise<void>
}

export interface HermesOptions {
  /** `liveDialer()` for the real gateway, `scriptedDialer(fixture)` for a recorded one. */
  readonly dial: Dialer
  /** Whether the first dial after launch may start the gateway. Automatic retries never do. Default true. */
  readonly startGatewayOnLaunch?: boolean
  readonly clock?: Clock
  /** Mints the idempotency keys of messages and mutations. Default `randomUUID`. A fixture replay passes the recorded ones. */
  readonly mintId?: () => string
  /** Counts for a debug panel: frames not shown, unusable, or with no session to go to, and requests declined. No payloads, no tickets. */
  readonly onDiagnostic?: (what: { readonly kind: 'unshown' | 'invalid' | 'unrouted' | 'declined'; readonly type: string }) => void
  /** Name sent as `client` on `session.create` when the gateway accepts it. */
  readonly client: { readonly name: string; readonly version: string }
}

/** How long a session nothing retains stays attached. */
export const RETAIN_MS = 60_000
const LIST_DEBOUNCE_MS = 300
const CANT_SHOW = "Highwing can't show this prompt yet, so it said no."

type SessionCommand = Extract<Command, { readonly sessionId: SessionId }>

function feed<T>(initial: T, same: (a: T, b: T) => boolean = Object.is): Feed<T> & { set(next: T): void } {
  let value = initial
  const listeners = new Set<(value: T) => void>()
  return {
    get: () => value,
    subscribe: listener => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    set: next => {
      if (same(value, next)) return
      value = next
      for (const listener of [...listeners]) listener(next)
    }
  }
}

function sameSidebar(a: Sidebar, b: Sidebar): boolean {
  return a.bot === b.bot && a.status === b.status && a.rows.length === b.rows.length && a.rows.every((row, index) => {
    const other = b.rows[index]
    return other !== undefined && row.id === other.id && row.title === other.title && row.preview === other.preview
      && row.lastActiveAt === other.lastActiveAt && row.badge === other.badge
  })
}

const sameOpen = (a: OpenChat, b: OpenChat) => JSON.stringify(a) === JSON.stringify(b)

const sameCatalog = (a: SlashCatalog, b: SlashCatalog) =>
  a.length === b.length && a.every((entry, index) => {
    const other = b[index]
    return other !== undefined && entry.kind === other.kind && entry.name === other.name && entry.description === other.description
  })

/** Hermes discovers plugin commands and skills for the catalog, so a slow disk can stall it. */
const CATALOG_TIMEOUT_MS = 10_000
const NOTHING_TO_SHOW: Outcome<string | null> = { ok: true, value: null }
const showing = (outcome: Outcome, words: string | null = null): Outcome<string | null> => (outcome.ok ? { ok: true, value: words } : outcome)

const ATTACHING: ReadonlySet<Session['sync']['state']> = new Set(['opening', 'catching-up', 'rebuilding'])

export function openHermes(options: HermesOptions): Hermes {
  const clock = options.clock ?? systemClock
  const mintId = options.mintId ?? randomUUID
  const count = (kind: 'unshown' | 'invalid' | 'unrouted' | 'declined', type: string) => options.onDiagnostic?.({ kind, type })

  const actors = new Map<SessionId, SessionActor>()
  const watchers = new Map<SessionId, Set<(session: Session) => void>>()
  const releases = new Map<SessionId, () => void>()
  let cancelRefresh: (() => void) | null = null

  const refuse = (request: ServerRequest) => {
    conn.decline(request.requestId, CANT_SHOW)
    if (request.sessionId !== null) actors.get(request.sessionId)?.feed({ in: 'declined', request })
    count('declined', request.method)
  }

  const refreshSoon = () => {
    cancelRefresh?.()
    cancelRefresh = clock.setTimeout(() => {
      cancelRefresh = null
      list.refresh()
      roster.refresh()
    }, LIST_DEBOUNCE_MS)
  }

  const routes: { readonly [S in ParsedEvent['scope']]: (parsed: Extract<ParsedEvent, { scope: S }>) => void } = {
    session: parsed => {
      if (parsed.event === null) count(parsed.skipped, parsed.type)
      else if (parsed.event.type === 'meta' && parsed.event.title !== undefined) list.retitle(parsed.sessionId, parsed.event.title)
      const actor = actors.get(parsed.sessionId)
      if (actor === undefined) return count('unrouted', parsed.type)
      actor.feed({ in: 'event', frame: { stamp: parsed.stamp, event: parsed.event, seenAt: clock.now() } })
    },
    gap: parsed => actors.get(parsed.sessionId)?.feed({ in: 'gap' }),
    app: refreshSoon,
    unrouted: parsed => count('unrouted', parsed.type)
  }

  const conn = connect(options.dial, {
    onLink: next => {
      link.set(next)
      for (const actor of [...actors.values()]) actor.linkChanged()
      if (next.state !== 'online') list.stale()
      roster.linked(next.state)
    },
    onOnline: () => {
      list.refresh()
      catalogRead = readCatalog()
      roster.ask()
    },
    onEvent: params => {
      const parsed = parseEvent(params)
      ;(routes[parsed.scope] as (parsed: ParsedEvent) => void)(parsed)
    },
    onServerRequest: request => refuse(parseServerRequest(request))
  }, { startOnLaunch: options.startGatewayOnLaunch ?? true, clock })

  const link = feed<Link>(conn.link)
  const slash = feed<SlashCatalog>([], sameCatalog)
  let catalogReads = 0
  let catalogRead: Promise<void> = Promise.resolve()

  const readCatalog = async () => {
    const read = ++catalogReads
    const catalog = await conn.call('commands.catalog', {}, CATALOG_TIMEOUT_MS).then(parseCatalog).catch(() => [])
    if (read === catalogReads) slash.set(catalog)
  }

  const publishSidebar = () => {
    const settled = new Map<SessionId, SessionContent>()
    for (const [id, actor] of actors) if (actor.session.sync.state !== 'opening') settled.set(id, actor.session)
    sidebar.set(deriveSidebar(list, settled))
  }

  const desk = chatDesk({
    conn, client: options.client, mintId,
    changed: () => {
      open.set(desk.open)
      list.follow(desk.open.shown?.bot ?? null)
    }
  })
  const open = feed<OpenChat>(desk.open, sameOpen)
  const settle = () => desk.settle({ bots: roster.bots, named: roster.chats, list: { status: list.status, newest: list.rows[0]?.id ?? null } })

  const list = sessionList(conn, desk.listed, () => {
    publishSidebar()
    retain()
    settle()
  })
  const sidebar = feed<Sidebar>(deriveSidebar(list, new Map()), sameSidebar)

  const roster = botList(conn, () => {
    bots.set(roster.bots)
    settle()
  })
  const bots = feed<Bots>(roster.bots)

  const actorFor = (id: SessionId): SessionActor => {
    const held = actors.get(id)
    if (held !== undefined) return held
    const bot = desk.botOf(id)
    const actor = new SessionActor(id, {
      conn: bot === undefined ? conn : conn.as(bot), clock, mintId, refuse,
      publish: (session, previous) => {
        for (const listener of [...(watchers.get(id) ?? [])]) listener(session)
        if (session.run.state !== previous.run.state) refreshSoon()
        publishSidebar()
        retain()
      }
    })
    actors.set(id, actor)
    actor.attach()
    return actor
  }

  const wanted = (id: SessionId): boolean => {
    if (watchers.has(id) || list.running.has(id)) return true
    const session = actors.get(id)?.session
    return session !== undefined && (session.run.state === 'running' || session.outbox.length > 0)
  }

  const retain = () => {
    for (const id of [...watchers.keys(), ...list.running]) actorFor(id)
    for (const id of [...actors.keys()]) {
      if (wanted(id)) {
        releases.get(id)?.()
        releases.delete(id)
      } else if (!releases.has(id)) {
        releases.set(id, clock.setTimeout(() => {
          releases.delete(id)
          const actor = actors.get(id)
          if (actor === undefined || wanted(id)) return
          actors.delete(id)
          void actor.detach()
          publishSidebar()
        }, RETAIN_MS))
      }
    }
  }

  const watch: Hermes['watch'] = (id, listener) => {
    const actor = actorFor(id)
    const listeners = watchers.get(id) ?? new Set()
    watchers.set(id, listeners.add(listener))
    retain()
    listener(actor.session)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0 && watchers.get(id) === listeners) watchers.delete(id)
      retain()
    }
  }

  const attached = (id: SessionId): Promise<SessionActor> => new Promise(resolve => {
    const unwatch: { stop?: () => void } = {}
    unwatch.stop = watch(id, session => {
      if (ATTACHING.has(session.sync.state)) return
      queueMicrotask(() => unwatch.stop?.())
      resolve(actorFor(id))
    })
  })

  type Handled<C extends Command> = Outcome<ResultOf<C>> | Promise<Outcome<ResultOf<C>>>
  const sessionCommands: { readonly [K in SessionCommand['do']]: (actor: SessionActor, command: Extract<Command, { do: K }>) => Handled<Extract<Command, { do: K }>> } = {
    send: async (actor, { text }) => {
      if (text.trimStart().startsWith('/')) await catalogRead
      const line = slashLineOf(text, slash.get())
      return line === null ? showing(await actor.send(text)) : runSlash(actor, line)
    },
    rewind: (actor, { rowId, text }) => actor.rewind(rowId, text),
    stop: actor => actor.stop(),
    answer: (actor, { promptId, reply }) => actor.answer(promptId, reply),
    discard: (actor, { inputId }) => actor.discard(inputId),
    loadEarlier: actor => actor.loadEarlier(),
    models: actor => actor.models(),
    pickModel: (actor, { model, confirm }) => actor.pickModel(model, confirm ?? null),
    contextBreakdown: actor => actor.contextBreakdown(),
    setYolo: (actor, { on }) => actor.setYolo(on),
    rename: async (actor, { title }) => {
      const outcome = await actor.mutate({ title })
      if (outcome.ok) list.retitle(actor.id, title)
      return outcome
    },
    archive: async (actor, { archived }) => {
      const outcome = await actor.mutate({ archived })
      if (outcome.ok && archived) list.drop(actor.id)
      if (outcome.ok) refreshSoon()
      return outcome
    }
  }

  const highwingRuns: { readonly [name: string]: (actor: SessionActor, arg: string) => Outcome | Promise<Outcome> | null } = {
    title: (actor, title) => (title === '' ? null : sessionCommands.rename(actor, { do: 'rename', sessionId: actor.id, title }))
  }

  const runSlash = async (actor: SessionActor, { entry, arg }: SlashLine): Promise<Outcome<string | null>> => {
    const own = entry.kind === 'command' && Object.hasOwn(highwingRuns, entry.name) ? highwingRuns[entry.name]?.(actor, arg) : null
    if (own != null) return showing(await own)
    const typed = `/${entry.name}${arg === '' ? '' : ` ${arg}`}`
    let reply
    try {
      reply = await actor.dispatch(entry.name, arg)
    } catch (error) {
      return { ok: false, refusal: refusalOf(error) }
    }
    const directive = parseDirective(reply, typed)
    if (directive === null) return refused('unsupported', "Highwing can't carry out what Hermes answered to that command.")
    if (directive.do === 'show') return directive.text === '' ? NOTHING_TO_SHOW : { ok: true, value: directive.text }
    return showing(await actor.send(directive.text, directive.apiText), directive.note)
  }

  /** Hermes's `command_verdict` refuses `/new` (gateway/session_commands.py:133-145), so Highwing runs a bare one: a new chat in the bot of the chat it was typed in. */
  const typedNew = async (command: Extract<Command, { do: 'send' | 'start' }>): Promise<Outcome<string | null> | null> => {
    if (!command.text.trimStart().startsWith('/')) return null
    await catalogRead
    const line = slashLineOf(command.text, slash.get())
    if (line === null || line.entry.kind !== 'command' || line.entry.name !== 'new' || line.arg !== '') return null
    const bot = command.do === 'send' ? desk.botOf(command.sessionId) ?? null : command.chat.bot
    const opened = await desk.ask({ kind: 'new', bot, draftId: mintId() })
    return opened.ok ? NOTHING_TO_SHOW : opened
  }

  const run = async (command: Command): Promise<Outcome<unknown>> => {
    if (command.do === 'send' || command.do === 'start') {
      const opened = await typedNew(command)
      if (opened !== null) return opened
    }
    if (command.do === 'open') return desk.ask(command.ref)
    if (command.do === 'start') {
      const started = await desk.start(command.chat)
      return started.ok ? run({ do: 'send', sessionId: started.value, text: command.text }) : started
    }
    if (command.do === 'botModels') return botModels(conn, command.bot)
    if (command.do === 'createBot') {
      const made = await createBot(conn, command.draft)
      // A 5062 may have made the profile, so the roster is read after any attempt.
      roster.ask()
      if (made.ok) await desk.ask({ kind: 'bot', bot: made.value.bot })
      return made
    }
    if (command.do === 'reconnect') {
      conn.retryNow({ start: command.start })
      for (const actor of [...actors.values()]) actor.attach()
      return DONE
    }
    const handle = sessionCommands[command.do] as (actor: SessionActor, command: SessionCommand) => Handled<SessionCommand>
    return handle(await attached(command.sessionId), command)
  }

  return {
    link,
    sidebar,
    slash,
    bots,
    open,
    watch,
    run: command => run(command) as Promise<Outcome<ResultOf<typeof command>>>,
    close: async () => {
      cancelRefresh?.()
      for (const cancel of releases.values()) cancel()
      releases.clear()
      conn.close()
    }
  }
}
