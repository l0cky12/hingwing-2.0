import type { CheckResult, Dialer, Hermes, Picked, PickedRoute } from '@highwing/hermes'
import { currentServer, type BotId, type CheckFailure, type CheckStep, type CommandOutcome, type GroupId, type PickMode, type ServerId, type Servers, type SessionId, type SshHost, type Target } from '@highwing/hermes/domain'
import type { GatewayUrl } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import type { Live, Setup } from '../src/ipc-contract'
import { OFF } from '../src/intro'
import { feed, nextSetup, ownConnection, pinnedConnection, refreshBotsOnFocus, type ConnectionDeps, type SetupEvent } from '../src/main/connection'
import { chatLinks } from '../src/main/links'
import type { Settings } from '../src/main/settings'
import { savedAt, SERVER } from './support/live'

const REMOTE: Target = { kind: 'remote', host: 'hermes-host.example-tailnet.ts.net' as SshHost }
const OTHER: Target = { kind: 'remote', host: 'other-host' as SshHost }
const LOCAL: Target = { kind: 'local' }
const RECORDING = { mime: 'audio/webm', audio: new Uint8Array([1]) }
const LAN: Target = { kind: 'ssh', host: '192.168.1.20' as SshHost }
const LIVE: Live = { server: SERVER, target: LOCAL, epoch: 1 }
const NEXT: Live = { server: 'server-2' as ServerId, target: REMOTE, epoch: 2 }
/** A connection through `target`, to whichever server the owner made for it. */
const live = (target: Target, epoch: number): Live => ({ server: expect.any(String) as ServerId, target, epoch })

describe('nextSetup', () => {
  const EDITING: Setup = { at: 'form', live: LIVE, notice: null }
  const FIRST_RUN: Setup = { at: 'form', live: null, notice: 'newer' }
  const CHECKING: Setup = { at: 'checking', live: LIVE, target: REMOTE, into: 'replace', step: 'tailscale' }
  const SAVING: Setup = { ...CHECKING, step: 'save' }
  const FAILED: Setup = { at: 'failed', live: null, target: REMOTE, into: 'replace', failure: 'host-not-found' }
  const FIRST_CHECK: Setup = { at: 'checking', live: null, target: REMOTE, into: 'replace', step: 'hermes' }
  const SAVED: Setup = { at: 'saved', live: NEXT, from: 'settings', into: 'replace' }

  it.each<[string, Setup, SetupEvent, Setup]>([
    ['the Settings button opens the form over the chat', { at: 'chat', live: LIVE }, { do: 'editTarget' }, EDITING],
    ['a remote check starts at Tailscale', EDITING, { do: 'checkTarget', target: REMOTE, into: 'replace' }, CHECKING],
    ['a check of this computer starts at Hermes', FIRST_RUN, { do: 'checkTarget', target: LOCAL, into: 'replace' }, { at: 'checking', live: null, target: LOCAL, into: 'replace', step: 'hermes' }],
    ['a check moves to its next step', CHECKING, { do: 'step', step: 'ssh' }, { ...CHECKING, step: 'ssh' }],
    ['a step fails', CHECKING, { do: 'fail', failure: 'ssh-denied' }, { at: 'failed', live: LIVE, target: REMOTE, into: 'replace', failure: 'ssh-denied' }],
    ['a save fails', SAVING, { do: 'fail', failure: 'cant-save' }, { at: 'failed', live: LIVE, target: REMOTE, into: 'replace', failure: 'cant-save' }],
    ['a check from Settings passes and is saved', SAVING, { do: 'connect', live: NEXT }, SAVED],
    ['a check on a first run passes and is saved', { ...SAVING, live: null }, { do: 'connect', live: NEXT }, { ...SAVED, from: 'first-run' }],
    ['a failed target is checked again', FAILED, { do: 'checkTarget', target: OTHER, into: 'replace' }, { at: 'checking', live: null, target: OTHER, into: 'replace', step: 'tailscale' }],
    ['Close leaves the form for the chat', EDITING, { do: 'keepTarget' }, { at: 'chat', live: LIVE }],
    ['Close leaves a running check for the chat', CHECKING, { do: 'keepTarget' }, { at: 'chat', live: LIVE }],
    ['Close leaves a failure for the chat', { ...FAILED, live: LIVE }, { do: 'keepTarget' }, { at: 'chat', live: LIVE }],
    ['Close leaves a wait for a sign-in for the chat', { ...CHECKING, step: 'sign-in' }, { do: 'keepTarget' }, { at: 'chat', live: LIVE }],
    ['Stop waiting ends the sign-in of a first run as a failure', { ...FIRST_CHECK, step: 'sign-in' }, { do: 'keepTarget' }, { at: 'failed', live: null, target: REMOTE, into: 'replace', failure: 'sign-in-cancelled' }],
    ['Cancel stops a running check and stays on the form', CHECKING, { do: 'stopCheck' }, EDITING],
    ['Cancel stops a wait for a sign-in and stays on the form', { ...CHECKING, step: 'sign-in' }, { do: 'stopCheck' }, EDITING],
    ['Cancel stops a failed check and stays on the form', { ...FAILED, live: LIVE }, { do: 'stopCheck' }, EDITING],
    ['Open chat leaves the first run\'s saved screen', { ...SAVED, from: 'first-run' }, { do: 'keepTarget' }, { at: 'chat', live: NEXT }],
    ['Close leaves Settings after a save', SAVED, { do: 'keepTarget' }, { at: 'chat', live: NEXT }],
    ['Connect in Settings after a save checks again', SAVED, { do: 'checkTarget', target: OTHER, into: 'replace' }, { at: 'checking', live: NEXT, target: OTHER, into: 'replace', step: 'tailscale' }],
    ['a check of a way to add starts at ssh and keeps what it is for', EDITING, { do: 'checkTarget', target: LAN, into: 'addWay' }, { at: 'checking', live: LIVE, target: LAN, into: 'addWay', step: 'ssh' }],
    ['a failed check keeps what it was for', { ...CHECKING, into: 'addServer' }, { do: 'fail', failure: 'ssh-denied' }, { at: 'failed', live: LIVE, target: REMOTE, into: 'addServer', failure: 'ssh-denied' }],
    ['a passed check says what it did', { ...SAVING, into: 'addWay' }, { do: 'connect', live: LIVE }, { at: 'saved', live: LIVE, from: 'settings', into: 'addWay' }],
    ['a dial lands on another way while the chat shows', { at: 'chat', live: LIVE }, { do: 'via', live: { ...LIVE, target: LAN } }, { at: 'chat', live: { ...LIVE, target: LAN } }],
    ['a dial lands on another way while a check runs', CHECKING, { do: 'via', live: { ...LIVE, target: LAN } }, { ...CHECKING, live: { ...LIVE, target: LAN } }],
    ['a pick of another server shows it as a passed check does', EDITING, { do: 'switch', live: NEXT }, SAVED],
    ['a pick after a failed check leaves the failure', { ...FAILED, live: LIVE }, { do: 'switch', live: NEXT }, SAVED],
    ['a pick made as Settings closed moves the chat', { at: 'chat', live: LIVE }, { do: 'switch', live: NEXT }, { at: 'chat', live: NEXT }]
  ])('%s', (_what, from, event, to) => {
    expect(nextSetup(from, event)).toEqual(to)
  })

  it.each<[string, Setup, SetupEvent]>([
    ['Cancel with no connection to go back to', FIRST_RUN, { do: 'keepTarget' }],
    ['Cancel of a failure with no connection to go back to', FAILED, { do: 'keepTarget' }],
    ['Close while the target is being saved', SAVING, { do: 'keepTarget' }],
    ['Stop waiting of a first run\'s check that waits for no one', FIRST_CHECK, { do: 'keepTarget' }],
    ['Cancel while the target is being saved', SAVING, { do: 'stopCheck' }],
    ['Cancel when no check runs', EDITING, { do: 'stopCheck' }],
    ['Cancel of a check from the chat', { at: 'chat', live: LIVE }, { do: 'stopCheck' }],
    ['Cancel after a check passed', SAVED, { do: 'stopCheck' }],
    ['a second check while one runs', CHECKING, { do: 'checkTarget', target: OTHER, into: 'replace' }],
    ['a check from the chat', { at: 'chat', live: LIVE }, { do: 'checkTarget', target: REMOTE, into: 'replace' }],
    ['a step when no check runs', EDITING, { do: 'step', step: 'ssh' }],
    ['a result when no check runs', FAILED, { do: 'connect', live: NEXT }],
    ['the Settings button on the saved screen', SAVED, { do: 'editTarget' }],
    ['the Settings button in a fixture run', { at: 'pinned' }, { do: 'editTarget' }],
    ['a check in a fixture run', { at: 'pinned' }, { do: 'checkTarget', target: LOCAL, into: 'replace' }],
    ['a way added on a first run, which has no server', FIRST_RUN, { do: 'checkTarget', target: LAN, into: 'addWay' }],
    ['a server added on a first run, where the first is made by replace', FIRST_RUN, { do: 'checkTarget', target: LAN, into: 'addServer' }],
    ['a pick of another server while a check runs', CHECKING, { do: 'useServer', server: SERVER }],
    ['a reorder while a check runs', CHECKING, { do: 'arrangeWays', ways: [LAN], pick: 'order' }],
    ['a removal while the target is being saved', SAVING, { do: 'removeServer', server: SERVER }],
    ['a pick of another server from the chat', { at: 'chat', live: LIVE }, { do: 'useServer', server: SERVER }],
    ['a pick of another server on a first run', FIRST_RUN, { do: 'useServer', server: SERVER }],
    ['a way of a connection that is no longer live', { at: 'chat', live: NEXT }, { do: 'via', live: { ...LIVE, target: LAN } }],
    ['a way in a fixture run', { at: 'pinned' }, { do: 'via', live: LIVE }]
  ])('refuses %s', (_what, from, event) => {
    expect(nextSetup(from, event)).toBeNull()
  })
})

