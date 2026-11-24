import { randomUUID } from 'node:crypto'
import { DONE, refused, SessionActor, type Upload } from './actor'
import { botModels, botPicture, createBot, describeBot, editBot, setBotPicture } from './bot-admin'
import { botsIn, type Bot, type Bots } from './domain/bots'
import type { Command, Outcome, ResultOf } from './domain/command'
import { mentionedBots } from './domain/mention'
import type { OpenChat } from './domain/open'
import type { PaneAsk } from './domain/pane'
import type { BridgeRequest, ServerRequest } from './domain/reduce'
import type { RelayDesk } from './domain/relay'
import type { AttachmentId, BranchId, Link, Session, SessionContent, SessionId, Sidebar } from './domain/session'
import { slashLineOf, type SlashCatalog } from './domain/slash'
import { chatDesk } from './open'
import { relayBook } from './relay'
import { botList } from './roster'
import { deriveSidebar, sessionList } from './sidebar'
import { readVersions } from './versions'
import { connect, systemClock, type Clock, type Dialer } from './wire/link'
import { NOTHING_TO_SHOW, runSessionCommand, type BranchPin, type Hub } from './session-commands'
import { parseCatalog, parseEvent, parseServerRequest, type ParsedEvent } from './wire/parse'

export type { Command, Outcome, Refusal, ResultOf } from './domain/command'
export type { Upload } from './actor'
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
   * Whether this Hermes can hand a message to another bot, asked on every new socket, and the
   * messages handed over from each chat with what came back. A `send` that mentions another listed
   * bot (`@Rae`) goes to that bot's Bot Chat instead of the chat's own bot, and its one reply lands here.
   */
  readonly relay: Feed<RelayDesk>
  /**
   * Watch one session. The listener gets the current value at once and every later one. A session is
   * kept attached while a window watches it, while the gateway lists it as running, while its own
   * run is open, while Hermes waits on a request in it, and while it has unsent messages. It is
   * detached 60 s after none of those hold.
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
  /** Counts for a debug panel: frames and requests not shown, unusable, or with no session to go to, and requests declined. No payloads, no tickets. */
  readonly onDiagnostic?: (what: { readonly kind: 'unshown' | 'invalid' | 'unrouted' | 'declined'; readonly type: string }) => void
  /**
   * What Hermes asked of the pane beside the chat, with the session it asked from. Only the chat the
   * window shows may ask: Hermes never steals focus for a background session. Only a live frame seen
   * for the first time asks. A replay would reopen every page an old chat ever showed.
   */
  readonly onPane?: (ask: PaneAsk, from: Session) => void
  /** Name sent as `client` on `session.create` when the gateway accepts it. */
  readonly client: { readonly name: string; readonly version: string }
  /** Where a message's attachments are read from when it is sent. null: Highwing no longer holds it. Default: holds none. */
  readonly uploads?: { read(id: AttachmentId): Promise<Upload | null> }
}

/** How long a session nothing retains stays attached. */
export const RETAIN_MS = 60_000
const LIST_DEBOUNCE_MS = 300
const NO_BRIDGE = 'Highwing has no part of its window to answer this with.'

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

const ATTACHING: ReadonlySet<Session['sync']['state']> = new Set(['opening', 'catching-up', 'rebuilding'])
const NO_UPLOADS: NonNullable<HermesOptions['uploads']> = { read: async () => null }
const COMMAND_WITH_ATTACHMENTS = "A command can't carry attachments. Remove them, or send a message instead."

