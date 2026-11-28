import type { CheckOptions, CheckResult, Dialer, Feed, Hermes, Picked, PickedRoute, ReadHermes, Transcribe } from '@highwing/hermes'
import {
  currentServer, firstStep, nextServers, sameTarget, type CheckStep, type Command, type CommandOutcome, type Recording, type Server, type ServerEdit, type ServerId, type Servers, type SetupFailure, type Target,
  type Timed
} from '@highwing/hermes/domain'
import { introInFront, type Intro } from '../intro'
import { isSetupCommand, NO_SERVERS, NOT_NOW, showsSettings, type HubResult, type Into, type Live, type ServerBook, type Setup, type SetupCommand } from '../ipc-contract'
import type { Settings } from './settings'

/** The commands a connection carries out. The pane beside the chat has its own owner. */
export type ConnectionCommand = Command | SetupCommand

/** What a window is served from: the screen it shows, the Hermes behind the chat, and one way in for every command of the two. */
export interface ConnectionOwner {
  readonly setup: Feed<Setup>
  /** The saved servers, and how long each way of the current one took when it was last timed. */
  readonly servers: Feed<ServerBook>
  /** The Hermes of the live connection. null until a target is saved. */
  readonly hermes: Hermes | null
  /** One GET of the live Hermes's HTTP API. Rejects when no connection is open. */
  readonly read: ReadHermes
  run<C extends ConnectionCommand>(command: C): Promise<CommandOutcome<HubResult<C>>>
  /** Speech to text by the Hermes of the live connection. */
  transcribe(recording: Recording): Promise<CommandOutcome<string>>
  close(): Promise<void>
}

export interface ConnectionDeps {
  readonly loaded: Settings
  save(servers: Servers): Promise<void>
  check(target: Target, options: Pick<CheckOptions, 'signal' | 'onStep'>): Promise<CheckResult>
  /** One route over every way in to `server`. `onPick` hears which way each dial took. */
  routeFor(server: Server, onPick: (picked: Picked) => void): PickedRoute
  /** The id of a server about to be made. Never one a saved server has. */
  newId(): ServerId
  /** `place`: which connection this is, the same for the same server in every run. */
  open(dial: Dialer, place: string): Hermes
  armIntro(): Promise<void>
}

export type SetupEvent =
  | SetupCommand
  | { readonly do: 'step'; readonly step: CheckStep }
  | { readonly do: 'fail'; readonly failure: SetupFailure }
  | { readonly do: 'connect'; readonly live: Live }
  /** The user picked another saved server, and `live` is the connection to it. */
  | { readonly do: 'switch'; readonly live: Live }
  /** A dial of the live connection landed on another way in. `live` has the epoch it had. */
  | { readonly do: 'via'; readonly live: Live }

type ServerCommand = Extract<SetupCommand, { readonly do: 'useServer' | 'arrangeWays' | 'removeServer' }>
const SERVER_VERBS: { readonly [K in ServerCommand['do']]: true } = { useServer: true, arrangeWays: true, removeServer: true }
const isServerCommand = (command: SetupCommand): command is ServerCommand => Object.hasOwn(SERVER_VERBS, command.do)

type At<A extends Setup['at']> = Extract<Setup, { at: A }>
type On<E extends SetupEvent['do']> = Extract<SetupEvent, { do: E }>
type Editing = At<'form' | 'checking' | 'failed'>

const check = ({ live }: At<'form' | 'failed' | 'saved'>, { target, into }: On<'checkTarget'>): Setup | null =>
  // Only a first server can be made with no connection, and it is made by `replace`.
  (live === null && into !== 'replace' ? null : { at: 'checking', live, target, into, step: firstStep(target) })
const keep = ({ live }: Editing | At<'saved'>): Setup | null => (live === null ? null : { at: 'chat', live })
const stopWaiting = ({ target, step }: At<'checking'>): Setup | null =>
  (step === 'sign-in' ? { at: 'failed', live: null, target, into: 'replace', failure: 'sign-in-cancelled' } : null)
const stop = ({ live }: Editing): Setup => ({ at: 'form', live, notice: null })
const via = <S extends At<'chat' | 'form' | 'checking' | 'failed' | 'saved'>>(setup: S, { live }: On<'via'>): Setup | null =>
  (setup.live?.epoch === live.epoch ? { ...setup, live } : null)