/** One connection the owner opened: `target` is the first way of its server, and `arranged` each edit of its ways the route was handed. */
interface Opened {
  readonly target: Target
  closed: boolean
  disposed: boolean
  readonly commands: unknown[]
  readonly arranged: (readonly [ways: readonly Target[], pick: PickMode])[]
  /** Reports a dial of this connection's route, as the route does. */
  readonly pick: (picked: Picked) => void
  place?: string
}

/** The owner over a check the test settles by hand, and connections that only record what happened to them. */
type Answer = (command: unknown) => CommandOutcome<unknown> | Promise<CommandOutcome<unknown>>

function harness(loaded: Settings, save: () => Promise<void> = async () => {}, arm: () => Promise<void> = async () => {}) {
  let answer: Answer = () => ({ ok: true, value: undefined })
  let ids = 1
  const opened: Opened[] = []
  /** The first way of the current server at each save, and every server of each save. */
  const saved: Target[] = []
  const files: Servers[] = []
  const checks: { readonly target: Target; readonly signal: AbortSignal; step(step: CheckStep): void; end(result: CheckResult): void }[] = []
  const log: string[] = []
  const deps: ConnectionDeps = {
    loaded,
    save: async servers => {
      await save()
      saved.push(currentServer(servers).ways[0])
      files.push(servers)
      log.push('save')
    },
    newId: () => `server-${++ids}` as ServerId,
    check: (target, { signal, onStep }) => new Promise(resolve => void checks.push({ target, signal, step: onStep, end: resolve })),
    routeFor: ({ ways: [target] }, pick) => {
      const held: Opened = { target, closed: false, disposed: false, commands: [], arranged: [], pick }
      opened.push(held)
      log.push(`open ${opened.length}`)
      const dial = Object.assign(async () => { throw new Error('the test never dials') }, { held })
      const transcribe = async () => ({ ok: true as const, value: `heard by ${held.target.kind}` })
      return {
        dial, read: async path => ({ status: 200, body: { target, path } }), write: async ({ method, path }) => ({ status: 200, body: { target, method, path } }), transcribe,
        arrange: (ways, mode) => void held.arranged.push([ways, mode]),
        dispose: () => { held.disposed = true; log.push(`dispose ${opened.indexOf(held) + 1}`) }
      } satisfies PickedRoute
    },
    armIntro: async () => {
      log.push('arm')
      await arm()
    },
    open: (dial: Dialer, place: string) => {
      const { held } = dial as Dialer & { readonly held: Opened }
      held.place = place
      return {
        run: async (command: unknown) => {
          held.commands.push(command)
          return answer(command)
        },
        close: async () => { held.closed = true; log.push(`close ${opened.indexOf(held) + 1}`) }
      } as unknown as Hermes
    }
  }
  const owner = ownConnection(deps)
  const states: Setup[] = [owner.setup.get()]
  owner.setup.subscribe(setup => states.push(setup))
  const settled = () => new Promise(resolve => setImmediate(resolve))
  const pass = async () => {
    checks.at(-1)!.end({ ok: true })
    await settled()
  }
  const fail = async (failure: CheckFailure) => {
    checks.at(-1)!.end({ ok: false, failure })
    await settled()
  }
  const answerWith = (next: Answer) => { answer = next }
  return { owner, opened, saved, files, checks, states, log, pass, fail, settled, answerWith, at: () => owner.setup.get(), book: () => owner.servers.get() }
}

