import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { Link } from '../src/domain/session'
import { DialError, openHermes, remoteRoute, type Hermes, type Route } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { FAKE_HOST, type FakeHost, type ScenarioName } from '../src/testing/fake-host'
import { playToEnd } from '../src/testing/fixture'
import type { Loopback } from '../src/testing/loopback'
import { UPGRADE_MS } from '../src/wire/ssh'
import { ERRAND } from './support/errand'
import { closing, errandGateway, host, listen, until } from './support/host'
import { errand, fold, ignoringStartTimes } from './support/story'

const PROBE = 'gateway tickets --probe --json'
const ATTACH = 'gateway attach --json --timeout 20'
const ATTACH_START = 'gateway attach --json --start --timeout 75'
const SERVE = 'gateway tickets --serve --json'
const ACCEPTED = (ticket: number) => ({ origin: null, ticket, refused: null })

const routeTo = (held: FakeHost, options: Parameters<typeof remoteRoute>[1] = {}): Route =>
  closing(remoteRoute(FAKE_HOST, { sshBin: held.ssh, ...options }), route => route.dispose())

const open = (route: Route): Hermes =>
  closing(openHermes({ dial: route.dial, client: { name: 'highwing-test', version: '0' } }), hermes => hermes.close())

const linkIs = (hermes: Hermes, state: Link['state']) => until(`the link to be ${state}`, () => hermes.link.get().state === state)

const failureOf = (dial: Promise<unknown>) => dial.then(
  () => { throw new Error('the dial went through') },
  (error: unknown) => (error instanceof DialError ? { kind: error.kind, message: error.message } : { threw: String(error) })
)

describe('remoteRoute, against the fake host and the loopback gateway', () => {
  it('plays the errand to the session the direct fold gives, through one probe, one attach, one ticket and one relay', async () => {
    const want = { ...fold(errand()).content, sync: { state: 'live' } }
    let far: FakeHost | undefined
    let gateway: Loopback | undefined
    const last = await playToEnd(ERRAND, {
      ended: session => isDeepStrictEqual(ignoringStartTimes(session), want),
      transport: async listening => {
        gateway = listening
        far = await host('ok', listening)
        return routeTo(far).dial
      }
    })
    expect(ignoringStartTimes(last)).toEqual(want)
    expect(gateway?.upgrades, 'one upgrade, with no Origin, on the ticket --serve minted after the one attach did').toEqual([ACCEPTED(1)])
    expect(far?.calls).toEqual([PROBE, ATTACH_START, SERVE, 'relay 1'])
  })

  it('reaches every profile through the ticket of --serve, and one profile on a Hermes that mints none', async () => {
    const listening = await listen(errandGateway())
    const current = await routeTo(await host('ok', listening)).dial({ start: false })
    expect(current.reach).toBe('host')
    current.close()

    const older = await host('ok-bound', listening)
    const bound = await routeTo(older).dial({ start: false })
    expect(bound.reach).toBe('profile')
    expect(older.calls, 'no --serve on a Hermes whose probe lists no interactive ticket').toEqual([PROBE, ATTACH, 'relay 1'])
    bound.close()
  })

  it('follows a gateway that restarted on another port, with a new ticket and no start', async () => {
    const gateway = errandGateway()
    const [first, second] = [await listen(gateway), await listen(gateway)]
    const far = await host('ok', first)
    const hermes = open(routeTo(far))
    await linkIs(hermes, 'online')

    far.moveTo(second)
    await first.close()
    await linkIs(hermes, 'waiting')
    await linkIs(hermes, 'online')

    expect(far.calls).toEqual([PROBE, ATTACH_START, SERVE, 'relay 1', ATTACH, SERVE, 'relay 2'])
    expect(first.upgrades).toEqual([ACCEPTED(1)])
    expect(second.upgrades).toEqual([ACCEPTED(1)])
  })

  it('asks Hermes to start its gateway on the launch dial and on Start, and never on a retry', async () => {
    const far = await host('ok', null)
    const hermes = open(routeTo(far))
    await until('the first retry to fail', () => {
      const link = hermes.link.get()
      return link.state === 'waiting' && link.attempt === 2
    })
    expect(hermes.link.get()).toMatchObject({ why: 'not-running', message: "Hermes isn't running." })
    expect(far.calls).toEqual([PROBE, ATTACH_START, ATTACH])

    far.moveTo(await listen(errandGateway()))
    await hermes.run({ do: 'reconnect', start: true })
    await linkIs(hermes, 'online')
    expect(far.calls).toEqual([PROBE, ATTACH_START, ATTACH, ATTACH_START, SERVE, 'relay 1'])
  })

  it('fails a dial whose attach named a port the tunnel does not reach as dropped', async () => {
    const far = await host('ok', await listen(errandGateway()))
    const route = routeTo(far)
    const socket = await route.dial({ start: false })
    socket.close()
    far.moveTo({ instanceId: 'elsewhere', mint: reach => ({ url: 'ws://127.0.0.1:1/api/ws', protocols: ['hermes-gateway-v1', 'hermes-gateway-ticket.forged'], reach }) })
    expect(await failureOf(route.dial({ start: false }))).toMatchObject({ kind: 'dropped' })
  })
})