export function openHermes(options: HermesOptions): Hermes {
  const clock = options.clock ?? systemClock
  const mintId = options.mintId ?? randomUUID
  const uploads = options.uploads ?? NO_UPLOADS
  const count = (kind: 'unshown' | 'invalid' | 'unrouted' | 'declined', type: string) => options.onDiagnostic?.({ kind, type })

  const actors = new Map<SessionId, SessionActor>()
  const watchers = new Map<SessionId, Set<(session: Session) => void>>()
  const windows = new Map<SessionId, number>()
  const releases = new Map<SessionId, () => void>()
  const branchPins = new Map<BranchId, BranchPin>()
  let cancelRefresh: (() => void) | null = null

  /**
   * A request with no card is refused only while a window shows its chat, so the agent does not
   * wait on a window that cannot answer. Unwatched, it is left open: Hermes reads a refusal as
   * "skipped" for every viewer, and another client may be the one that can answer.
   */
  const bridge = (request: BridgeRequest) => {
    const { sessionId } = request
    if (sessionId === null || !windows.has(sessionId)) return count('unshown', request.method)
    conn.decline(request.requestId, NO_BRIDGE)
    actors.get(sessionId)?.feed({ in: 'declined', request })
    count('declined', request.method)
  }

  const asked = (request: ServerRequest) => {
    switch (request.kind) {
      case 'card': {
        const actor = actors.get(request.sessionId)
        return actor === undefined ? count('unrouted', request.method) : actor.feed({ in: 'request', request, seenAt: clock.now() })
      }
      case 'bridge':
        return bridge(request)
      case 'unusable':
        return count('invalid', request.method)
    }
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
      if (parsed.event === null && parsed.skipped !== 'window') count(parsed.skipped, parsed.type)
      else if (parsed.event?.type === 'meta' && parsed.event.title !== undefined) list.retitle(parsed.sessionId, parsed.event.title)
      const actor = actors.get(parsed.sessionId)
      if (actor === undefined) return count('unrouted', parsed.type)
      const fresh = actor.feed({ in: 'event', frame: { stamp: parsed.stamp, event: parsed.event, seenAt: clock.now() } })
      if ('ask' in parsed && fresh && desk.open.shown?.sessionId === parsed.sessionId) options.onPane?.(parsed.ask, actor.session)
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
      relayRead = relays.probe()
      roster.ask()
    },
    onEvent: params => {
      const parsed = parseEvent(params)
      ;(routes[parsed.scope] as (parsed: ParsedEvent) => void)(parsed)
    },
    onServerRequest: request => asked(parseServerRequest(request))
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

  const relays = relayBook(conn, () => relay.set(relays.desk))
  const relay = feed<RelayDesk>(relays.desk)
  let relayRead: Promise<void> = Promise.resolve()

  const mentioned = (sessionId: SessionId, text: string): readonly Bot[] => {
    const listed = bots.get()
    if (!relay.get().supported || listed.state !== 'listed') return []
    const own = desk.botOf(sessionId)
    return mentionedBots(text, botsIn(listed.roster).filter(bot => bot.id !== own))
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
      conn: bot === undefined ? conn : conn.as(bot), clock, mintId, bridge,
      watched: () => windows.has(id),
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
    return session !== undefined && (session.run.state === 'running' || session.outbox.length > 0 || session.requests.length > 0)
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

  const follow = (id: SessionId, listener: (session: Session) => void): (() => void) => {
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

  const watch: Hermes['watch'] = (id, listener) => {
    const before = windows.get(id) ?? 0
    windows.set(id, before + 1)
    const stop = follow(id, listener)
    if (before === 0) actorFor(id).watchBegan()
    let watching = true
    return () => {
      if (!watching) return
      watching = false
      const left = (windows.get(id) ?? 1) - 1
      if (left === 0) windows.delete(id)
      else windows.set(id, left)
      stop()
    }
  }

  const attached = (id: SessionId): Promise<SessionActor> => new Promise(resolve => {
    const unwatch: { stop?: () => void } = {}
    unwatch.stop = follow(id, session => {
      if (ATTACHING.has(session.sync.state)) return
      queueMicrotask(() => unwatch.stop?.())
      resolve(actorFor(id))
    })
  })

  const hub: Hub = {
    settledCatalog: async () => {
      await catalogRead
      return slash.get()
    },
    retitle: list.retitle,
    drop: list.drop,
    refreshSoon,
    settledRelay: () => relayRead,
    mentioned,
    relay: relays.send,
    branchPins,
    branched: desk.branched,
    uploads
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

  const versions = async (sessionId: SessionId) => {
    const bot = desk.botOf(sessionId)
    const read = await readVersions(bot === undefined ? conn : conn.as(bot), sessionId)
    if (read.ok && bot !== undefined) desk.listed(bot, read.value.flatMap(group => group.versions.map(version => version.sessionId)))
    return read
  }

  const carriesCommand = async (command: Extract<Command, { do: 'send' | 'start' }>): Promise<boolean> => {
    if ((command.attachments ?? []).length === 0 || !command.text.trimStart().startsWith('/')) return false
    await catalogRead
    return slashLineOf(command.text, slash.get()) !== null
  }

  const run = async (command: Command): Promise<Outcome<unknown>> => {
    if (command.do === 'send' || command.do === 'start') {
      if (await carriesCommand(command)) return refused('rejected', COMMAND_WITH_ATTACHMENTS)
      const opened = await typedNew(command)
      if (opened !== null) return opened
    }
    if (command.do === 'open') return desk.ask(command.ref)
    if (command.do === 'start') {
      const started = await desk.start(command.chat)
      return started.ok ? run({ do: 'send', sessionId: started.value, text: command.text, attachments: command.attachments ?? [] }) : started
    }
    if (command.do === 'botModels') return botModels(conn, command.bot)
    if (command.do === 'versions') return versions(command.sessionId)
    if (command.do === 'createBot') {
      const made = await createBot(conn, command.draft)
      // A 5062 may have made the profile, so the roster is read after any attempt.
      roster.ask()
      if (made.ok) await desk.ask({ kind: 'bot', bot: made.value.bot })
      return made
    }
    if (command.do === 'describeBot') return describeBot(conn, command.bot)
    if (command.do === 'botPicture') return botPicture(conn, command.bot)
    if (command.do === 'editBot' || command.do === 'setBotPicture' || command.do === 'removeBotPicture') {
      const done = command.do === 'editBot' ? await editBot(conn, command.bot, command.edit, command.revision)
        : await setBotPicture(conn, command.bot, command.do === 'setBotPicture' ? command.data : null)
      // A refused edit may still have saved some sections, so the roster is read after any attempt.
      roster.ask()
      return done
    }
    if (command.do === 'reconnect') {
      conn.retryNow({ start: command.start })
      for (const actor of [...actors.values()]) actor.attach()
      return DONE
    }
    return runSessionCommand((await attached(command.sessionId)).port, command, hub)
  }

  return {
    link,
    sidebar,
    slash,
    bots,
    open,
    relay,
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