/** An edit of the saved servers changes no screen. The row says which screens take one: Settings at rest, never a running check. */
const edits = (setup: At<'form' | 'failed' | 'saved'>): Setup | null => (setup.live === null ? null : setup)
const switched = (_setup: Setup, { live }: On<'switch'>): Setup => ({ at: 'saved', live, from: 'settings', into: 'replace' })
const AT_REST = { checkTarget: check, keepTarget: keep, useServer: edits, arrangeWays: edits, removeServer: edits, switch: switched, via } as const

/** Every move the setup screen can make. A state with no row for an event refuses it. */
const MOVES: { readonly [A in Setup['at']]: { readonly [E in SetupEvent['do']]?: (setup: At<A>, event: On<E>) => Setup | null } } = {
  chat: {
    editTarget: ({ live }) => ({ at: 'form', live, notice: null }),
    // Settings closed while the pick was being saved. The chat moves to the server all the same.
    switch: (_setup, { live }) => ({ at: 'chat', live }),
    via
  },
  form: AT_REST,
  checking: {
    step: (setup, { step }) => (setup.step === step ? setup : { ...setup, step }),
    fail: ({ live, target, into }, { failure }) => ({ at: 'failed', live, target, into, failure }),
    connect: (setup, { live }) => ({ at: 'saved', live, from: setup.live === null ? 'first-run' : 'settings', into: setup.into }),
    // The target is going to disk. Cancelling now would leave the file and the chat on different machines.
    keepTarget: setup => (setup.step === 'save' ? null : keep(setup) ?? stopWaiting(setup)),
    stopCheck: setup => (setup.step === 'save' ? null : stop(setup)),
    via
  },
  failed: { ...AT_REST, stopCheck: stop },
  saved: AT_REST,
  pinned: {}
}

/** The setup state after `event`, or null when the state it is in refuses the event. */
export function nextSetup(setup: Setup, event: SetupEvent): Setup | null {
  const move = MOVES[setup.at][event.do] as ((setup: Setup, event: SetupEvent) => Setup | null) | undefined
  return move?.(setup, event) ?? null
}

const KEEP = { do: 'keepTarget' } as const
const STOP = { do: 'stopCheck' } as const

/** Whether an open runs now: in the chat, or in Settings, which it leaves first. It waits through first run, and through a save, which refuses to leave. */
export const opensNow = (setup: Setup, intro: Intro): boolean =>
  !introInFront(setup, intro) && (setup.at === 'chat' || setup.at === 'pinned' || (showsSettings(setup) && nextSetup(setup, KEEP) !== null))

/** The hub opens a bot or group chat it made, so making one is an open too. */
const makesChat = (command: Command): boolean => command.do === 'createBot' || command.do === 'createFromTemplate' || command.do === 'createGroup'
const opensChat = (command: Command): boolean => command.do === 'open' || makesChat(command)

const firstSetup = (loaded: Settings, live: Live | null): Setup =>
  live === null ? { at: 'form', live, notice: loaded.state === 'unreadable' || loaded.state === 'newer' ? loaded.state : null } : { at: 'chat', live }

const DONE = { ok: true, value: undefined } as const
const NOT_CONNECTED = { ok: false, refusal: { kind: 'offline', message: "Highwing isn't connected to Hermes yet." } } as const
const NOT_SAVED = { ok: false, refusal: { kind: 'rejected', message: "Highwing couldn't save that change. Check that its settings folder can be written to." } } as const


export function feed<T>(initial: T): Feed<T> & { set(next: T): void } {
  let value = initial
  let sets = 0
  const listeners = new Set<(value: T) => void>()
  return {
    get: () => value,
    subscribe: listener => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    set: next => {
      if (next === value) return
      value = next
      const set = ++sets
      for (const listener of [...listeners]) {
        // A listener set a newer value and already told every listener. Going on would end the rest on this stale one.
        if (sets !== set) return
        listener(next)
      }
    }
  }
}

/**
 * The single owner of the setup state, the saved servers and the live `Hermes`. A check that passes
 * saves its target as the check's `into` says. For a new server it opens a `Hermes` on the new
 * route, and only then closes the old one and ends the old route's processes. For another way in to
 * the current server it hands the way to the live route, which keeps its `Hermes` and its epoch. A
 * check that fails changes nothing, and one that passes for a way the current server already has
 * only retries its link.
 */
