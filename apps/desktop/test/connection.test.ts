import type { CheckResult, Dialer, Hermes, Route } from '@highwing/hermes'
import type { CheckFailure, CheckStep, SshHost, Target } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import type { Live, Setup } from '../src/ipc-contract'
import { nextSetup, ownConnection, pinnedConnection, type ConnectionDeps, type SetupEvent } from '../src/main/connection'
import type { Settings } from '../src/main/settings'

const REMOTE: Target = { kind: 'remote', host: 'hermes-host.example-tailnet.ts.net' as SshHost }
const OTHER: Target = { kind: 'remote', host: 'other-host' as SshHost }
const LOCAL: Target = { kind: 'local' }
const LIVE: Live = { target: LOCAL, epoch: 1 }
const NEXT: Live = { target: REMOTE, epoch: 2 }

describe('nextSetup', () => {
  const EDITING: Setup = { at: 'form', live: LIVE, notice: null }
  const FIRST_RUN: Setup = { at: 'form', live: null, notice: 'newer' }
  const CHECKING: Setup = { at: 'checking', live: LIVE, target: REMOTE, step: 'tailscale' }
  const SAVING: Setup = { ...CHECKING, step: 'save' }
  const FAILED: Setup = { at: 'failed', live: null, target: REMOTE, failure: 'host-not-found' }
  const SAVED: Setup = { at: 'saved', live: NEXT }

  it.each<[string, Setup, SetupEvent, Setup]>([
    ['the Connection button opens the form over the chat', { at: 'chat', live: LIVE }, { do: 'editTarget' }, EDITING],
    ['a remote check starts at Tailscale', EDITING, { do: 'checkTarget', target: REMOTE }, CHECKING],
    ['a check of this computer starts at Hermes', FIRST_RUN, { do: 'checkTarget', target: LOCAL }, { at: 'checking', live: null, target: LOCAL, step: 'hermes' }],
    ['a check moves to its next step', CHECKING, { do: 'step', step: 'ssh' }, { ...CHECKING, step: 'ssh' }],
    ['a step fails', CHECKING, { do: 'fail', failure: 'ssh-denied' }, { at: 'failed', live: LIVE, target: REMOTE, failure: 'ssh-denied' }],
    ['a save fails', SAVING, { do: 'fail', failure: 'cant-save' }, { at: 'failed', live: LIVE, target: REMOTE, failure: 'cant-save' }],
    ['a check passes and is saved', SAVING, { do: 'connect', live: NEXT }, SAVED],
    ['a failed target is checked again', FAILED, { do: 'checkTarget', target: OTHER }, { at: 'checking', live: null, target: OTHER, step: 'tailscale' }],
    ['Cancel leaves the form for the chat', EDITING, { do: 'keepTarget' }, { at: 'chat', live: LIVE }],
    ['Cancel leaves a running check for the chat', CHECKING, { do: 'keepTarget' }, { at: 'chat', live: LIVE }],
    ['Cancel leaves a failure for the chat', { ...FAILED, live: LIVE }, { do: 'keepTarget' }, { at: 'chat', live: LIVE }],
    ['Open chat leaves the saved screen', SAVED, { do: 'openChat' }, { at: 'chat', live: NEXT }]
  ])('%s', (_what, from, event, to) => {
    expect(nextSetup(from, event)).toEqual(to)
  })

  it.each<[string, Setup, SetupEvent]>([
    ['Cancel with no connection to go back to', FIRST_RUN, { do: 'keepTarget' }],
    ['Cancel of a failure with no connection to go back to', FAILED, { do: 'keepTarget' }],
    ['Cancel while the target is being saved', SAVING, { do: 'keepTarget' }],
    ['a second check while one runs', CHECKING, { do: 'checkTarget', target: OTHER }],
    ['a check from the chat', { at: 'chat', live: LIVE }, { do: 'checkTarget', target: REMOTE }],
    ['Open chat before anything is saved', EDITING, { do: 'openChat' }],
    ['a step when no check runs', EDITING, { do: 'step', step: 'ssh' }],
    ['a result when no check runs', FAILED, { do: 'connect', live: NEXT }],
    ['the Connection button on the saved screen', SAVED, { do: 'editTarget' }],
    ['the Connection button in a fixture run', { at: 'pinned' }, { do: 'editTarget' }],
    ['a check in a fixture run', { at: 'pinned' }, { do: 'checkTarget', target: LOCAL }]
  ])('refuses %s', (_what, from, event) => {
    expect(nextSetup(from, event)).toBeNull()
  })
})

