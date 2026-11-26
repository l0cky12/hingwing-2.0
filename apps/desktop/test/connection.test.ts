import type { CheckResult, Dialer, Hermes, Route } from '@highwing/hermes'
import type { BotId, CheckFailure, CheckStep, CommandOutcome, SessionId, SshHost, Target } from '@highwing/hermes/domain'
import type { GatewayUrl } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import type { Live, Setup } from '../src/ipc-contract'
import { feed, nextSetup, ownConnection, pinnedConnection, refreshBotsOnFocus, type ConnectionDeps, type SetupEvent } from '../src/main/connection'
import { chatLinks } from '../src/main/links'
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
  const FIRST_CHECK: Setup = { at: 'checking', live: null, target: REMOTE, step: 'hermes' }
  const SAVED: Setup = { at: 'saved', live: NEXT, from: 'settings' }

  it.each<[string, Setup, SetupEvent, Setup]>([
    ['the Settings button opens the form over the chat', { at: 'chat', live: LIVE }, { do: 'editTarget' }, EDITING],
    ['a remote check starts at Tailscale', EDITING, { do: 'checkTarget', target: REMOTE }, CHECKING],
    ['a check of this computer starts at Hermes', FIRST_RUN, { do: 'checkTarget', target: LOCAL }, { at: 'checking', live: null, target: LOCAL, step: 'hermes' }],
    ['a check moves to its next step', CHECKING, { do: 'step', step: 'ssh' }, { ...CHECKING, step: 'ssh' }],
    ['a step fails', CHECKING, { do: 'fail', failure: 'ssh-denied' }, { at: 'failed', live: LIVE, target: REMOTE, failure: 'ssh-denied' }],
    ['a save fails', SAVING, { do: 'fail', failure: 'cant-save' }, { at: 'failed', live: LIVE, target: REMOTE, failure: 'cant-save' }],
    ['a check from Settings passes and is saved', SAVING, { do: 'connect', live: NEXT }, SAVED],
    ['a check on a first run passes and is saved', { ...SAVING, live: null }, { do: 'connect', live: NEXT }, { ...SAVED, from: 'first-run' }],
    ['a failed target is checked again', FAILED, { do: 'checkTarget', target: OTHER }, { at: 'checking', live: null, target: OTHER, step: 'tailscale' }],
    ['Close leaves the form for the chat', EDITING, { do: 'keepTarget' }, { at: 'chat', live: LIVE }],
    ['Close leaves a running check for the chat', CHECKING, { do: 'keepTarget' }, { at: 'chat', live: LIVE }],
    ['Close leaves a failure for the chat', { ...FAILED, live: LIVE }, { do: 'keepTarget' }, { at: 'chat', live: LIVE }],
    ['Close leaves a wait for a sign-in for the chat', { ...CHECKING, step: 'sign-in' }, { do: 'keepTarget' }, { at: 'chat', live: LIVE }],
    ['Stop waiting ends the sign-in of a first run as a failure', { ...FIRST_CHECK, step: 'sign-in' }, { do: 'keepTarget' }, { at: 'failed', live: null, target: REMOTE, failure: 'sign-in-cancelled' }],
    ['Cancel stops a running check and stays on the form', CHECKING, { do: 'stopCheck' }, EDITING],
    ['Cancel stops a wait for a sign-in and stays on the form', { ...CHECKING, step: 'sign-in' }, { do: 'stopCheck' }, EDITING],
    ['Cancel stops a failed check and stays on the form', { ...FAILED, live: LIVE }, { do: 'stopCheck' }, EDITING],
    ['Open chat leaves the first run\'s saved screen', { ...SAVED, from: 'first-run' }, { do: 'keepTarget' }, { at: 'chat', live: NEXT }],
    ['Close leaves Settings after a save', SAVED, { do: 'keepTarget' }, { at: 'chat', live: NEXT }],
    ['Connect in Settings after a save checks again', SAVED, { do: 'checkTarget', target: OTHER }, { at: 'checking', live: NEXT, target: OTHER, step: 'tailscale' }]
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
    ['a second check while one runs', CHECKING, { do: 'checkTarget', target: OTHER }],
    ['a check from the chat', { at: 'chat', live: LIVE }, { do: 'checkTarget', target: REMOTE }],
    ['a step when no check runs', EDITING, { do: 'step', step: 'ssh' }],
    ['a result when no check runs', FAILED, { do: 'connect', live: NEXT }],
    ['the Settings button on the saved screen', SAVED, { do: 'editTarget' }],
    ['the Settings button in a fixture run', { at: 'pinned' }, { do: 'editTarget' }],
    ['a check in a fixture run', { at: 'pinned' }, { do: 'checkTarget', target: LOCAL }]
  ])('refuses %s', (_what, from, event) => {
    expect(nextSetup(from, event)).toBeNull()
  })
})