describe('ownConnection at launch', () => {
  it('goes straight to the chat on a saved target', () => {
    const { owner, opened, at } = harness(savedAt(REMOTE))
    expect(at()).toEqual({ at: 'chat', live: live(REMOTE, 1) })
    expect(opened.map(({ target }) => target)).toEqual([REMOTE])
    expect(owner.hermes).not.toBeNull()
  })

  it.each([
    [{ state: 'none' }, null], [{ state: 'unreadable' }, 'unreadable'], [{ state: 'newer' }, 'newer']
  ] as const)('opens the setup form on %j, connected to nothing', async (loaded, notice) => {
    const { owner, opened, at } = harness(loaded)
    expect(at()).toEqual({ at: 'form', live: null, notice })
    expect(opened).toEqual([])
    expect(owner.hermes).toBeNull()
    expect(await owner.run({ do: 'reconnect', start: true })).toMatchObject({ ok: false, refusal: { kind: 'offline' } })
    expect(await owner.transcribe(RECORDING)).toMatchObject({ ok: false, refusal: { kind: 'offline' } })
    await expect(owner.read('/api/plugins/kanban/board')).rejects.toThrow('No Hermes is connected.')
    await expect(owner.write({ method: 'POST', path: '/api/cron/jobs/a1/trigger', ms: 1000 })).rejects.toThrow('No Hermes is connected.')
  })
})

describe('ownConnection, checking a target', () => {
  it('shows each step, then saves, connects and shows the saved screen', async () => {
    const { owner, checks, saved, opened, states, log, pass, at } = harness({ state: 'none' })
    expect(await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })).toEqual({ ok: true, value: undefined })
    checks[0]!.step('tailscale')
    checks[0]!.step('peer')
    checks[0]!.step('ssh')
    await pass()
    expect(states.map(setup => (setup.at === 'checking' ? `checking ${setup.step}` : setup.at)))
      .toEqual(['form', 'checking tailscale', 'checking peer', 'checking ssh', 'checking save', 'saved'])
    expect(at()).toEqual({ at: 'saved', live: live(REMOTE, 1), from: 'first-run', into: 'replace' })
    expect(saved).toEqual([REMOTE])
    expect(opened.map(({ target }) => target)).toEqual([REMOTE])
    expect(log).toEqual(['arm', 'save', 'open 1'])

    await owner.run({ do: 'keepTarget' })
    expect(at()).toEqual({ at: 'chat', live: live(REMOTE, 1) })
  })

  it("opens each server's Hermes in a place of its own: the server's id, which a changed target never shares", async () => {
    const { owner, opened, pass } = harness(savedAt(LOCAL))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await pass()
    await owner.run({ do: 'checkTarget', target: LOCAL, into: 'replace' })
    await pass()
    expect(opened.map(({ place }) => place)).toEqual([SERVER, 'server-2', 'server-3'])
  })

  it('sends a chat command to the Hermes of the live connection', async () => {
    const { owner, opened } = harness(savedAt(LOCAL))
    await owner.run({ do: 'reconnect', start: false })
    expect(opened[0]!.commands).toEqual([{ do: 'reconnect', start: false }])
  })

  it('reads the HTTP API through the route of the live connection, which a switch replaces', async () => {
    const { owner, pass } = harness(savedAt(LOCAL))
    expect(await owner.read('/a')).toEqual({ status: 200, body: { target: LOCAL, path: '/a' } })
    expect(await owner.write({ method: 'PUT', path: '/a', ms: 1000 })).toEqual({ status: 200, body: { target: LOCAL, method: 'PUT', path: '/a' } })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await pass()
    expect(await owner.read('/b')).toEqual({ status: 200, body: { target: REMOTE, path: '/b' } })
  })

  it('keeps the live connection and saves nothing when the check fails', async () => {
    const { owner, saved, opened, fail, at } = harness(savedAt(LOCAL))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await fail('host-offline')
    expect(at()).toEqual({ at: 'failed', live: live(LOCAL, 1), target: REMOTE, into: 'replace', failure: 'host-offline' })
    expect(saved).toEqual([])
    expect(opened).toMatchObject([{ target: LOCAL, closed: false, disposed: false }])
  })

  it('switches in order: save, open the new connection, then close the old one and end its route', async () => {
    const { owner, opened, log, pass, at } = harness(savedAt(LOCAL))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await pass()
    expect(log).toEqual(['open 1', 'save', 'open 2', 'close 1', 'dispose 1'])
    expect(at()).toEqual({ at: 'saved', live: live(REMOTE, 2), from: 'settings', into: 'replace' })
    expect(opened).toMatchObject([{ target: LOCAL, closed: true, disposed: true }, { target: REMOTE, closed: false, disposed: false }])

    await owner.run({ do: 'reconnect', start: true })
    expect(opened[1]!.commands).toEqual([{ do: 'reconnect', start: true }])
    expect(opened[0]!.commands).toEqual([])
    expect(await owner.transcribe(RECORDING), 'speech goes to the new connection too').toEqual({ ok: true, value: 'heard by remote' })
  })

  it('does not switch when the target checked is the one already live', async () => {
    const { owner, opened, saved, pass, at } = harness(savedAt(REMOTE))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await pass()
    expect(at()).toEqual({ at: 'saved', live: live(REMOTE, 1), from: 'settings', into: 'replace' })
    expect(saved).toEqual([])
    expect(opened).toMatchObject([{ closed: false, disposed: false }])
  })

  it('switches from one gateway address to another, and not to the address already live', async () => {
    const here: Target = { kind: 'url', url: 'https://hermes.example.com' as GatewayUrl }
    const there: Target = { kind: 'url', url: 'https://hermes.example.com:8443' as GatewayUrl }
    const { owner, checks, saved, opened, states, pass, at } = harness(savedAt(here))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: { ...here }, into: 'replace' })
    expect(at()).toEqual({ at: 'checking', live: live(here, 1), target: here, into: 'replace', step: 'hermes' })
    await pass()
    expect([at(), saved, opened.length]).toEqual([{ at: 'saved', live: live(here, 1), from: 'settings', into: 'replace' }, [], 1])

    await owner.run({ do: 'keepTarget' })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: there, into: 'replace' })
    checks.at(-1)!.step('sign-in')
    checks.at(-1)!.step('gateway')
    await pass()
    expect(at()).toEqual({ at: 'saved', live: live(there, 2), from: 'settings', into: 'replace' })
    expect(saved).toEqual([there])
    expect(opened).toMatchObject([{ target: here, closed: true, disposed: true }, { target: there, closed: false, disposed: false }])
    expect(states.flatMap(setup => (setup.at === 'checking' && setup.target === there ? [setup.step] : []))).toEqual(['hermes', 'sign-in', 'gateway', 'save'])
  })

  it('retries the link of the live connection when the target checked is the one already live', async () => {
    const { owner, opened, pass } = harness(savedAt(REMOTE))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    expect(opened[0]!.commands).toEqual([])
    await pass()
    expect(opened[0]!.commands).toEqual([{ do: 'reconnect', start: false }])
  })

  it('fails with cant-save and saves nothing when the intro cannot be written', async () => {
    const { owner, saved, log, pass, at } = harness({ state: 'none' }, async () => {}, async () => { throw new Error('disk') })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await pass()
    expect(saved).toEqual([])
    expect(log).toEqual(['arm'])
    expect(at()).toEqual({ at: 'failed', live: null, target: REMOTE, into: 'replace', failure: 'cant-save' })
  })

  it('fails with cant-save and keeps the live connection when the save rejects', async () => {
    const { owner, opened, pass, at } = harness(savedAt(LOCAL), async () => { throw new Error('EACCES') })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await pass()
    expect(at()).toEqual({ at: 'failed', live: live(LOCAL, 1), target: REMOTE, into: 'replace', failure: 'cant-save' })
    expect(opened).toMatchObject([{ target: LOCAL, closed: false, disposed: false }])
  })

  it('aborts the check on Close and drops what it finds later', async () => {
    const { owner, checks, saved, opened, pass, at } = harness(savedAt(LOCAL))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await owner.run({ do: 'keepTarget' })
    expect(checks[0]!.signal.aborted).toBe(true)
    expect(at()).toEqual({ at: 'chat', live: live(LOCAL, 1) })

    checks[0]!.step('ssh')
    await pass()
    expect(at()).toEqual({ at: 'chat', live: live(LOCAL, 1) })
    expect(saved).toEqual([])
    expect(opened).toHaveLength(1)
  })

  it('stops a first run\'s wait for a sign-in, aborts the check and drops what it finds later', async () => {
    const { owner, checks, saved, opened, pass, at } = harness({ state: 'none' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    expect(await owner.run({ do: 'keepTarget' })).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(checks[0]!.signal.aborted).toBe(false)

    checks[0]!.step('sign-in')
    expect(await owner.run({ do: 'keepTarget' })).toEqual({ ok: true, value: undefined })
    expect(checks[0]!.signal.aborted).toBe(true)
    expect(at()).toEqual({ at: 'failed', live: null, target: REMOTE, into: 'replace', failure: 'sign-in-cancelled' })

    await pass()
    expect(at()).toEqual({ at: 'failed', live: null, target: REMOTE, into: 'replace', failure: 'sign-in-cancelled' })
    expect(saved).toEqual([])
    expect(opened).toEqual([])
  })

  it('aborts the check on Cancel, stays on the form and drops what it finds later', async () => {
    const { owner, checks, saved, opened, pass, at } = harness(savedAt(LOCAL))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    expect(await owner.run({ do: 'stopCheck' })).toEqual({ ok: true, value: undefined })
    expect(checks[0]!.signal.aborted).toBe(true)
    expect(at()).toEqual({ at: 'form', live: live(LOCAL, 1), notice: null })

    checks[0]!.step('ssh')
    await pass()
    expect(at()).toEqual({ at: 'form', live: live(LOCAL, 1), notice: null })
    expect(saved).toEqual([])
    expect(opened).toHaveLength(1)
  })

  it('goes back to the form on Cancel after a check failed', async () => {
    const { owner, fail, at } = harness(savedAt(LOCAL))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await fail('host-offline')
    await owner.run({ do: 'stopCheck' })
    expect(at()).toEqual({ at: 'form', live: live(LOCAL, 1), notice: null })
  })

  it('refuses Cancel while the target is being saved, and finishes the switch', async () => {
    let finishSave = () => {}
    const { owner, checks, pass, settled, at } = harness(savedAt(LOCAL), () => new Promise<void>(resolve => { finishSave = resolve }))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await pass()
    expect(at()).toMatchObject({ at: 'checking', step: 'save' })
    expect(await owner.run({ do: 'stopCheck' })).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(checks[0]!.signal.aborted).toBe(false)
    finishSave()
    await settled()
    expect(at()).toEqual({ at: 'saved', live: live(REMOTE, 2), from: 'settings', into: 'replace' })
  })

  it('stays in Settings after a save, where Close goes to the chat and Connect checks again', async () => {
    const { owner, checks, pass, at } = harness(savedAt(LOCAL))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await pass()
    expect(await owner.run({ do: 'checkTarget', target: OTHER, into: 'replace' })).toEqual({ ok: true, value: undefined })
    expect(at()).toEqual({ at: 'checking', live: live(REMOTE, 2), target: OTHER, into: 'replace', step: 'tailscale' })
    expect(checks).toHaveLength(2)

    await owner.run({ do: 'keepTarget' })
    expect(at()).toEqual({ at: 'chat', live: live(REMOTE, 2) })
    expect(checks[1]!.signal.aborted).toBe(true)
  })

  it('drops the steps of a check that a later check replaced', async () => {
    const { owner, checks, fail, at } = harness({ state: 'none' })
    await owner.run({ do: 'checkTarget', target: OTHER, into: 'replace' })
    await fail('host-not-found')
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    checks[0]!.step('hermes')
    expect(at()).toEqual({ at: 'checking', live: null, target: REMOTE, into: 'replace', step: 'tailscale' })
  })

  it('refuses a command the screen it is on has no use for, and changes nothing', async () => {
    const { owner, checks, at } = harness({ state: 'none' })
    expect(await owner.run({ do: 'keepTarget' })).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(at()).toEqual({ at: 'form', live: null, notice: null })
    expect(checks).toEqual([])
  })

  it('aborts a running check and ends the live connection on close, before the app that is quitting gets its promise back', async () => {
    const { owner, checks, opened } = harness(savedAt(REMOTE))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: OTHER, into: 'replace' })
    const closed = owner.close()
    expect(checks[0]!.signal.aborted).toBe(true)
    expect(opened).toMatchObject([{ closed: true, disposed: true }])
    await closed
  })

  it('opens nothing when the app closes while a save is still running, and refuses setup after close', async () => {
    let finishSave = () => {}
    const { owner, opened, pass, settled } = harness(savedAt(LOCAL), () => new Promise<void>(resolve => { finishSave = resolve }))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await pass()
    await owner.close()
    finishSave()
    await settled()
    expect(opened).toMatchObject([{ target: LOCAL, closed: true, disposed: true }])
    expect(await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
  })
})

