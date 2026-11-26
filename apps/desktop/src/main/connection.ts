import type { CheckOptions, CheckResult, Dialer, Feed, Hermes, Route } from '@highwing/hermes'
import { firstStep, sameTarget, type CheckStep, type Command, type CommandOutcome, type SetupFailure, type Target } from '@highwing/hermes/domain'
import { introInFront, type Intro } from '../intro'
import { isSetupCommand, NOT_NOW, showsSettings, type HubResult, type Live, type Setup, type SetupCommand } from '../ipc-contract'
import type { Settings } from './settings'

/** The commands a connection carries out. The pane beside the chat has its own owner. */
export type ConnectionCommand = Command | SetupCommand

/** What a window is served from: the screen it shows, the Hermes behind the chat, and one way in for every command of the two. */
export interface ConnectionOwner {
  readonly setup: Feed<Setup>
  /** The Hermes of the live connection. null until a target is saved. */
  readonly hermes: Hermes | null
  run<C extends ConnectionCommand>(command: C): Promise<CommandOutcome<HubResult<C>>>
  close(): Promise<void>
}

export interface ConnectionDeps {
  readonly loaded: Settings
  save(target: Target): Promise<void>
  check(target: Target, options: Pick<CheckOptions, 'signal' | 'onStep'>): Promise<CheckResult>
  routeFor(target: Target): Route
  open(dial: Dialer): Hermes
  armIntro(): Promise<void>
}

export type SetupEvent =
  | SetupCommand
  | { readonly do: 'step'; readonly step: CheckStep }
  | { readonly do: 'fail'; readonly failure: SetupFailure }
  | { readonly do: 'connect'; readonly live: Live }

type At<A extends Setup['at']> = Extract<Setup, { at: A }>
type On<E extends SetupEvent['do']> = Extract<SetupEvent, { do: E }>
type Editing = At<'form' | 'checking' | 'failed'>

const check = ({ live }: At<'form' | 'failed' | 'saved'>, { target }: On<'checkTarget'>): Setup =>
  ({ at: 'checking', live, target, step: firstStep(target) })
const keep = ({ live }: Editing | At<'saved'>): Setup | null => (live === null ? null : { at: 'chat', live })
const stopWaiting = ({ target, step }: At<'checking'>): Setup | null =>
  (step === 'sign-in' ? { at: 'failed', live: null, target, failure: 'sign-in-cancelled' } : null)
const stop = ({ live }: Editing): Setup => ({ at: 'form', live, notice: null })

/** Every move the setup screen can make. A state with no row for an event refuses it. */
const MOVES: { readonly [A in Setup['at']]: { readonly [E in SetupEvent['do']]?: (setup: At<A>, event: On<E>) => Setup | null } } = {
  chat: { editTarget: ({ live }) => ({ at: 'form', live, notice: null }) },
  form: { checkTarget: check, keepTarget: keep },
  checking: {
    step: (setup, { step }) => (setup.step === step ? setup : { ...setup, step }),
    fail: ({ live, target }, { failure }) => ({ at: 'failed', live, target, failure }),
    connect: (setup, { live }) => ({ at: 'saved', live, from: setup.live === null ? 'first-run' : 'settings' }),
    // The target is going to disk. Cancelling now would leave the file and the chat on different machines.
    keepTarget: setup => (setup.step === 'save' ? null : keep(setup) ?? stopWaiting(setup)),
    stopCheck: setup => (setup.step === 'save' ? null : stop(setup))
  },
  failed: { checkTarget: check, keepTarget: keep, stopCheck: stop },
  saved: { keepTarget: keep, checkTarget: check },
  pinned: {}
}

/** The setup state after `event`, or null when the state it is in refuses the event. */
export function nextSetup(setup: Setup, event: SetupEvent): Setup | null {
  const move = MOVES[setup.at][event.do] as ((setup: Setup, event: SetupEvent) => Setup | null) | undefined
  return move?.(setup, event) ?? null
}

const KEEP = { do: 'keepTarget' } as const
const STOP = { do: 'stopCheck' } as const

/** Whether an open runs now: in the chat, or in Settings, which it leaves first. It waits through first run, through a save, which refuses to leave, and while the intro covers the screen. */
export const opensNow = (setup: Setup, intro: Intro): boolean =>
  !introInFront(setup, intro) && (setup.at === 'chat' || setup.at === 'pinned' || (showsSettings(setup) && nextSetup(setup, KEEP) !== null))