interface Opened { readonly target: Target; closed: boolean; disposed: boolean; readonly commands: unknown[] }

/** The owner over a check the test settles by hand, and connections that only record what happened to them. */
type Answer = (command: unknown) => CommandOutcome<unknown> | Promise<CommandOutcome<unknown>>

function harness(loaded: Settings, save: (target: Target) => Promise<void> = async () => {}) {
  let answer: Answer = () => ({ ok: true, value: undefined })
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
  return { owner, opened, saved, checks, states, log, pass, fail, settled, answerWith, at: () => owner.setup.get() }
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
    expect(at()).toEqual({ at: 'saved', live: { target: REMOTE, epoch: 1 }, from: 'first-run' })
    expect(saved).toEqual([REMOTE])
    expect(opened.map(({ target }) => target)).toEqual([REMOTE])

    await owner.run({ do: 'keepTarget' })
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
    expect(at()).toEqual({ at: 'saved', live: { target: REMOTE, epoch: 2 }, from: 'settings' })
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
    expect(at()).toEqual({ at: 'saved', live: { target: REMOTE, epoch: 1 }, from: 'settings' })
    expect(saved).toEqual([])
    expect(opened).toMatchObject([{ closed: false, disposed: false }])
  })

  it('switches from one gateway address to another, and not to the address already live', async () => {
    const here: Target = { kind: 'url', url: 'https://hermes.example.com' as GatewayUrl }
    const there: Target = { kind: 'url', url: 'https://hermes.example.com:8443' as GatewayUrl }
    const { owner, checks, saved, opened, states, pass, at } = harness({ state: 'saved', target: here })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: { ...here } })
    expect(at()).toEqual({ at: 'checking', live: { target: here, epoch: 1 }, target: here, step: 'hermes' })
    await pass()
    expect([at(), saved, opened.length]).toEqual([{ at: 'saved', live: { target: here, epoch: 1 }, from: 'settings' }, [], 1])

    await owner.run({ do: 'keepTarget' })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: there })
    checks.at(-1)!.step('sign-in')
    checks.at(-1)!.step('gateway')
    await pass()
    expect(at()).toEqual({ at: 'saved', live: { target: there, epoch: 2 }, from: 'settings' })
    expect(saved).toEqual([there])
    expect(opened).toMatchObject([{ target: here, closed: true, disposed: true }, { target: there, closed: false, disposed: false }])
    expect(states.flatMap(setup => (setup.at === 'checking' && setup.target === there ? [setup.step] : []))).toEqual(['hermes', 'sign-in', 'gateway', 'save'])
  })

  it('retries the link of the live connection when the target checked is the one already live', async () => {
    const { owner, opened, pass } = harness({ state: 'saved', target: REMOTE })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    expect(opened[0]!.commands).toEqual([])
    await pass()
    expect(opened[0]!.commands).toEqual([{ do: 'reconnect', start: false }])
  })

  it('fails with cant-save and keeps the live connection when the save rejects', async () => {
    const { owner, opened, pass, at } = harness({ state: 'saved', target: LOCAL }, async () => { throw new Error('EACCES') })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await pass()
    expect(at()).toEqual({ at: 'failed', live: { target: LOCAL, epoch: 1 }, target: REMOTE, failure: 'cant-save' })
    expect(opened).toMatchObject([{ target: LOCAL, closed: false, disposed: false }])
  })

  it('aborts the check on Close and drops what it finds later', async () => {
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

  it('stops a first run\'s wait for a sign-in, aborts the check and drops what it finds later', async () => {
    const { owner, checks, saved, opened, pass, at } = harness({ state: 'none' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    expect(await owner.run({ do: 'keepTarget' })).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(checks[0]!.signal.aborted).toBe(false)

    checks[0]!.step('sign-in')
    expect(await owner.run({ do: 'keepTarget' })).toEqual({ ok: true, value: undefined })
    expect(checks[0]!.signal.aborted).toBe(true)
    expect(at()).toEqual({ at: 'failed', live: null, target: REMOTE, failure: 'sign-in-cancelled' })

    await pass()
    expect(at()).toEqual({ at: 'failed', live: null, target: REMOTE, failure: 'sign-in-cancelled' })
    expect(saved).toEqual([])
    expect(opened).toEqual([])
  })

  it('aborts the check on Cancel, stays on the form and drops what it finds later', async () => {
    const { owner, checks, saved, opened, pass, at } = harness({ state: 'saved', target: LOCAL })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    expect(await owner.run({ do: 'stopCheck' })).toEqual({ ok: true, value: undefined })
    expect(checks[0]!.signal.aborted).toBe(true)
    expect(at()).toEqual({ at: 'form', live: { target: LOCAL, epoch: 1 }, notice: null })

    checks[0]!.step('ssh')
    await pass()
    expect(at()).toEqual({ at: 'form', live: { target: LOCAL, epoch: 1 }, notice: null })
    expect(saved).toEqual([])
    expect(opened).toHaveLength(1)
  })

  it('goes back to the form on Cancel after a check failed', async () => {
    const { owner, fail, at } = harness({ state: 'saved', target: LOCAL })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await fail('host-offline')
    await owner.run({ do: 'stopCheck' })
    expect(at()).toEqual({ at: 'form', live: { target: LOCAL, epoch: 1 }, notice: null })
  })

  it('refuses Cancel while the target is being saved, and finishes the switch', async () => {
    let finishSave = () => {}
    const { owner, checks, pass, settled, at } = harness({ state: 'saved', target: LOCAL }, () => new Promise<void>(resolve => { finishSave = resolve }))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await pass()
    expect(at()).toMatchObject({ at: 'checking', step: 'save' })
    expect(await owner.run({ do: 'stopCheck' })).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(checks[0]!.signal.aborted).toBe(false)
    finishSave()
    await settled()
    expect(at()).toEqual({ at: 'saved', live: { target: REMOTE, epoch: 2 }, from: 'settings' })
  })

  it('stays in Settings after a save, where Close goes to the chat and Connect checks again', async () => {
    const { owner, checks, pass, at } = harness({ state: 'saved', target: LOCAL })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await pass()
    expect(await owner.run({ do: 'checkTarget', target: OTHER })).toEqual({ ok: true, value: undefined })
    expect(at()).toEqual({ at: 'checking', live: { target: REMOTE, epoch: 2 }, target: OTHER, step: 'tailscale' })
    expect(checks).toHaveLength(2)

    await owner.run({ do: 'keepTarget' })
    expect(at()).toEqual({ at: 'chat', live: { target: REMOTE, epoch: 2 } })
    expect(checks[1]!.signal.aborted).toBe(true)
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
    const { owner, checks, opened, at } = harness({ state: 'saved', target: LOCAL })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    expect(await owner.run(opening('s1'))).toEqual({ ok: true, value: undefined })
    expect(at()).toEqual({ at: 'chat', live: { target: LOCAL, epoch: 1 } })
    expect(checks[0]!.signal.aborted).toBe(true)
    expect(opened[0]!.commands).toEqual([opening('s1')])
  })

  it('closes Settings after a save, and opens on the new connection', async () => {
    const { owner, opened, pass, at } = harness({ state: 'saved', target: LOCAL })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await pass()
    await owner.run(opening('s1'))
    expect(at()).toEqual({ at: 'chat', live: { target: REMOTE, epoch: 2 } })
    expect(opened[1]!.commands).toEqual([opening('s1')])
  })

  it('refuses an open at the save step, and changes nothing', async () => {
    const held = holdSave()
    const { owner, checks, opened, states, pass, settled, at } = harness({ state: 'saved', target: LOCAL }, held.save)
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await pass()
    const before = states.length
    expect(await owner.run(opening('s1'))).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(states).toHaveLength(before)
    expect(checks[0]!.signal.aborted).toBe(false)
    expect(opened[0]!.commands).toEqual([])
    held.finish()
    await settled()
    expect(at()).toEqual({ at: 'saved', live: { target: REMOTE, epoch: 2 }, from: 'settings' })
  })

  it('just opens from the chat', async () => {
    const { owner, opened, states } = harness({ state: 'saved', target: LOCAL })
    expect(await owner.run(opening('s1'))).toEqual({ ok: true, value: undefined })
    expect(states).toEqual([{ at: 'chat', live: { target: LOCAL, epoch: 1 } }])
    expect(opened[0]!.commands).toEqual([opening('s1')])
  })

  it('runs two opens sent together from Settings, so the second one shows', async () => {
    const { owner, opened, at } = harness({ state: 'saved', target: LOCAL })
    await owner.run({ do: 'editTarget' })
    const outcomes = await Promise.all([owner.run(opening('s1')), owner.run(opening('s2'))])
    expect(outcomes).toEqual([{ ok: true, value: undefined }, { ok: true, value: undefined }])
    expect(at()).toEqual({ at: 'chat', live: { target: LOCAL, epoch: 1 } })
    expect(opened[0]!.commands).toEqual([opening('s1'), opening('s2')])
  })

  const RAE = 'rae' as BotId
  const MENU_OPENS = [
    ['Open chat', { do: 'open', ref: { kind: 'bot', bot: RAE } }],
    ['New chat', { do: 'open', ref: { kind: 'new', bot: RAE, draftId: 'd1' }, upFront: true }]
  ] as const

  it.each(MENU_OPENS)("closes Settings for the bot menu's %s, aborts its check, and opens", async (_item, command) => {
    const { owner, checks, opened, at } = harness({ state: 'saved', target: LOCAL })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    expect(await owner.run(command)).toEqual({ ok: true, value: undefined })
    expect(at()).toEqual({ at: 'chat', live: { target: LOCAL, epoch: 1 } })
    expect(checks[0]!.signal.aborted).toBe(true)
    expect(opened[0]!.commands).toEqual([command])
  })

  it.each(MENU_OPENS)("refuses the bot menu's %s at the save step, and changes nothing", async (_item, command) => {
    const held = holdSave()
    const { owner, opened, states, pass, at } = harness({ state: 'saved', target: LOCAL }, held.save)
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await pass()
    const before = states.length
    expect(await owner.run(command)).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(states).toHaveLength(before)
    expect(opened[0]!.commands).toEqual([])
    expect(at()).toMatchObject({ at: 'checking', step: 'save' })
  })

  it('pins a bot and reads the bots again on focus with Settings left up, its check running, even at the save step', async () => {
    const held = holdSave()
    const { owner, checks, opened, pass, settled, at } = harness({ state: 'saved', target: LOCAL }, held.save)
    const focus = new Set<() => void>()
    refreshBotsOnFocus({ on: (_: 'browser-window-focus', listener: () => void) => focus.add(listener), off: () => {} }, owner)
    const mark = { do: 'markBot', bot: RAE, mark: 'pin' } as const
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
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

  const createBot = { do: 'createBot', draft: { name: 'Rae', description: '', model: null, persona: '' }, picture: null } as const

  it('closes Settings for a bot made from the sidebar, which the hub opens, once Hermes has made it', async () => {
    const { owner, opened, answerWith, settled, at } = harness({ state: 'saved', target: LOCAL })
    let made = () => {}
    answerWith(() => new Promise(resolve => { made = () => resolve({ ok: true, value: undefined }) }))
    await owner.run({ do: 'editTarget' })
    const outcome = owner.run(createBot)
    await settled()
    expect(at(), 'Hermes is still making the bot').toEqual({ at: 'form', live: { target: LOCAL, epoch: 1 }, notice: null })
    made()
    expect(await outcome).toEqual({ ok: true, value: undefined })
    expect(at()).toEqual({ at: 'chat', live: { target: LOCAL, epoch: 1 } })
    expect(opened[0]!.commands).toEqual([createBot])
  })

  it('keeps Settings up when Hermes refuses a bot made from the sidebar', async () => {
    const { owner, opened, answerWith, at } = harness({ state: 'saved', target: LOCAL })
    const taken = { ok: false, refusal: { kind: 'rejected', message: 'A bot called Rae already exists.', field: 'name' } } as const
    answerWith(() => taken)
    await owner.run({ do: 'editTarget' })
    expect(await owner.run(createBot)).toEqual(taken)
    expect(at()).toEqual({ at: 'form', live: LIVE, notice: null })
    expect(opened[0]!.commands).toEqual([createBot])
  })

  it('stops a running check before it makes a bot, so the bot lands on the live machine, and closes Settings there', async () => {
    const { owner, checks, opened, answerWith, pass, settled, at } = harness({ state: 'saved', target: LOCAL })
    let made = () => {}
    answerWith(() => new Promise(resolve => { made = () => resolve({ ok: true, value: undefined }) }))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    const outcome = owner.run(createBot)
    await settled()
    expect(checks[0]!.signal.aborted).toBe(true)
    expect(at(), 'Settings stays up, on the live connection').toEqual({ at: 'form', live: LIVE, notice: null })
    await pass()
    expect(opened, 'the stopped check switches nothing').toHaveLength(1)
    made()
    expect(await outcome).toEqual({ ok: true, value: undefined })
    expect(at()).toEqual({ at: 'chat', live: LIVE })
    expect(opened[0]!.commands).toEqual([createBot])
  })

  it("leaves a new connection's confirmation up for a bot Hermes made on the connection it replaced", async () => {
    const { owner, opened, answerWith, pass, at } = harness({ state: 'saved', target: LOCAL })
    let made = () => {}
    answerWith(() => new Promise(resolve => { made = () => resolve({ ok: true, value: undefined }) }))
    await owner.run({ do: 'editTarget' })
    const outcome = owner.run(createBot)
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await pass()
    expect(at()).toEqual({ at: 'saved', live: NEXT, from: 'settings' })
    made()
    expect(await outcome).toEqual({ ok: true, value: undefined })
    expect(at()).toEqual({ at: 'saved', live: NEXT, from: 'settings' })
    expect(opened.map(({ commands }) => commands)).toEqual([[createBot], []])
  })

  it('refuses a bot at the save step without asking Hermes, and changes nothing', async () => {
    const held = holdSave()
    const { owner, opened, states, pass } = harness({ state: 'saved', target: LOCAL }, held.save)
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await pass()
    const before = states.length
    expect(await owner.run(createBot)).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(states).toHaveLength(before)
    expect(opened[0]!.commands).toEqual([])
  })

  it('closes Settings on a failed check for an open from a notification', async () => {
    const { owner, opened, fail, at } = harness({ state: 'saved', target: LOCAL })
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await fail('host-offline')
    await owner.run(opening('s1'))
    expect(at()).toEqual({ at: 'chat', live: { target: LOCAL, epoch: 1 } })
    expect(opened[0]!.commands).toEqual([opening('s1')])
  })

  it('closes Settings for a chat link, and holds one that comes during a save until the save ends', async () => {
    const held = holdSave()
    const { owner, opened, pass, settled, at } = harness({ state: 'saved', target: LOCAL }, held.save)
    const links = chatLinks()
    links.serve(owner, () => {})
    await owner.run({ do: 'editTarget' })
    links.holdLatest(['highwing://chat/local-0001'])
    expect(at()).toEqual({ at: 'chat', live: { target: LOCAL, epoch: 1 } })
    expect(opened[0]!.commands).toEqual([LINKED])

    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
    await pass()
    links.holdLatest(['highwing://chat/local-0001'])
    expect(at()).toMatchObject({ at: 'checking', step: 'save' })
    expect(opened[0]!.commands).toEqual([LINKED])
    held.finish()
    await settled()
    expect(at()).toEqual({ at: 'chat', live: { target: REMOTE, epoch: 2 } })
    expect(opened[1]!.commands).toEqual([LINKED])
  })

  it.each([
    ['passes', 'finish', { target: REMOTE, epoch: 2 }, 1],
    ['fails', 'fail', { target: LOCAL, epoch: 1 }, 0]
  ] as const)('ends a window that watches after the links on the chat, for a link held through a save that %s', async (_what, end, live, connection) => {
    const held = holdSave()
    const { owner, opened, pass, settled, at } = harness({ state: 'saved', target: LOCAL }, held.save)
    const links = chatLinks()
    links.serve(owner, () => {})
    const window: Setup[] = []
    owner.setup.subscribe(setup => window.push(setup))
    await owner.run({ do: 'editTarget' })
    await owner.run({ do: 'checkTarget', target: REMOTE })
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
    const owner = pinnedConnection(hermes)
    expect(owner.setup.get()).toEqual({ at: 'pinned' })
    expect(await owner.run({ do: 'checkTarget', target: LOCAL })).toMatchObject({ ok: false })
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