describe('ownConnection, several ways in to one server', () => {
  const TIMES = [{ target: REMOTE, ms: 120 }, { target: LAN, ms: 15 }]
  /** Settings open on a server saved with the tailnet way, and the LAN way added by a check that passed. */
  const withTwoWays = async () => {
    const held = harness(savedAt(REMOTE))
    await held.owner.run({ do: 'editTarget' })
    await held.owner.run({ do: 'checkTarget', target: LAN, into: 'addWay' })
    await held.pass()
    return held
  }

  it('adds a way: saves it, hands it to the live route, and keeps the Hermes and its epoch', async () => {
    const { opened, files, log, at, book } = await withTwoWays()
    expect(at()).toEqual({ at: 'saved', live: { server: SERVER, target: REMOTE, epoch: 1 }, from: 'settings', into: 'addWay' })
    expect(log).toEqual(['open 1', 'save'])
    expect(opened).toMatchObject([{ closed: false, disposed: false, arranged: [[[REMOTE, LAN], 'fastest']] }])
    expect(files.at(-1)).toEqual({ list: [{ id: SERVER, name: 'hermes-host', ways: [REMOTE, LAN], pick: 'fastest' }], current: SERVER })
    expect(book()).toEqual({ list: files.at(-1)!.list, current: SERVER, times: [] })
  })

  it('names the way a dial landed on, with every time, and keeps the epoch', async () => {
    const { owner, opened, states, at, book } = await withTwoWays()
    await owner.run({ do: 'keepTarget' })
    opened[0]!.pick({ using: LAN, times: TIMES })
    expect(at()).toEqual({ at: 'chat', live: { server: SERVER, target: LAN, epoch: 1 } })
    expect(book().times).toEqual(TIMES)
    expect(await owner.read('/a'), 'the same route still reads').toMatchObject({ status: 200 })

    const before = states.length
    opened[0]!.pick({ using: LAN, times: [{ target: REMOTE, ms: null }, { target: LAN, ms: 12 }] })
    expect(states, 'the same way again is no new setup').toHaveLength(before)
    expect(book().times).toEqual([{ target: REMOTE, ms: null }, { target: LAN, ms: 12 }])
  })

  it('names the way in use on whatever screen Settings shows', async () => {
    const { owner, opened, at } = await withTwoWays()
    opened[0]!.pick({ using: LAN, times: TIMES })
    expect(at()).toMatchObject({ at: 'saved', live: { target: LAN, epoch: 1 } })
    await owner.run({ do: 'checkTarget', target: OTHER, into: 'addWay' })
    opened[0]!.pick({ using: REMOTE, times: TIMES })
    expect(at()).toMatchObject({ at: 'checking', target: OTHER, live: { target: REMOTE, epoch: 1 } })
  })

  it('drops what a route it has left says of its dials', async () => {
    const { owner, opened, pass, at, book } = await withTwoWays()
    await owner.run({ do: 'checkTarget', target: LOCAL, into: 'replace' })
    await pass()
    opened[0]!.pick({ using: LAN, times: TIMES })
    expect(at()).toMatchObject({ at: 'saved', live: { target: LOCAL, epoch: 2 } })
    expect(book().times).toEqual([])
  })

  it('only retries the link when the way checked is one the server already has', async () => {
    const { owner, opened, files, pass, at } = await withTwoWays()
    await owner.run({ do: 'checkTarget', target: LAN, into: 'addWay' })
    await pass()
    await owner.run({ do: 'checkTarget', target: LAN, into: 'replace' })
    await pass()
    expect(files).toHaveLength(1)
    expect(opened).toHaveLength(1)
    expect(opened[0]!.commands).toEqual([{ do: 'reconnect', start: false }, { do: 'reconnect', start: false }])
    expect(at()).toMatchObject({ at: 'saved', live: { server: SERVER, epoch: 1 }, into: 'replace' })
  })

  it('reorders the ways and sets the pick: saved, handed to the live route, with no new Hermes', async () => {
    const { owner, opened, files, states, at, book } = await withTwoWays()
    opened[0]!.pick({ using: LAN, times: TIMES })
    const before = states.length
    expect(await owner.run({ do: 'arrangeWays', ways: [LAN, REMOTE], pick: 'order' })).toEqual({ ok: true, value: undefined })
    expect(files.at(-1)!.list[0]).toMatchObject({ name: 'hermes-host', ways: [LAN, REMOTE], pick: 'order' })
    expect(opened).toHaveLength(1)
    expect(opened[0]!.arranged.at(-1)).toEqual([[LAN, REMOTE], 'order'])
    expect(states, 'the screen stays as it is').toHaveLength(before)
    expect(at()).toMatchObject({ at: 'saved', live: { target: LAN, epoch: 1 } })
    expect(book()).toMatchObject({ list: [{ ways: [LAN, REMOTE], pick: 'order' }], times: TIMES })
  })

  it('removes a way, and names the first way left when the one in use is gone', async () => {
    const { owner, opened, at, book } = await withTwoWays()
    opened[0]!.pick({ using: LAN, times: TIMES })
    await owner.run({ do: 'arrangeWays', ways: [REMOTE], pick: 'fastest' })
    expect(opened[0]!.arranged.at(-1)).toEqual([[REMOTE], 'fastest'])
    expect(at()).toMatchObject({ live: { server: SERVER, target: REMOTE, epoch: 1 } })
    expect(book()).toMatchObject({ list: [{ ways: [REMOTE] }], times: [{ target: REMOTE, ms: 120 }] })
  })

  it.each([
    ['a way the server does not have', { do: 'arrangeWays', ways: [REMOTE, OTHER], pick: 'fastest' }],
    ['no way left', { do: 'arrangeWays', ways: [], pick: 'fastest' }]
  ] as const)('refuses %s, and saves nothing', async (_what, command) => {
    const { owner, opened, files } = await withTwoWays()
    expect(await owner.run(command)).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(files).toHaveLength(1)
    expect(opened[0]!.arranged).toHaveLength(1)
  })

  it('refuses an edit of the ways while a check runs, from the chat, and on a first run', async () => {
    const arrange = { do: 'arrangeWays', ways: [LAN, REMOTE], pick: 'order' } as const
    const { owner, files } = await withTwoWays()
    await owner.run({ do: 'checkTarget', target: OTHER, into: 'addWay' })
    expect(await owner.run(arrange)).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    await owner.run({ do: 'keepTarget' })
    expect(await owner.run(arrange)).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(files).toHaveLength(1)
    expect(await harness({ state: 'none' }).owner.run(arrange)).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
  })

  it('refuses to add a way on a first run, which has no server to add it to', async () => {
    const { owner, checks } = harness({ state: 'none' })
    expect(await owner.run({ do: 'checkTarget', target: LAN, into: 'addWay' })).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(checks).toEqual([])
  })

  it('says the change was not saved when the save rejects, and changes nothing', async () => {
    let fail = false
    const held = harness(savedAt(REMOTE), async () => { if (fail) throw new Error('EACCES') })
    await held.owner.run({ do: 'editTarget' })
    await held.owner.run({ do: 'checkTarget', target: LAN, into: 'addWay' })
    await held.pass()
    fail = true
    expect(await held.owner.run({ do: 'arrangeWays', ways: [LAN], pick: 'order' })).toMatchObject({ ok: false, refusal: { message: expect.stringContaining("couldn't save") } })
    expect(held.opened[0]!.arranged).toHaveLength(1)
    expect(held.book()).toMatchObject({ list: [{ ways: [REMOTE, LAN], pick: 'fastest' }] })
  })
})

