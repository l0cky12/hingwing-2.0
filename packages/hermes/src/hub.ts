import { randomUUID } from 'node:crypto'
import { DONE, refusalOf, refused, SessionActor, type Outcome } from './actor'
import type { ServerRequest } from './domain/reduce'
import type { InputId, Link, PromptId, PromptReply, Session, SessionContent, SessionId, Sidebar } from './domain/session'
import { deriveSidebar, sessionList } from './sidebar'
import { connect, systemClock, type Clock, type Dialer } from './wire/link'
import { parseEvent, parseServerRequest, type ParsedEvent } from './wire/parse'

export type { Outcome, Refusal } from './actor'
export type { Clock, Dialer, WireSocket } from './wire/link'
export { DialError, liveDialer } from './wire/link'

/** A value that changes. `subscribe` calls back on every change, not for the current value. */
export interface Feed<T> {
  get(): T
  subscribe(listener: (value: T) => void): () => void
}

export type Command =
  /** `draftId` is minted when the empty "new chat" view opens. Retrying with it cannot create a second session. */
  | { readonly do: 'create'; readonly draftId: string; readonly cwd: string | null }
  | { readonly do: 'send'; readonly sessionId: SessionId; readonly text: string }
  | { readonly do: 'stop'; readonly sessionId: SessionId }
  | { readonly do: 'answer'; readonly sessionId: SessionId; readonly promptId: PromptId; readonly reply: PromptReply }
  | { readonly do: 'discard'; readonly sessionId: SessionId; readonly inputId: InputId }
  | { readonly do: 'rename'; readonly sessionId: SessionId; readonly title: string }
  | { readonly do: 'archive'; readonly sessionId: SessionId; readonly archived: boolean }
  | { readonly do: 'loadEarlier'; readonly sessionId: SessionId }
  /** Retry: dial now. Start: dial now and let Hermes start its gateway. The only way a dial after launch starts it. */
  | { readonly do: 'reconnect'; readonly start: boolean }

export type ResultOf<C extends Command> = C extends { do: 'create' } ? SessionId : void

export interface Hermes {
  readonly link: Feed<Link>
  readonly sidebar: Feed<Sidebar>
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
  return a.status === b.status && a.rows.length === b.rows.length && a.rows.every((row, index) => {
    const other = b.rows[index]
    return other !== undefined && row.id === other.id && row.title === other.title && row.preview === other.preview
      && row.lastActiveAt === other.lastActiveAt && row.badge === other.badge
  })
}

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
    }, LIST_DEBOUNCE_MS)
  }

  const routes: { readonly [S in ParsedEvent['scope']]: (parsed: Extract<ParsedEvent, { scope: S }>) => void } = {
    session: parsed => {
      if (parsed.event === null) count(parsed.skipped, parsed.type)
      else if (parsed.event.type === 'meta' && parsed.event.title !== undefined) list.retitle(parsed.sessionId, parsed.event.title)
      const actor = actors.get(parsed.sessionId)
      if (actor === undefined) return count('unrouted', parsed.type)
      actor.feed({ in: 'event', frame: { stamp: parsed.stamp, event: parsed.event } })
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
    },
    onOnline: () => list.refresh(),
    onEvent: params => {
      const parsed = parseEvent(params)
      ;(routes[parsed.scope] as (parsed: ParsedEvent) => void)(parsed)
    },
    onServerRequest: request => refuse(parseServerRequest(request))
  }, { startOnLaunch: options.startGatewayOnLaunch ?? true, clock })

  const link = feed<Link>(conn.link)

  const publishSidebar = () => {
    const settled = new Map<SessionId, SessionContent>()
    for (const [id, actor] of actors) if (actor.session.sync.state !== 'opening') settled.set(id, actor.session)
    sidebar.set(deriveSidebar(list, settled))
  }

  const list = sessionList(conn, () => {
    publishSidebar()
    retain()
  })
  const sidebar = feed<Sidebar>(deriveSidebar(list, new Map()), sameSidebar)

  const actorFor = (id: SessionId): SessionActor => {
    const held = actors.get(id)
    if (held !== undefined) return held
    const actor = new SessionActor(id, {
      conn, clock, mintId, refuse,
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

  const sessionCommands: { readonly [K in SessionCommand['do']]: (actor: SessionActor, command: Extract<Command, { do: K }>) => Outcome | Promise<Outcome> } = {
    send: (actor, { text }) => actor.send(text),
    stop: actor => actor.stop(),
    answer: (actor, { promptId, reply }) => actor.answer(promptId, reply),
    discard: (actor, { inputId }) => actor.discard(inputId),
    loadEarlier: actor => actor.loadEarlier(),
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

  const create = async ({ draftId, cwd }: Extract<Command, { do: 'create' }>): Promise<Outcome<SessionId>> => {
    const { creation } = conn
    if (creation === null) return refused('offline', "Highwing isn't connected to Hermes right now.")
    if (!creation.sources.includes('gui')) return refused('unsupported', "This Hermes can't start a chat from Highwing.")
    const asked = { source: 'gui', request_id: draftId, ...(cwd === null ? {} : { cwd, cwd_explicit: true }), client: options.client }
    const params = Object.fromEntries(Object.entries(asked).filter(([key]) => creation.parameters.includes(key)))
    try {
      const id = (await conn.call('session.create', params)).session_id as SessionId
      actorFor(id)
      refreshSoon()
      return { ok: true, value: id }
    } catch (error) {
      return { ok: false, refusal: refusalOf(error) }
    }
  }

  const run = async (command: Command): Promise<Outcome<SessionId | void>> => {
    if (command.do === 'create') return create(command)
    if (command.do === 'reconnect') {
      conn.retryNow({ start: command.start })
      for (const actor of [...actors.values()]) actor.attach()
      return DONE
    }
    const handle = sessionCommands[command.do] as (actor: SessionActor, command: SessionCommand) => Outcome | Promise<Outcome>
    return handle(await attached(command.sessionId), command)
  }

  return {
    link,
    sidebar,
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