interface Opened { readonly target: Target; closed: boolean; disposed: boolean; readonly commands: unknown[] }

/** The owner over a check the test settles by hand, and connections that only record what happened to them. */
function harness(loaded: Settings, save: (target: Target) => Promise<void> = async () => {}) {
  const opened: Opened[] = []
  const saved: Target[] = []
  const checks: { readonly target: Target; readonly signal: AbortSignal; step(step: CheckStep): void; end(result: CheckResult): void }[] = []
  const log: string[] = []
  const deps: ConnectionDeps = {
    loaded,
    save: async target => {
      await save(target)
      saved.push(target)
      log.push('save')
    },
    check: (target, { signal, onStep }) => new Promise(resolve => void checks.push({ target, signal, step: onStep, end: resolve })),
    routeFor: target => {
      const held: Opened = { target, closed: false, disposed: false, commands: [] }
      opened.push(held)
      log.push(`open ${opened.length}`)
      const dial = Object.assign(async () => { throw new Error('the test never dials') }, { held })
      return { dial, dispose: () => { held.disposed = true; log.push(`dispose ${opened.indexOf(held) + 1}`) } } satisfies Route
    },
    open: (dial: Dialer) => {
      const { held } = dial as Dialer & { readonly held: Opened }
      return {
        run: async (command: unknown) => {
          held.commands.push(command)
          return { ok: true, value: undefined }
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
  return { owner, opened, saved, checks, states, log, pass, fail, settled, at: () => owner.setup.get() }
}

describe('ownConnection at launch', () => {
  it('goes straight to the chat on a saved target', () => {
    const { owner, opened, at } = harness({ state: 'saved', target: REMOTE })
    expect(at()).toEqual({ at: 'chat', live: { target: REMOTE, epoch: 1 } })
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
  })
})

describe('ownConnection, checking a target', () => {
  it('shows each step, then saves, connects and shows the saved screen', async () => {
    const { owner, checks, saved, opened, states, pass, at } = harness({ state: 'none' })
    expect(await owner.run({ do: 'checkTarget', target: REMOTE })).toEqual({ ok: true, value: undefined })
    checks[0]!.step('tailscale')
    checks[0]!.step('peer')
    checks[0]!.step('ssh')
    await pass()
    expect(states.map(setup => (setup.at === 'checking' ? `checking ${setup.step}` : setup.at)))
      .toEqual(['form', 'checking tailscale', 'checking peer', 'checking ssh', 'checking save', 'saved'])
    expect(at()).toEqual({ at: 'saved', live: { target: REMOTE, epoch: 1 } })
    expect(saved).toEqual([REMOTE])
    expect(opened.map(({ target }) => target)).toEqual([REMOTE])

    await owner.run({ do: 'openChat' })
    expect(at()).toEqual({ at: 'chat', live: { target: REMOTE, epoch: 1 } })
  })

  it('sends a chat command to the Hermes of the live connection', async () => {
    const { owner, opened } = harness({ state: 'saved', target: LOCAL })
    await owner.run({ do: 'reconnect', start: false })
    expect(opened[0]!.commands).toEqual([{ do: 'reconnect', start: false }])
  })

  it('keeps the live connection and saves nothing when the check fails', async () => {
    const { owner, saved, opened, fail, at } = harness({ state: 'saved', target: LOCAL })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await fail('host-offline')
    expect(at()).toEqual({ at: 'failed', live: { target: LOCAL, epoch: 1 }, target: REMOTE, failure: 'host-offline' })
    expect(saved).toEqual([])
    expect(opened).toMatchObject([{ target: LOCAL, closed: false, disposed: false }])
  })

  it('switches in order: save, open the new connection, then close the old one and end its route', async () => {
    const { owner, opened, log, pass, at } = harness({ state: 'saved', target: LOCAL })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await pass()
    expect(log).toEqual(['open 1', 'save', 'open 2', 'close 1', 'dispose 1'])
    expect(at()).toEqual({ at: 'saved', live: { target: REMOTE, epoch: 2 } })
    expect(opened).toMatchObject([{ target: LOCAL, closed: true, disposed: true }, { target: REMOTE, closed: false, disposed: false }])

    await owner.run({ do: 'reconnect', start: true })
    expect(opened[1]!.commands).toEqual([{ do: 'reconnect', start: true }])
    expect(opened[0]!.commands).toEqual([])
  })

  it('does not switch when the target checked is the one already live', async () => {
    const { owner, opened, saved, pass, at } = harness({ state: 'saved', target: REMOTE })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await pass()
    expect(at()).toEqual({ at: 'saved', live: { target: REMOTE, epoch: 1 } })
    expect(saved).toEqual([])
    expect(opened).toMatchObject([{ closed: false, disposed: false }])
  })

  it('fails with cant-save and keeps the live connection when the save rejects', async () => {
    const { owner, opened, pass, at } = harness({ state: 'saved', target: LOCAL }, async () => { throw new Error('EACCES') })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await pass()
    expect(at()).toEqual({ at: 'failed', live: { target: LOCAL, epoch: 1 }, target: REMOTE, failure: 'cant-save' })
    expect(opened).toMatchObject([{ target: LOCAL, closed: false, disposed: false }])
  })

  it('aborts the check on Cancel and drops what it finds later', async () => {
    const { owner, checks, saved, opened, pass, at } = harness({ state: 'saved', target: LOCAL })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await owner.run({ do: 'keepTarget' })
    expect(checks[0]!.signal.aborted).toBe(true)
    expect(at()).toEqual({ at: 'chat', live: { target: LOCAL, epoch: 1 } })

    checks[0]!.step('ssh')
    await pass()
    expect(at()).toEqual({ at: 'chat', live: { target: LOCAL, epoch: 1 } })
    expect(saved).toEqual([])
    expect(opened).toHaveLength(1)
  })

  it('drops the steps of a check that a later check replaced', async () => {
    const { owner, checks, fail, at } = harness({ state: 'none' })
    await owner.run({ do: 'checkTarget', target: OTHER })
    await fail('host-not-found')
    await owner.run({ do: 'checkTarget', target: REMOTE })
    checks[0]!.step('hermes')
    expect(at()).toEqual({ at: 'checking', live: null, target: REMOTE, step: 'tailscale' })
  })

  it('refuses a command the screen it is on has no use for, and changes nothing', async () => {
    const { owner, checks, at } = harness({ state: 'none' })
    expect(await owner.run({ do: 'keepTarget' })).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(await owner.run({ do: 'openChat' })).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(at()).toEqual({ at: 'form', live: null, notice: null })
    expect(checks).toEqual([])
  })

  it('aborts a running check and ends the live connection on close, before the app that is quitting gets its promise back', async () => {
    const { owner, checks, opened } = harness({ state: 'saved', target: REMOTE })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: OTHER })
    const closed = owner.close()
    expect(checks[0]!.signal.aborted).toBe(true)
    expect(opened).toMatchObject([{ closed: true, disposed: true }])
    await closed
  })

  it('opens nothing when the app closes while a save is still running, and refuses setup after close', async () => {
    let finishSave = () => {}
    const { owner, opened, pass, settled } = harness({ state: 'saved', target: LOCAL }, () => new Promise<void>(resolve => { finishSave = resolve }))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await pass()
    await owner.close()
    finishSave()
    await settled()
    expect(opened).toMatchObject([{ target: LOCAL, closed: true, disposed: true }])
    expect(await owner.run({ do: 'checkTarget', target: REMOTE })).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
  })
})

describe('pinnedConnection', () => {
  it('has no setup, and passes chat commands to its Hermes', async () => {
    const commands: unknown[] = []
    const hermes = { run: async (command: unknown) => { commands.push(command); return { ok: true, value: undefined } }, close: async () => {} } as unknown as Hermes
    const owner = pinnedConnection(hermes)
    expect(owner.setup.get()).toEqual({ at: 'pinned' })
    expect(await owner.run({ do: 'checkTarget', target: LOCAL })).toMatchObject({ ok: false })
    await owner.run({ do: 'reconnect', start: false })
    expect(commands).toEqual([{ do: 'reconnect', start: false }])
  })
})