describe('what a dial says when it cannot reach Hermes', () => {
  it.each<[ScenarioName, object]>([
    ['unreachable', { kind: 'unreachable', message: "Highwing can't reach hermes-host over SSH." }],
    ['ssh-missing', { kind: 'ssh-missing', message: 'This computer has no ssh command.' }],
    ['ssh-denied', { kind: 'ssh-denied', message: "The machine hermes-host refused this computer's SSH login." }],
    ['host-changed', { kind: 'host-changed', message: 'The SSH key of hermes-host has changed since you last connected.' }],
    ['hermes-not-found', { kind: 'hermes-missing', message: "Hermes isn't installed on hermes-host." }],
    ['hermes-too-old', { kind: 'incompatible', message: 'The Hermes on hermes-host is too old for Highwing.' }],
    ['ok', { kind: 'not-running', message: "Hermes isn't running." }]
  ])('reads the %s scenario with no gateway as %j', async (name, failure) => {
    expect(await failureOf(routeTo(await host(name)).dial({ start: false }))).toEqual(failure)
  })

  it('asks a machine that was unreachable again, and one that answered only once', async () => {
    const far = await host('ok', null, 'ssh')
    const life = routeTo(far)
    const cut = life.dial({ start: false })
    await until('the probe to wait', () => far.calls.length === 1)
    life.dispose()
    await failureOf(cut)

    far.release()
    const route = routeTo(far)
    await failureOf(route.dial({ start: false }))
    await failureOf(route.dial({ start: false }))
    expect(far.calls).toEqual([PROBE, PROBE, ATTACH, ATTACH])
  })
})

describe('the processes of a route', () => {
  const none = (far: FakeHost) => until('every ssh of the route to end', () => far.running().length === 0)

  it('leaves no ssh alive after close and dispose, and refuses a later dial as dropped', async () => {
    const far = await host('ok', await listen(errandGateway()))
    const route = routeTo(far)
    const hermes = open(route)
    await linkIs(hermes, 'online')
    expect(far.running(), 'the relay of the open socket').toHaveLength(1)

    await hermes.close()
    route.dispose()
    await none(far)
    expect(await failureOf(route.dial({ start: true }))).toMatchObject({ kind: 'dropped' })
    expect(far.calls).toEqual([PROBE, ATTACH_START, SERVE, 'relay 1'])
  })

  it('ends the relay with its socket, with no dispose', async () => {
    const far = await host('ok', await listen(errandGateway()))
    const socket = await routeTo(far).dial({ start: false })
    expect(far.running()).toHaveLength(1)
    socket.close()
    await none(far)
  })

  it('kills an attach that is still pending when the route is closed and disposed', async () => {
    const far = await host('ok', await listen(errandGateway()), 'attach')
    const route = routeTo(far)
    const hermes = open(route)
    await until('the attach to wait', () => far.calls.includes(ATTACH_START))
    expect(far.running()).toHaveLength(1)

    await hermes.close()
    route.dispose()
    await none(far)
  })

  it('kills the ssh of an upgrade that stalls when the route is closed and disposed', async () => {
    const far = await host('ok', await listen(errandGateway()), 'relay')
    const route = routeTo(far)
    const hermes = open(route)
    await until('the relay to wait', () => far.calls.includes('relay 1'))
    expect(far.running()).toHaveLength(1)

    await hermes.close()
    route.dispose()
    await none(far)
  })

  it(`gives an upgrade ${UPGRADE_MS} ms to answer, then kills its ssh and fails the dial as dropped`, async () => {
    const clock = manualClock()
    const far = await host('ok', await listen(errandGateway()), 'relay')
    const dial = failureOf(routeTo(far, { clock }).dial({ start: false }))
    await until('the relay to wait', () => far.calls.includes('relay 1'))

    await clock.advance(UPGRADE_MS - 1)
    expect(far.running()).toHaveLength(1)
    await clock.advance(1)
    expect(await dial).toMatchObject({ kind: 'dropped' })
    await none(far)
  })
})
