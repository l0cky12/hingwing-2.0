import { randomUUID } from 'node:crypto'
import { DONE, refused, SessionActor, type Upload } from './actor'
import { activityDesk, busyOf, type Attached } from './activity'
import { appSignIn, connectApp, listApps, removeApp } from './apps'
import {
  addToolServer, botModels, botModelSettings, botPicture, canGeneratePicture, createBot, denyRules, describeBot, editBot, generatePicture, listPets, markBot, passwordManagers, petPicture, readSkills, removeToolServer, setBotBackup, setBotModel,
  installPlugin, listPlugins, listToolsets, setBotPicture, setPlugin, setSkill, setToolset, skillText, toolServers
} from './bot-admin'
import type { BotActivities, UnreadChat } from './domain/activity'
import { listMemory, removeMemory, saveMemory } from './memory'
import { BOT_TEMPLATES, templatePlan } from './domain/bot-templates'
import { botsIn, MARK_SETS, type Bot, type Bots } from './domain/bots'
import type { Command, Outcome, ResultOf } from './domain/command'
import type { GroupChat, Groups } from './domain/groups'
import type { Job } from './domain/jobs'
import { mentionedBots } from './domain/mention'
import { quoteOf } from './domain/quote'
import { shownBot, shownChat, shownGroup, type OpenChat } from './domain/open'
import type { PaneAsk } from './domain/pane'
import type { BridgeRequest, ServerRequest } from './domain/reduce'
import type { RelayDesk } from './domain/relay'
import type { ScreenView } from './domain/screen'
import type { SkillLibrary } from './domain/skills'
import { hermesVersionOf, type About } from './domain/about'
import type { AttachmentId, BranchId, Link, Session, SessionContent, SessionId, Sidebar } from './domain/session'
import { slashLineOf, type SlashCatalog } from './domain/slash'
import { groupBook } from './groups'
import { jobList } from './jobs'
import { readMessages, type Place } from './messages'
import { chatDesk } from './open'
import { relayBook } from './relay'
import { botList } from './roster'
import { createFromTemplate } from './template-bot'
import { screenDesk } from './screens'
import { controlRoutine, listRoutines } from './routines'
import { deriveSidebar, sessionList } from './sidebar'
import { readVersions } from './versions'
import { connect, systemClock, type AskHermes, type Clock, type Dialer } from './wire/link'
import { NOTHING_TO_SHOW, runSessionCommand, type BranchPin, type Hub } from './session-commands'
import { parseCatalog, parseEvent, parseServerRequest, type ParsedEvent } from './wire/parse'

export type { Command, Outcome, Refusal, ResultOf } from './domain/command'
export type { Upload } from './actor'
export type { Clock, Dialer, AskHermes, HttpAnswer, HttpAsk, WireSocket } from './wire/link'
export { checkTarget, type CheckOptions, type CheckResult } from './wire/check'
export { gatewaysByUrl, memoryKeep, type GatewayDeps, type Gateways, type Keep, type UrlCheckResult } from './wire/gateways'
export { DialError } from './wire/link'
export { pickedRoute, timeWay, type Picked, type PickedRoute, type Way } from './wire/pick'
export { remoteRoute, type Route } from './wire/remote'
export { sshRead, type RemoteRead } from './wire/ssh'
export { liveRoute } from './wire/tickets'
export type { Transcribe } from './wire/transcribe'

/** A value that changes. `subscribe` calls back on every change, not for the current value. */
export interface Feed<T> {
  get(): T
  subscribe(listener: (value: T) => void): () => void
}