describe('ownConnection, several servers', () => {
  const SECOND = 'server-2' as ServerId
  /** Settings open on two saved servers: the first on the tailnet machine, and this computer, added by a check that passed and now current. */
  const withTwoServers = async (save?: () => Promise<void>) => {
    const held = harness(savedAt(REMOTE), save)
    await held.owner.run({ do: 'editTarget' })
    await held.owner.run({ do: 'checkTarget', target: LOCAL, into: 'addServer' })
    await held.pass()
    return held
  }

  it('adds a server: saves it beside the first, and moves to it as a new connection', async () => {
    const { opened, files, log, at, book } = await withTwoServers()
    expect(at()).toEqual({ at: 'saved', live: { server: SECOND, target: LOCAL, epoch: 2 }, from: 'settings', into: 'addServer' })
    expect(log).toEqual(['open 1', 'save', 'open 2', 'close 1', 'dispose 1'])
    expect(opened.map(({ place }) => place)).toEqual([SERVER, SECOND])
    expect(files.at(-1)).toMatchObject({ list: [{ id: SERVER, name: 'hermes-host', ways: [REMOTE] }, { id: SECOND, name: 'This computer', ways: [LOCAL] }], current: SECOND })
    expect(book()).toEqual({ list: files.at(-1)!.list, current: SECOND, times: [] })
  })

  it('adds a server for a target the current server already reaches, since it is asked for as another server', async () => {
    const { owner, files, pass, at } = await withTwoServers()
    await owner.run({ do: 'checkTarget', target: LOCAL, into: 'addServer' })
    await pass()
    expect(files.at(-1)!.list).toHaveLength(3)
    expect(at()).toMatchObject({ live: { server: 'server-3', epoch: 3 } })
  })

  it('switches to a picked server: saves the pick, opens it in its own place under a new epoch, then closes the old one', async () => {
    const { owner, opened, files, log, at, book } = await withTwoServers()
    log.length = 0
    expect(await owner.run({ do: 'useServer', server: SERVER })).toEqual({ ok: true, value: undefined })
    expect(log).toEqual(['save', 'open 3', 'close 2', 'dispose 2'])
    expect(at()).toEqual({ at: 'saved', live: { server: SERVER, target: REMOTE, epoch: 3 }, from: 'settings', into: 'replace' })
    expect(opened[2]).toMatchObject({ target: REMOTE, place: SERVER, closed: false })
    expect(files.at(-1)!.current).toBe(SERVER)
    expect(book().current).toBe(SERVER)
    expect(await owner.read('/a')).toEqual({ status: 200, body: { target: REMOTE, path: '/a' } })
  })

  it('moves the chat to the picked server when Settings closed while the pick was saved', async () => {
    let finishSave = () => {}
    let held = false
    const { owner, settled, at } = await withTwoServers(() => (held ? new Promise<void>(resolve => { finishSave = resolve }) : Promise.resolve()))
    held = true
    const picked = owner.run({ do: 'useServer', server: SERVER })
    await settled()
    await owner.run({ do: 'keepTarget' })
    finishSave()
    expect(await picked).toEqual({ ok: true, value: undefined })
    expect(at()).toEqual({ at: 'chat', live: { server: SERVER, target: REMOTE, epoch: 3 } })
  })

  it('changes nothing for a pick of the server already in use', async () => {
    const { owner, opened, files, at } = await withTwoServers()
    expect(await owner.run({ do: 'useServer', server: SECOND })).toEqual({ ok: true, value: undefined })
    expect([files.length, opened.length]).toEqual([1, 2])
    expect(at()).toMatchObject({ live: { server: SECOND, epoch: 2 }, into: 'addServer' })
  })

  it('removes another server, and keeps the connection', async () => {
    const { owner, opened, files, at, book } = await withTwoServers()
    expect(await owner.run({ do: 'removeServer', server: SERVER })).toEqual({ ok: true, value: undefined })
    expect(files.at(-1)).toMatchObject({ list: [{ id: SECOND }], current: SECOND })
    expect(book().list.map(({ id }) => id)).toEqual([SECOND])
    expect(opened).toHaveLength(2)
    expect(at()).toMatchObject({ live: { server: SECOND, epoch: 2 } })
  })

  it.each([
    ['a pick of a server that is not saved', { do: 'useServer', server: 'gone' as ServerId }],
    ['the removal of the server in use', { do: 'removeServer', server: SECOND }],
    ['the removal of a server that is not saved', { do: 'removeServer', server: 'gone' as ServerId }]
  ] as const)('refuses %s, and saves nothing', async (_what, command) => {
    const { owner, opened, files } = await withTwoServers()
    expect(await owner.run(command)).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect([files.length, opened.length]).toEqual([1, 2])
  })

  it.each([
    ['a pick', { do: 'useServer', server: SERVER }],
    ['a removal', { do: 'removeServer', server: SERVER }]
  ] as const)('refuses %s while a check runs, and from the chat', async (_what, command) => {
    const { owner, files, at } = await withTwoServers()
    await owner.run({ do: 'checkTarget', target: OTHER, into: 'replace' })
    expect(await owner.run(command)).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(at()).toMatchObject({ at: 'checking', live: { server: SECOND } })
    await owner.run({ do: 'keepTarget' })
    expect(await owner.run(command)).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(files).toHaveLength(1)
  })

  it('takes one edit at a time: a second edit or a check is refused while the first is being saved', async () => {
    let finishSave = () => {}
    let held = false
    const { owner, checks, opened, at } = await withTwoServers(() => (held ? new Promise<void>(resolve => { finishSave = resolve }) : Promise.resolve()))
    held = true
    const picked = owner.run({ do: 'useServer', server: SERVER })
    expect(await owner.run({ do: 'removeServer', server: SERVER })).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(await owner.run({ do: 'checkTarget', target: OTHER, into: 'replace' })).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(checks).toHaveLength(1)
    finishSave()
    await picked
    expect(at()).toMatchObject({ at: 'saved', live: { server: SERVER, epoch: 3 } })
    expect(opened).toHaveLength(3)
  })

  it('says the pick was not saved when the save rejects, and stays on the server in use', async () => {
    let fail = false
    const { owner, opened, at, book } = await withTwoServers(async () => { if (fail) throw new Error('EACCES') })
    fail = true
    expect(await owner.run({ do: 'useServer', server: SERVER })).toMatchObject({ ok: false, refusal: { message: expect.stringContaining("couldn't save") } })
    expect(opened).toMatchObject([{ closed: true }, { closed: false, disposed: false }])
    expect(at()).toMatchObject({ live: { server: SECOND, epoch: 2 } })
    expect(book().current).toBe(SECOND)
    fail = false
    expect(await owner.run({ do: 'useServer', server: SERVER }), 'a later pick is taken').toEqual({ ok: true, value: undefined })
  })

  it('opens nothing when the app closes while a pick is still being saved', async () => {
    let finishSave = () => {}
    let held = false
    const { owner, opened } = await withTwoServers(() => (held ? new Promise<void>(resolve => { finishSave = resolve }) : Promise.resolve()))
    held = true
    const picked = owner.run({ do: 'useServer', server: SERVER })
    await owner.close()
    finishSave()
    expect(await picked).toMatchObject({ ok: false })
    expect(opened).toHaveLength(2)
    expect(opened[1]).toMatchObject({ closed: true, disposed: true })
  })
})