/** The hub opens a bot or group chat it made, so making one is an open too. */
const makesChat = (command: Command): boolean => command.do === 'createBot' || command.do === 'createGroup'
const opensChat = (command: Command): boolean => command.do === 'open' || makesChat(command)

const firstSetup = (loaded: Settings, live: Live | null): Setup =>
  live === null ? { at: 'form', live, notice: loaded.state === 'unreadable' || loaded.state === 'newer' ? loaded.state : null } : { at: 'chat', live }

const DONE = { ok: true, value: undefined } as const
const NOT_CONNECTED = { ok: false, refusal: { kind: 'offline', message: "Highwing isn't connected to Hermes yet." } } as const


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
 * The single owner of the setup state, the saved target and the live `Hermes`. A check that passes
 * saves its target, opens a `Hermes` on the new route, and only then closes the old one and ends
 * the old route's processes. A check that fails changes neither, and one that passes for the target
 * already live only retries its link.
 */
export function ownConnection(deps: ConnectionDeps): ConnectionOwner {
  type Open = { readonly live: Live; readonly hermes: Hermes; readonly route: Route }
  const connect = (target: Target, epoch: number): Open => {
    const route = deps.routeFor(target)
    return { live: { target, epoch }, hermes: deps.open(route.dial), route }
  }
  /** Both end before this returns, so a quit that does not wait for the promise still leaves no process behind. */
  const disconnect = ({ hermes, route }: Open): Promise<void> => {
    const closed = hermes.close()
    route.dispose()
    return closed
  }

  let open = deps.loaded.state === 'saved' ? connect(deps.loaded.target, 1) : null
  let checking: AbortController | null = null
  let closed = false
  const setup = feed<Setup>(firstSetup(deps.loaded, open?.live ?? null))

  const apply = (event: SetupEvent): boolean => {
    const next = nextSetup(setup.get(), event)
    if (next !== null) setup.set(next)
    return next !== null
  }

  const runCheck = async (target: Target) => {
    const life = new AbortController()
    checking = life
    /** A check that was cancelled or replaced still resolves. What it found no longer counts. */
    const stale = () => checking !== life
    const result = await deps.check(target, { signal: life.signal, onStep: step => void (stale() || apply({ do: 'step', step })) })
    if (stale()) return
    if (!result.ok) return void apply({ do: 'fail', failure: result.failure })
    if (open !== null && sameTarget(open.live.target, target)) {
      // A link that was blocked until this check passed, as one waiting for a sign-in is, would otherwise stay blocked.
      void open.hermes.run({ do: 'reconnect', start: false })
      return void apply({ do: 'connect', live: open.live })
    }
    apply({ do: 'step', step: 'save' })
    try {
      if (open === null) await deps.armIntro()
      await deps.save(target)
    } catch {
      if (!stale()) apply({ do: 'fail', failure: 'cant-save' })
      return
    }
    // A close during the save ended this check. Opening a connection now would outlive the app.
    if (stale()) return
    const before = open
    open = connect(target, (before?.live.epoch ?? 0) + 1)
    apply({ do: 'connect', live: open.live })
    if (before !== null) await disconnect(before)
  }

  const runSetup = (command: SetupCommand): CommandOutcome => {
    if (closed || !apply(command)) return NOT_NOW
    if (command.do === 'keepTarget' || command.do === 'stopCheck') {
      checking?.abort()
      checking = null
    }
    if (command.do === 'checkTarget') void runCheck(command.target)
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
    get hermes() { return open?.hermes ?? null },
    run: async <C extends ConnectionCommand>(command: C) => {
      const outcome = isSetupCommand(command) ? runSetup(command) : await runChat(command)
      return outcome as CommandOutcome<HubResult<C>>
    },
    close: async () => {
      closed = true
      checking?.abort()
      checking = null
      await (open === null ? undefined : disconnect(open))
    }
  }
}

/** A window served from one fixed `Hermes`, as a fixture run is. It has no setup, so it refuses every setup command. */
export function pinnedConnection(hermes: Hermes): ConnectionOwner {
  return {
    setup: feed<Setup>({ at: 'pinned' }),
    hermes,
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