export interface Hermes {
  readonly link: Feed<Link>
  /** The app version and the Hermes version this socket has reported. Offline while the link is down. */
  readonly about: Feed<About>
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
   * The group chats of the socket's own profile, who is answering in each, whether this Hermes can make one, and the
   * bots it would seat in a new one. Read on every new socket, when sessions change, and on `groups.changed`.
   * `unsupported` on a Hermes with no `groups.capabilities`. A listed value stays while the link is down.
   */
  readonly groups: Feed<Groups>
  /**
   * The group chat `open` shows: its members, its thread, who is answering and what is on its way. null while `open`
   * shows anything else. Its log is read from the newest lines back, and kept current by `groups.changed`, or by
   * asking every 2 s on a Hermes that does not push.
   */
  readonly groupChat: Feed<GroupChat | null>
  /** The scheduled jobs of the socket's own profile. null until Hermes lists them, and on a Hermes without `cron.manage`. Listed on every new socket and on `cron.changed`. */
  readonly jobs: Feed<readonly Job[] | null>
  /**
   * Which bots are working, waiting on the user, or hold a reply no window has shown. Read from the
   * attached chats, and on a socket that reaches every profile from each bot's live chats, asked
   * once online, when sessions change and when the roster does. A chat is read once a window watches it.
   */
  readonly activity: Feed<BotActivities>
  /**
   * The screen of the open chat's bot: whether this Hermes can show it, whether the agent is using it, who has control,
   * and its latest frame, asked for every 2 s while the agent uses it. null while a group chat is open.
   */
  readonly screen: Feed<ScreenView | null>
  /**
   * Where to dial the live view of `screen`'s bot: a WebSocket address on the gateway's own origin that carries the
   * screen as RFB and holds a single-use ticket. It never leaves Electron main. null when Hermes or the route gives none.
   */
  screenSocket(): Promise<string | null>
  /**
   * Counts the times a bot's routines may have moved: on every `cron.changed` and every new socket. A window showing
   * routines asks for them again when it changes. The routines themselves are read with `run({ do: 'listRoutines' })`.
   */
  readonly routines: Feed<number>
  /**
   * Watch one session. The listener gets the current value at once and every later one. A session is
   * kept attached while a window watches it, while the gateway lists it as running, while its own
   * run is open, while Hermes waits on a request in it, and while it has unsent messages. It is
   * detached 60 s after none of those hold.
   * Call the returned function to stop watching.
   */
  watch(id: SessionId, listener: (session: Session) => void): () => void
  /**
   * Watch the skills of the bot `open` shows. The listener gets the current value at once and every later one. Hermes is
   * asked only while something watches: on the first watch, when the open bot changes, on a new socket, after `setSkill`
   * and on `skills.changed`.
   */
  watchSkills(listener: (library: SkillLibrary) => void): () => void
  /** Hears every change of every session the hub keeps attached, with the session as it was before. Call the returned function to stop. */
  changes(listener: (session: Session, previous: Session) => void): () => void
  /** Never rejects for an expected failure: that is a `Refusal`. Most outcomes also show up in the feeds. */
  run<C extends Command>(command: C): Promise<Outcome<ResultOf<C>>>
  close(): Promise<void>
}

export interface HermesOptions {
  /** `liveRoute().dial` for the real gateway, `scriptedDialer(fixture)` for a recorded one. */
  readonly dial: Dialer
  /** The gateway's HTTP API, as the route that dials asks it. `fixtureAsk(...)` for a recorded run. */
  readonly ask: AskHermes
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
  /** The unread chats kept from the last run, and where each change to them goes. Default: none kept. */
  readonly unread?: { readonly chats: readonly UnreadChat[]; keep(chats: readonly UnreadChat[]): void }
}

/** How long a session nothing retains stays attached. */
export const RETAIN_MS = 60_000
/** How many sessions let go of keep their content for a quick return. Atlas's 160 rows are about 300 KB. */
export const RELEASED_KEPT = 8
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
  return a.bot === b.bot && a.status === b.status && a.complete === b.complete && a.rows.length === b.rows.length && a.rows.every((row, index) => {
    const other = b.rows[index]
    return other !== undefined && row.id === other.id && row.title === other.title && row.preview === other.preview
      && row.lastActiveAt === other.lastActiveAt && row.badge === other.badge && row.pinned === other.pinned && row.botChat === other.botChat
  })
}

const sameOpen = (a: OpenChat, b: OpenChat) => JSON.stringify(a) === JSON.stringify(b)
const sameScreen = (a: ScreenView | null, b: ScreenView | null) => JSON.stringify(a) === JSON.stringify(b)

function sameAbout(left: About, right: About): boolean {
  if (left.app !== right.app) return false
  if (left.hermes.state !== 'known' || right.hermes.state !== 'known') return left.hermes.state === right.hermes.state
  return left.hermes.version === right.hermes.version
}

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
/** A socket that reaches every bot searches them all, so a search waits for the list of them. */
const STILL_LISTING = 'Highwing is still listing your bots.'