describe('ownConnection, opening a chat while Settings is up', () => {
  const opening = (sessionId: string) => ({ do: 'open', ref: { kind: 'chat', sessionId: sessionId as SessionId } }) as const
  const LINKED = { do: 'open', ref: { kind: 'link', sessionId: 'local-0001' } }
  const holdSave = () => {
    let settle: { resolve(): void; reject(error: Error): void } = { resolve: () => {}, reject: () => {} }
    return {
      save: () => new Promise<void>((resolve, reject) => { settle = { resolve, reject } }),
      finish: () => settle.resolve(),
      fail: () => settle.reject(new Error('EACCES'))
    }
  }

  it('closes Settings, aborts its check, and opens', async () => {
    const { owner, checks, opened, at } = harness(savedAt(LOCAL))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    expect(await owner.run(opening('s1'))).toEqual({ ok: true, value: undefined })
    expect(at()).toEqual({ at: 'chat', live: live(LOCAL, 1) })
    expect(checks[0]!.signal.aborted).toBe(true)
    expect(opened[0]!.commands).toEqual([opening('s1')])
  })

  it('closes Settings after a save, and opens on the new connection', async () => {
    const { owner, opened, pass, at } = harness(savedAt(LOCAL))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await pass()
    await owner.run(opening('s1'))
    expect(at()).toEqual({ at: 'chat', live: live(REMOTE, 2) })
    expect(opened[1]!.commands).toEqual([opening('s1')])
  })

  it('refuses an open at the save step, and changes nothing', async () => {
    const held = holdSave()
    const { owner, checks, opened, states, pass, settled, at } = harness(savedAt(LOCAL), held.save)
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await pass()
    const before = states.length
    expect(await owner.run(opening('s1'))).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(states).toHaveLength(before)
    expect(checks[0]!.signal.aborted).toBe(false)
    expect(opened[0]!.commands).toEqual([])
    held.finish()
    await settled()
    expect(at()).toEqual({ at: 'saved', live: live(REMOTE, 2), from: 'settings', into: 'replace' })
  })

  it('just opens from the chat', async () => {
    const { owner, opened, states } = harness(savedAt(LOCAL))
    expect(await owner.run(opening('s1'))).toEqual({ ok: true, value: undefined })
    expect(states).toEqual([{ at: 'chat', live: live(LOCAL, 1) }])
    expect(opened[0]!.commands).toEqual([opening('s1')])
  })

  it('runs two opens sent together from Settings, so the second one shows', async () => {
    const { owner, opened, at } = harness(savedAt(LOCAL))
    await owner.run({ do: 'editTarget' })
    const outcomes = await Promise.all([owner.run(opening('s1')), owner.run(opening('s2'))])
    expect(outcomes).toEqual([{ ok: true, value: undefined }, { ok: true, value: undefined }])
    expect(at()).toEqual({ at: 'chat', live: live(LOCAL, 1) })
    expect(opened[0]!.commands).toEqual([opening('s1'), opening('s2')])
  })

  const RAE = 'rae' as BotId
  const SIDEBAR_OPENS = [
    ["the bot menu's Open chat", { do: 'open', ref: { kind: 'bot', bot: RAE } }],
    ["the bot menu's New chat", { do: 'open', ref: { kind: 'new', bot: RAE, draftId: 'd1' }, upFront: true }],
    ["a group chat's row", { do: 'open', ref: { kind: 'group', group: 'launch-plan' as GroupId } }]
  ] as const

  it.each(SIDEBAR_OPENS)('closes Settings for %s, aborts its check, and opens', async (_item, command) => {
    const { owner, checks, opened, at } = harness(savedAt(LOCAL))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    expect(await owner.run(command)).toEqual({ ok: true, value: undefined })
    expect(at()).toEqual({ at: 'chat', live: live(LOCAL, 1) })
    expect(checks[0]!.signal.aborted).toBe(true)
    expect(opened[0]!.commands).toEqual([command])
  })

  it.each(SIDEBAR_OPENS)('refuses %s at the save step, and changes nothing', async (_item, command) => {
    const held = holdSave()
    const { owner, opened, states, pass, at } = harness(savedAt(LOCAL), held.save)
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await pass()
    const before = states.length
    expect(await owner.run(command)).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(states).toHaveLength(before)
    expect(opened[0]!.commands).toEqual([])
    expect(at()).toMatchObject({ at: 'checking', step: 'save' })
  })

  it('pins a bot and reads the bots again on focus with Settings left up, its check running, even at the save step', async () => {
    const held = holdSave()
    const { owner, checks, opened, pass, settled, at } = harness(savedAt(LOCAL), held.save)
    const focus = new Set<() => void>()
    refreshBotsOnFocus({ on: (_: 'browser-window-focus', listener: () => void) => focus.add(listener), off: () => {} }, owner)
    const mark = { do: 'markBot', bot: RAE, mark: 'pin' } as const
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    expect(await owner.run(mark)).toEqual({ ok: true, value: undefined })
    for (const refresh of focus) refresh()
    await settled()
    expect(at()).toMatchObject({ at: 'checking', step: 'tailscale' })
    expect(checks[0]!.signal.aborted).toBe(false)

    await pass()
    expect(at()).toMatchObject({ at: 'checking', step: 'save' })
    for (const refresh of focus) refresh()
    await settled()
    expect(opened[0]!.commands).toEqual([mark, { do: 'refreshBots' }, { do: 'refreshBots' }])
  })

  const MAKES = [
    ['a bot', { do: 'createBot', draft: { name: 'Rae', description: '', model: null, persona: '' }, picture: null }],
    ['a bot made from a template', { do: 'createFromTemplate', template: 'bot-builder', answers: { name: 'Builder', folder: '', time: '' }, picture: 'data:image/png;base64,iVBORw0KGgo=' }],
    ['a group chat', { do: 'createGroup', draft: { group: 'launch-plan' as GroupId, name: 'Launch plan', bots: [RAE] } }]
  ] as const

  it.each(MAKES)('closes Settings for %s made from the sidebar, which the hub opens, once Hermes has made it', async (_made, create) => {
    const { owner, opened, answerWith, settled, at } = harness(savedAt(LOCAL))
    let made = () => {}
    answerWith(() => new Promise(resolve => { made = () => resolve({ ok: true, value: undefined }) }))
    await owner.run({ do: 'editTarget' })
    const outcome = owner.run(create)
    await settled()
    expect(at(), 'Hermes is still making it').toEqual({ at: 'form', live: live(LOCAL, 1), notice: null })
    made()
    expect(await outcome).toEqual({ ok: true, value: undefined })
    expect(at()).toEqual({ at: 'chat', live: live(LOCAL, 1) })
    expect(opened[0]!.commands).toEqual([create])
  })

  it.each(MAKES)('keeps Settings up when Hermes refuses %s made from the sidebar', async (_made, create) => {
    const { owner, opened, answerWith, at } = harness(savedAt(LOCAL))
    const taken = { ok: false, refusal: { kind: 'rejected', message: 'A bot called Rae already exists.', field: 'name' } } as const
    answerWith(() => taken)
    await owner.run({ do: 'editTarget' })
    expect(await owner.run(create)).toEqual(taken)
    expect(at()).toEqual({ at: 'form', live: LIVE, notice: null })
    expect(opened[0]!.commands).toEqual([create])
  })

  it.each(MAKES)('stops a running check before it makes %s, so it lands on the live machine, and closes Settings there', async (_made, create) => {
    const { owner, checks, opened, answerWith, pass, settled, at } = harness(savedAt(LOCAL))
    let made = () => {}
    answerWith(() => new Promise(resolve => { made = () => resolve({ ok: true, value: undefined }) }))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    const outcome = owner.run(create)
    await settled()
    expect(checks[0]!.signal.aborted).toBe(true)
    expect(at(), 'Settings stays up, on the live connection').toEqual({ at: 'form', live: LIVE, notice: null })
    await pass()
    expect(opened, 'the stopped check switches nothing').toHaveLength(1)
    made()
    expect(await outcome).toEqual({ ok: true, value: undefined })
    expect(at()).toEqual({ at: 'chat', live: LIVE })
    expect(opened[0]!.commands).toEqual([create])
  })

  it.each(MAKES)("leaves a new connection's confirmation up for %s Hermes made on the connection it replaced", async (_made, create) => {
    const { owner, opened, answerWith, pass, at } = harness(savedAt(LOCAL))
    let made = () => {}
    answerWith(() => new Promise(resolve => { made = () => resolve({ ok: true, value: undefined }) }))
    await owner.run({ do: 'editTarget' })
    const outcome = owner.run(create)
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await pass()
    expect(at()).toEqual({ at: 'saved', live: NEXT, from: 'settings', into: 'replace' })
    made()
    expect(await outcome).toEqual({ ok: true, value: undefined })
    expect(at()).toEqual({ at: 'saved', live: NEXT, from: 'settings', into: 'replace' })
    expect(opened.map(({ commands }) => commands)).toEqual([[create], []])
  })

  it.each(MAKES)('refuses %s at the save step without asking Hermes, and changes nothing', async (_made, create) => {
    const held = holdSave()
    const { owner, opened, states, pass } = harness(savedAt(LOCAL), held.save)
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await pass()
    const before = states.length
    expect(await owner.run(create)).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(states).toHaveLength(before)
    expect(opened[0]!.commands).toEqual([])
  })

  it('closes Settings on a failed check for an open from a notification', async () => {
    const { owner, opened, fail, at } = harness(savedAt(LOCAL))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await fail('host-offline')
    await owner.run(opening('s1'))
    expect(at()).toEqual({ at: 'chat', live: live(LOCAL, 1) })
    expect(opened[0]!.commands).toEqual([opening('s1')])
  })

  it('closes Settings for a chat link, and holds one that comes during a save until the save ends', async () => {
    const held = holdSave()
    const { owner, opened, pass, settled, at } = harness(savedAt(LOCAL), held.save)
    const links = chatLinks()
    links.serve(owner, feed(OFF), () => {})
    await owner.run({ do: 'editTarget' })
    links.holdLatest(['highwing://chat/local-0001'])
    expect(at()).toEqual({ at: 'chat', live: live(LOCAL, 1) })
    expect(opened[0]!.commands).toEqual([LINKED])

    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await pass()
    links.holdLatest(['highwing://chat/local-0001'])
    expect(at()).toMatchObject({ at: 'checking', step: 'save' })
    expect(opened[0]!.commands).toEqual([LINKED])
    held.finish()
    await settled()
    expect(at()).toEqual({ at: 'chat', live: live(REMOTE, 2) })
    expect(opened[1]!.commands).toEqual([LINKED])
  })

  it.each([
    ['passes', 'finish', live(REMOTE, 2), 1],
    ['fails', 'fail', live(LOCAL, 1), 0]
  ] as const)('ends a window that watches after the links on the chat, for a link held through a save that %s', async (_what, end, live, connection) => {
    const held = holdSave()
    const { owner, opened, pass, settled, at } = harness(savedAt(LOCAL), held.save)
    const links = chatLinks()
    links.serve(owner, feed(OFF), () => {})
    const window: Setup[] = []
    owner.setup.subscribe(setup => window.push(setup))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE, into: 'replace' })
    await pass()
    links.holdLatest(['highwing://chat/local-0001'])
    held[end]()
    await settled()
    expect(at()).toEqual({ at: 'chat', live })
    expect(window.at(-1)).toEqual({ at: 'chat', live })
    expect(opened[connection]!.commands).toEqual([LINKED])
  })
})