export function ownConnection(deps: ConnectionDeps): ConnectionOwner {
  interface Open { live: Live; readonly hermes: Hermes; readonly route: PickedRoute }
  let servers = deps.loaded.state === 'saved' ? deps.loaded.servers : null
  let open: Open | null = null
  let times: readonly Timed[] = []
  let checking: AbortController | null = null
  /** An edit of the saved servers is on its way to disk. Another one would race it. */
  let saving = false
  let closed = false

  const connect = (server: Server, epoch: number): Open => {
    const route = deps.routeFor(server, picked => onPick(epoch, picked))
    return { live: { server: server.id, target: server.ways[0], epoch }, hermes: deps.open(route.dial, server.id), route }
  }
  /** Both end before this returns, so a quit that does not wait for the promise still leaves no process behind. */
  const disconnect = ({ hermes, route }: Open): Promise<void> => {
    const closed = hermes.close()
    route.dispose()
    return closed
  }

  if (servers !== null) open = connect(currentServer(servers), 1)
  const setup = feed<Setup>(firstSetup(deps.loaded, open?.live ?? null))
  const bookOf = (): ServerBook => (servers === null ? NO_SERVERS : { list: servers.list, current: servers.current, times })
  const book = feed<ServerBook>(bookOf())

  const apply = (event: SetupEvent): boolean => {
    const next = nextSetup(setup.get(), event)
    if (next !== null) setup.set(next)
    return next !== null
  }

  /** The live connection now goes through `target`. The chat stays as it is, since the Hermes is the same one. */
  const goVia = (held: Open, target: Target) => {
    if (sameTarget(held.live.target, target)) return
    held.live = { ...held.live, target }
    apply({ do: 'via', live: held.live })
  }

  function onPick(epoch: number, picked: Picked) {
    // A route that was replaced can still finish a dial it had begun.
    if (open === null || open.live.epoch !== epoch) return
    times = picked.times
    goVia(open, picked.using)
    book.set(bookOf())
  }

  /** The saved servers become `next`, and Settings lists them. `times` are the current server's, so they go with a server that is left. */
  const hold = (next: Servers) => {
    const kept = servers?.current === next.current ? currentServer(next).ways : []
    times = times.filter(({ target }) => kept.some(way => sameTarget(way, target)))
    servers = next
    book.set(bookOf())
  }

  /** Leaves `before` for the current server, as a new connection: a new epoch, so every window drops what it held. */
  const moveTo = async (next: Servers, before: Open | null, event: 'connect' | 'switch') => {
    hold(next)
    open = connect(currentServer(next), (before?.live.epoch ?? 0) + 1)
    apply({ do: event, live: open.live })
    if (before !== null) await disconnect(before)
  }

  /** The live route takes the current server's ways as `next` has them. A way in use that was removed is no longer the one the window names. */
  const rearrange = (next: Servers, held: Open) => {
    const { ways, pick } = currentServer(next)
    hold(next)
    held.route.arrange(ways, pick)
    if (!ways.some(way => sameTarget(way, held.live.target))) goVia(held, ways[0])
  }

  const runCheck = async (target: Target, into: Into) => {
    const life = new AbortController()
    checking = life
    /** A check that was cancelled or replaced still resolves. What it found no longer counts. */
    const stale = () => checking !== life
    const result = await deps.check(target, { signal: life.signal, onStep: step => void (stale() || apply({ do: 'step', step })) })
    if (stale()) return
    if (!result.ok) return void apply({ do: 'fail', failure: result.failure })
    if (open !== null && servers !== null && into !== 'addServer' && currentServer(servers).ways.some(way => sameTarget(way, target))) {
      // A link that was blocked until this check passed, as one waiting for a sign-in is, would otherwise stay blocked.
      void open.hermes.run({ do: 'reconnect', start: false })
      return void apply({ do: 'connect', live: open.live })
    }
    const edit: ServerEdit = into === 'addWay' ? { do: into, target } : { do: into, target, id: deps.newId() }
    const next = nextServers(servers, edit)
    if (next === null) return void apply({ do: 'fail', failure: 'cant-save' })
    apply({ do: 'step', step: 'save' })
    try {
      if (open === null) await deps.armIntro()
      await deps.save(next)
    } catch {
      if (!stale()) apply({ do: 'fail', failure: 'cant-save' })
      return
    }
    // A close during the save ended this check. Opening a connection now would outlive the app.
    if (stale()) return
    if (into !== 'addWay' || open === null) return moveTo(next, open, 'connect')
    rearrange(next, open)
    apply({ do: 'connect', live: open.live })
  }

  const runSetup = (command: Exclude<SetupCommand, { readonly do: ServerCommand['do'] }>): CommandOutcome => {
    if (closed || (saving && command.do === 'checkTarget') || !apply(command)) return NOT_NOW
    if (command.do === 'keepTarget' || command.do === 'stopCheck') {
      checking?.abort()
      checking = null
    }
    if (command.do === 'checkTarget') void runCheck(command.target, command.into)
    return DONE
  }

  const EDIT_OF: { readonly [C in ServerCommand as C['do']]: (command: C) => ServerEdit } = {
    useServer: ({ server }) => ({ do: 'use', server }),
    arrangeWays: ({ ways, pick }) => ({ do: 'arrange', ways, pick }),
    removeServer: ({ server }) => ({ do: 'remove', server })
  }

  /** An edit of the saved servers from Settings. It is on disk before anything else changes, so the file and the chat never name different servers. */
  const runServers = async (command: ServerCommand): Promise<CommandOutcome> => {
    const held = open
    const next = servers === null ? null : nextServers(servers, (EDIT_OF[command.do] as (command: ServerCommand) => ServerEdit)(command))
    if (closed || saving || held === null || next === null || !apply(command)) return NOT_NOW
    if (next === servers) return DONE
    saving = true
    try {
      await deps.save(next)
    } catch {
      return NOT_SAVED
    } finally {
      saving = false
    }
    // A close during the save ended the connection. Opening one now would outlive the app.
    if (closed) return NOT_NOW
    if (command.do === 'useServer') await moveTo(next, held, 'switch')
    else if (command.do === 'arrangeWays') rearrange(next, held)
    else hold(next)
    return DONE
  }

  /**
   * Every open passes here, from the window, a notification or a link: Settings closes first, as Close does, or the open is refused.
   * A bot or group chat is opened by the hub once it is made, so Settings closes after Hermes makes it, and stays up when Hermes refuses
   * it. A running check stops first, as Cancel does: one that passed would move the chat to another machine while it is made on this one.
   * Settings closes only on the connection it was made on, since a check started meanwhile may have put a new one's confirmation up.
   */
  const runChat = async (command: Command): Promise<CommandOutcome<unknown>> => {
    const fromSettings = showsSettings(setup.get())
    if (fromSettings && opensChat(command) && nextSetup(setup.get(), KEEP) === null) return NOT_NOW
    if (fromSettings && command.do === 'open') runSetup(KEEP)
    if (fromSettings && makesChat(command) && setup.get().at === 'checking') runSetup(STOP)
    const sentOn = open
    const outcome = await (sentOn?.hermes.run(command) ?? NOT_CONNECTED)
    if (fromSettings && makesChat(command) && outcome.ok && open === sentOn) runSetup(KEEP)
    return outcome
  }

  return {
    setup,
    servers: book,
    get hermes() { return open?.hermes ?? null },
    read: path => (open === null ? Promise.reject(new Error('No Hermes is connected.')) : open.route.read(path)),
    run: async <C extends ConnectionCommand>(command: C) => {
      const outcome = !isSetupCommand(command) ? await runChat(command) : isServerCommand(command) ? await runServers(command) : runSetup(command)
      return outcome as CommandOutcome<HubResult<C>>
    },
    transcribe: async recording => (open === null ? NOT_CONNECTED : open.route.transcribe(recording)),
    close: async () => {
      closed = true
      checking?.abort()
      checking = null
      await (open === null ? undefined : disconnect(open))
    }
  }
}

/** A window served from one fixed `Hermes`, as a fixture run is. It has no setup, so it refuses every setup command. */
export function pinnedConnection(hermes: Hermes, read: ReadHermes, transcribe: Transcribe): ConnectionOwner {
  return {
    setup: feed<Setup>({ at: 'pinned' }),
    servers: feed(NO_SERVERS),
    hermes,
    transcribe: recording => transcribe(recording),
    read,
    run: async <C extends ConnectionCommand>(command: C) =>
      (isSetupCommand(command) ? NOT_NOW : await hermes.run(command)) as CommandOutcome<HubResult<C>>,
    close: () => hermes.close()
  }
}

interface FocusEvents {
  on(event: 'browser-window-focus', listener: () => void): unknown
  off(event: 'browser-window-focus', listener: () => void): unknown
}

/** Hermes sends no event when a profile changes, so a pin made in Hermes desktop reaches Highwing when the user comes back to it. */
export function refreshBotsOnFocus(app: FocusEvents, owner: Pick<ConnectionOwner, 'run'>): () => void {
  const refresh = () => void owner.run({ do: 'refreshBots' })
  app.on('browser-window-focus', refresh)
  return () => app.off('browser-window-focus', refresh)
}