export function openHermes(options: HermesOptions): Hermes {
  const clock = options.clock ?? systemClock
  const mintId = options.mintId ?? randomUUID
  const uploads = options.uploads ?? NO_UPLOADS
  const count = (kind: 'unshown' | 'invalid' | 'unrouted' | 'declined', type: string) => options.onDiagnostic?.({ kind, type })

  const actors = new Map<SessionId, SessionActor>()
  /** Actors let go of, oldest first. Each is detached, so no frame, request or badge reaches it, and keeps its content. */
  const released = new Map<SessionId, SessionActor>()
  const watchers = new Map<SessionId, Set<(session: Session) => void>>()
  const changeListeners = new Set<(session: Session, previous: Session) => void>()
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
      book.refresh()
      activities.poll()
    }, LIST_DEBOUNCE_MS)
  }

  const routes: { readonly [S in ParsedEvent['scope']]: (parsed: Extract<ParsedEvent, { scope: S }>) => void } = {
    session: parsed => {
      if (parsed.event === null && parsed.skipped !== 'window') count(parsed.skipped, parsed.type)
      else if (parsed.event?.type === 'meta' && parsed.event.title !== undefined) list.retitle(parsed.sessionId, parsed.event.title)
      const actor = actors.get(parsed.sessionId)
      if (actor === undefined) return count('unrouted', parsed.type)
      const fresh = actor.feed({ in: 'event', frame: { stamp: parsed.stamp, event: parsed.event, seenAt: clock.now() } })
      if ('ask' in parsed && fresh && shownChat(desk.open)?.sessionId === parsed.sessionId) options.onPane?.(parsed.ask, actor.session)
    },
    gap: parsed => actors.get(parsed.sessionId)?.feed({ in: 'gap' }),
    app: parsed => {
      if (parsed.event !== 'cron.changed') return refreshSoon()
      scheduled.read()
      routines.set(routines.get() + 1)
    },
    skills: () => {
      catalogRead = readCatalog()
      void readLibrary()
    },
    display: parsed => screens.moved(parsed),
    groups: parsed => book.moved(parsed.rooms),
    unrouted: parsed => count('unrouted', parsed.type)
  }

  let heardVersion: string | null = null
  const noteVersion = (version: string | null) => {
    if (version === null || version === heardVersion) return
    heardVersion = version
    publishAbout()
  }
  const versionOn = (params: unknown): unknown => {
    if (typeof params !== 'object' || params === null || !('type' in params) || params.type !== 'session.info') return null
    const payload = 'payload' in params ? params.payload : null
    return typeof payload === 'object' && payload !== null && 'version' in payload ? payload.version : null
  }
  let publishAbout = () => {}

  const conn = connect(options.dial, {
    onLink: next => {
      if (next.state === 'online') heardVersion = null
      link.set(next)
      publishAbout()
      for (const actor of [...actors.values()]) actor.linkChanged()
      if (next.state !== 'online') {
        list.stale()
        screens.offline()
      }
      roster.linked(next.state)
      book.linked(next.state)
    },
    onOnline: () => {
      desk.online()
      list.refresh()
      catalogRead = readCatalog()
      relayRead = relays.probe()
      roster.ask()
      book.online()
      scheduled.read()
      activities.poll()
      screens.online()
      void readLibrary()
      routines.set(routines.get() + 1)
    },
    onEvent: params => {
      noteVersion(hermesVersionOf(versionOn(params)))
      const parsed = parseEvent(params)
      ;(routes[parsed.scope] as (parsed: ParsedEvent) => void)(parsed)
    },
    onServerRequest: request => asked(parseServerRequest(request))
  }, { startOnLaunch: options.startGatewayOnLaunch ?? true, clock })

  const link = feed<Link>(conn.link)
  const aboutOf = (): About => ({
    app: options.client.version,
    hermes: conn.link.state !== 'online' ? { state: 'offline' } : heardVersion === null ? { state: 'unreported' } : { state: 'known', version: heardVersion }
  })
  const about = feed<About>(aboutOf(), sameAbout)
  publishAbout = () => about.set(aboutOf())
  const screens = screenDesk(conn, clock, () => screen.set(screens.view))
  const screen = feed<ScreenView | null>(null, sameScreen)
  const routines = feed(0)
  const slash = feed<SlashCatalog>([], sameCatalog)
  let catalogReads = 0
  let catalogRead: Promise<void> = Promise.resolve()

  const readCatalog = async () => {
    const read = ++catalogReads
    const catalog = await conn.call('commands.catalog', {}, CATALOG_TIMEOUT_MS).then(parseCatalog).catch(() => [])
    if (read === catalogReads) slash.set(catalog)
  }

  const skillWatchers = new Set<(library: SkillLibrary) => void>()
  let library: SkillLibrary = { state: 'reading', bot: null }
  let libraryReads = 0
  const publishLibrary = (next: SkillLibrary) => {
    library = next
    for (const listener of [...skillWatchers]) listener(next)
  }

  /** A re-read of the same bot keeps its list on screen until the answer comes. */
  const readLibrary = async () => {
    if (skillWatchers.size === 0) return
    const read = ++libraryReads
    const bot = shownBot(desk.open)
    if (library.bot !== bot || library.state !== 'listed') publishLibrary({ state: 'reading', bot })
    const got = await readSkills(conn, bot)
    if (read !== libraryReads) return
    publishLibrary(got.ok ? { state: 'listed', bot, skills: got.value } : { state: 'failed', bot, message: got.refusal.message })
  }

  /** Each write sends a bot's whole off list read just before it, so two at once would undo each other. */
  let skillWrites: Promise<unknown> = Promise.resolve()

  const watchSkills: Hermes['watchSkills'] = listener => {
    skillWatchers.add(listener)
    listener(library)
    if (skillWatchers.size === 1) void readLibrary()
    return () => void skillWatchers.delete(listener)
  }

  const relays = relayBook(conn, clock, () => relay.set(relays.desk))
  const relay = feed<RelayDesk>(relays.desk)
  let relayRead: Promise<void> = Promise.resolve()

  const mentioned = (sessionId: SessionId, text: string): readonly Bot[] => {
    const listed = bots.get()
    if (!relay.get().supported || listed.state !== 'listed') return []
    const own = desk.botOf(sessionId)
    return mentionedBots(quoteOf(text).body, botsIn(listed.roster).filter(bot => bot.id !== own))
  }

  const publishSidebar = () => {
    const settled = new Map<SessionId, SessionContent>()
    for (const [id, actor] of actors) if (actor.session.sync.state !== 'opening') settled.set(id, actor.session)
    sidebar.set(deriveSidebar(list, settled, desk.isBotChat))
    activities.update()
  }

  const desk = chatDesk({
    conn, client: options.client, mintId,
    changed: () => {
      open.set(desk.open)
      list.follow(shownBot(desk.open))
      book.follow(shownGroup(desk.open))
      const shown = desk.open.shown
      screens.follow(shown === null || shown.kind === 'group' ? undefined : shown.bot)
      publishSidebar()
      if (shownBot(desk.open) !== library.bot) void readLibrary()
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
    const listed = roster.bots
    const ids = listed.state === 'listed' ? botsIn(listed.roster).map(bot => bot.id) : null
    if (conn.reach === 'host' && ids !== null) list.warm(ids)
    activities.roster(ids)
  })
  const bots = feed<Bots>(roster.bots)

  const attachedChats = () => {
    const held = new Map<SessionId, Attached>()
    for (const [id, actor] of actors) if (actor.session.sync.state !== 'opening') held.set(id, { bot: desk.botOf(id), busy: busyOf(actor.session) })
    return held
  }
  const activities = activityDesk(conn, {
    unread: options.unread?.chats ?? [],
    keep: chats => options.unread?.keep(chats),
    local: () => ({ attached: attachedChats(), shown: new Set(windows.keys()) }),
    changed: () => activity.set(activities.activity)
  })
  const activity = feed<BotActivities>(activities.activity)

  const book = groupBook(conn, {
    clock, mintId,
    changed: () => {
      groups.set(book.groups)
      groupChat.set(book.chat)
    },
    disbanded: group => {
      desk.disbanded(group)
      settle()
    }
  })
  const groups = feed<Groups>(book.groups)
  const groupChat = feed<GroupChat | null>(book.chat)

  const scheduled = jobList(conn, () => jobs.set(scheduled.jobs))
  const jobs = feed<readonly Job[] | null>(scheduled.jobs)

  const actorFor = (id: SessionId): SessionActor => {
    const held = actors.get(id)
    if (held !== undefined) return held
    const kept = released.get(id)
    if (kept !== undefined) {
      released.delete(id)
      actors.set(id, kept)
      kept.attach()
      return kept
    }
    const bot = desk.botOf(id)
    const actor = new SessionActor(id, {
      conn: bot === undefined ? conn : conn.as(bot), clock, mintId, bridge, noteVersion,
      watched: () => windows.has(id),
      publish: (session, previous) => {
        const { rewound } = session
        if (rewound !== previous.rewound) relays.reanchor(id, after => (Object.hasOwn(rewound, after) ? rewound[after] ?? null : after))
        for (const listener of [...(watchers.get(id) ?? [])]) listener(session)
        for (const listener of [...changeListeners]) listener(session, previous)
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
    return session !== undefined && (session.run.state === 'running' || session.outbox.length > 0 || session.requests.length > 0 || session.sides.some(side => side.state.s === 'running'))
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
          released.set(id, actor)
          for (const oldest of [...released.keys()].slice(0, -RELEASED_KEPT)) released.delete(oldest)
          void actor.release()
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
    activities.update()
    let watching = true
    return () => {
      if (!watching) return
      watching = false
      const left = (windows.get(id) ?? 1) - 1
      if (left === 0) windows.delete(id)
      else windows.set(id, left)
      stop()
      activities.update()
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
    pin: list.pin,
    drop: id => {
      list.drop(id)
      activities.forget(id)
    },
    refreshSoon,
    settledRelay: () => relayRead,
    mentioned,
    relay: relays.send,
    branchPins,
    branched: desk.branched,
    gone: desk.gone,
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

  const searchPlaces = (): readonly Place[] => {
    const listed = bots.get()
    return conn.reach === 'host' && listed.state === 'listed' ? botsIn(listed.roster).map(bot => ({ bot: bot.id, via: conn.as(bot.id) })) : [{ bot: null, via: conn }]
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
    if (command.do === 'open') return 'upFront' in command ? desk.askUpFront(command.ref) : desk.ask(command.ref)
    if (command.do === 'start') {
      const started = await desk.start(command.chat)
      return started.ok ? run({ do: 'send', sessionId: started.value, text: command.text, attachments: command.attachments ?? [] }) : started
    }
    if (command.do === 'botModels') return botModels(conn, command.bot)
    if (command.do === 'denyRules') return denyRules(conn, command.bot)
    if (command.do === 'botModelSettings') return botModelSettings(conn, command.bot)
    if (command.do === 'setBotModel') return setBotModel(conn, command.bot, command.model, command.confirm === true)
    if (command.do === 'setBotBackup') return setBotBackup(conn, command.bot, command.model)
    if (command.do === 'versions') return versions(command.sessionId)
    if (command.do === 'readMessages') {
      return conn.reach === 'host' && bots.get().state === 'loading' ? refused('rejected', STILL_LISTING) : readMessages(searchPlaces(), command.step, desk.listed)
    }
    if (command.do === 'createBot') {
      const made = await createBot(conn, command.draft, command.picture)
      // A 5062 may have made the profile, so the roster is read after any attempt.
      roster.ask()
      if (made.ok) await desk.ask({ kind: 'bot', bot: made.value.bot })
      return made
    }
    if (command.do === 'createFromTemplate') {
      const template = BOT_TEMPLATES.find(({ id }) => id === command.template)
      const plan = template === undefined ? null : templatePlan(template, command.answers)
      if (plan === null) return refused('rejected', 'Fill in every field to make this bot.')
      const made = await createFromTemplate(conn, plan, command.picture)
      roster.ask()
      // With warnings the setup dialog stays open to show them, and its Open button opens the bot.
      if (made.ok && made.value.warnings.length === 0) await desk.ask({ kind: 'bot', bot: made.value.bot })
      return made
    }
    if (command.do === 'createGroup') {
      const listed = bots.get()
      const made = await book.create(command.draft, listed.state === 'listed' ? botsIn(listed.roster) : [])
      if (made.ok) await desk.ask({ kind: 'group', group: command.draft.group })
      return made
    }
    if (command.do === 'sendToGroup') return book.send(command.group, command.text)
    if (command.do === 'stopGroup') return book.stop(command.group)
    if (command.do === 'renameGroup') return book.rename(command.group, command.name)
    if (command.do === 'deleteGroup') return book.disband(command.group)
    if (command.do === 'describeBot') return describeBot(conn, command.bot)
    if (command.do === 'setSkill') {
      const done = skillWrites.then(() => setSkill(conn, command.bot, command.name, command.enabled))
      skillWrites = done
      void done.then(readLibrary)
      return done
    }
    if (command.do === 'skillText') return skillText(conn, command.bot, command.name)
    if (command.do === 'passwordManagers' || command.do === 'usePasswordManager' || command.do === 'unlockPasswordManager' || command.do === 'lockPasswordManager') {
      return passwordManagers(conn, command)
    }
    if (command.do === 'toolServers') return toolServers(conn, command.bot)
    if (command.do === 'addToolServer') return addToolServer(conn, command.bot, command.setup)
    if (command.do === 'removeToolServer') return removeToolServer(conn, command.bot, command.name)
    if (command.do === 'plugins') return listPlugins(conn, command.bot)
    if (command.do === 'setPlugin') return setPlugin(conn, command.bot, command.key, command.enabled)
    if (command.do === 'installPlugin') return installPlugin(conn, command.bot, command.name)
    if (command.do === 'tools') return listToolsets(conn, options.ask, command.bot, command.sessionId)
    if (command.do === 'setToolset') return setToolset(options.ask, command.bot, command.name, command.enabled)
    if (command.do === 'listRoutines') return listRoutines(conn, command.bot)
    if (command.do === 'controlRoutine') return controlRoutine(conn, command.bot, command.routine, command.action)
    if (command.do === 'botPicture') return botPicture(conn, command.bot)
    if (command.do === 'canGeneratePicture') return canGeneratePicture(conn)
    if (command.do === 'generatePicture') return generatePicture(conn, command.prompt)
    if (command.do === 'pets') return listPets(conn)
    if (command.do === 'petPicture') return petPicture(conn, command.slug, command.url)
    if (command.do === 'apps') return listApps(conn, command.bot)
    if (command.do === 'connectApp') return connectApp(conn, command.slug, command.bot, command.connectionId)
    if (command.do === 'appSignIn') return appSignIn(conn, command.opId, command.bot)
    if (command.do === 'removeApp') return removeApp(conn, command.connectionId, command.bot)
    if (command.do === 'memory') return listMemory(conn)
    if (command.do === 'saveMemory') return saveMemory(conn, command.id, command.text)
    if (command.do === 'removeMemory') return removeMemory(conn, command.id)
    if (command.do === 'editBot' || command.do === 'setBotPicture' || command.do === 'removeBotPicture') {
      const done = command.do === 'editBot' ? await editBot(conn, command.bot, command.edit, command.revision)
        : await setBotPicture(conn, command.bot, command.do === 'setBotPicture' ? command.data : null)
      // A refused edit may still have saved some sections, so the roster is read after any attempt.
      roster.ask()
      return done
    }
    if (command.do === 'markBot') {
      const marked = await markBot(conn, command.bot, command.mark)
      if (marked.ok) return { ok: true, value: { edition: roster.confirm(command.bot, MARK_SETS[command.mark]) } }
      roster.ask()
      return marked
    }
    if (command.do === 'takeControl' || command.do === 'handBack') return screens.control(command.bot, command.do === 'takeControl')
    if (command.do === 'refreshBots') {
      roster.refresh()
      return DONE
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
    about,
    sidebar,
    slash,
    bots,
    open,
    relay,
    groups,
    groupChat,
    jobs,
    activity,
    screen,
    screenSocket: screens.socket,
    routines,
    watch,
    watchSkills,
    changes: listener => {
      changeListeners.add(listener)
      return () => void changeListeners.delete(listener)
    },
    run: command => run(command) as Promise<Outcome<ResultOf<typeof command>>>,
    close: async () => {
      cancelRefresh?.()
      book.close()
      screens.close()
      for (const cancel of releases.values()) cancel()
      releases.clear()
      conn.close()
    }
  }
}