describe('feed', () => {
  it('ends every listener on the newest value when a listener sets it again', () => {
    const screen = feed('form')
    const seen: string[][] = [[], [], []]
    screen.subscribe(next => void seen[0]!.push(next))
    screen.subscribe(next => {
      seen[1]!.push(next)
      if (next === 'saved') screen.set('chat')
    })
    screen.subscribe(next => void seen[2]!.push(next))
    screen.set('saved')
    expect(screen.get()).toBe('chat')
    expect(seen).toEqual([['saved', 'chat'], ['saved', 'chat'], ['chat']])
  })
})

describe('pinnedConnection', () => {
  it('has no setup, and passes chat commands to its Hermes', async () => {
    const commands: unknown[] = []
    const hermes = { run: async (command: unknown) => { commands.push(command); return { ok: true, value: undefined } }, close: async () => {} } as unknown as Hermes
    const read = async () => ({ status: 200, body: 'board' })
    const write = async () => ({ status: 200, body: 'saved' })
    const owner = pinnedConnection(hermes, read, write, async () => ({ ok: true, value: 'heard by the fixture' }))
    expect(owner.read).toBe(read)
    expect(owner.write).toBe(write)
    expect(owner.setup.get()).toEqual({ at: 'pinned' })
    expect(await owner.transcribe(RECORDING)).toEqual({ ok: true, value: 'heard by the fixture' })
    expect(await owner.run({ do: 'checkTarget', target: LOCAL, into: 'replace' })).toMatchObject({ ok: false })
    await owner.run({ do: 'reconnect', start: false })
    expect(commands).toEqual([{ do: 'reconnect', start: false }])
  })
})

describe('the bots on window focus', () => {
  it('are read again each time a window gains focus, until the app stops listening', () => {
    const listeners = new Set<() => void>()
    const app = { on: (_: 'browser-window-focus', listener: () => void) => listeners.add(listener), off: (_: 'browser-window-focus', listener: () => void) => listeners.delete(listener) }
    const sent: unknown[] = []
    const stop = refreshBotsOnFocus(app, { run: async command => { sent.push(command); return { ok: true, value: undefined } as never } })
    for (const listener of listeners) listener()
    for (const listener of listeners) listener()
    expect(sent).toEqual([{ do: 'refreshBots' }, { do: 'refreshBots' }])
    stop()
    expect(listeners.size).toBe(0)
  })
})
