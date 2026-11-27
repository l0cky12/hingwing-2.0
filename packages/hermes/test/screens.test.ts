import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import { controlOf, newerLease, type Lease } from '../src/domain/screen'
import { openHermes } from '../src/hub'
import { screenDesk, THUMBNAIL_MS } from '../src/screens'
import { manualClock } from '../src/testing/clock'
import { scriptedDialer, type Display, type Fixture } from '../src/testing/fixture'
import { parseEvent, parseObserved, parseThumbnail } from '../src/wire/parse'
import { BOUND, callsIn, WITH_BOTS } from './support/errand'

const FRAME = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString('base64')}`
const DEFAULT = 'default' as BotId
const RESEARCH = 'research' as BotId
const agent = (epoch: number): Lease => ({ holder: 'agent', viewerHash: null, epoch })
const human = (epoch: number, viewerHash: string): Lease => ({ holder: 'human', viewerHash, epoch })

describe('the lease', () => {
  it('keeps the lease with the higher epoch, so a reply an event overtook changes nothing', () => {
    expect(newerLease(null, agent(3))).toEqual(agent(3))
    expect(newerLease(human(4, 'abc'), agent(3)), 'an older reply').toEqual(human(4, 'abc'))
    expect(newerLease(human(4, 'abc'), agent(5)), 'a newer event').toEqual(agent(5))
    expect(newerLease(agent(4), human(4, 'abc')), 'the same epoch takes the newest word').toEqual(human(4, 'abc'))
  })

  it('names the agent, this Highwing by the hash of any viewer id it was minted, or someone else', () => {
    const mine = new Set(['abc', 'old'])
    expect(controlOf(agent(1), mine)).toBe('agent')
    expect(controlOf(human(2, 'abc'), mine)).toBe('you')
    expect(controlOf(human(2, 'old'), mine), 'a lease taken on a connection since dropped').toBe('you')
    expect(controlOf(human(2, 'def'), mine)).toBe('someone')
    expect(controlOf(human(2, 'abc'), new Set()), 'before Hermes minted this Highwing a viewer id, no person is this Highwing').toBe('someone')
  })
})

describe('the screen events', () => {
  const lease = { holder: 'human', viewer_id: null, viewer_hash: 'abc', since: 1, epoch: 7 }
  it("reads a lease move and a start or stop for every client, by the profile's home", () => {
    expect(parseEvent({ type: 'display.lease', payload: { profile_key: '/home/u/.hermes', lease } }))
      .toEqual({ scope: 'display', key: '/home/u/.hermes', running: null, lease: human(7, 'abc') })
    expect(parseEvent({ type: 'display.status', payload: { profile: 'default', supported: true, installed: true, missing: [], running: false, geometry: '1x1', lease, profile_key: '/k' } }))
      .toEqual({ scope: 'display', key: '/k', running: false, lease: human(7, 'abc') })
  })

  it('counts a frame it cannot use as unrouted', () => {
    expect(parseEvent({ type: 'display.lease', payload: { profile_key: '/k', lease: { holder: 'robot', epoch: 1 } } }).scope).toBe('unrouted')
    expect(parseEvent({ type: 'display.status', payload: { profile_key: '/k' } }).scope).toBe('unrouted')
  })

  it('takes an image frame and nothing else', () => {
    expect(parseThumbnail({ data_url: FRAME })).toBe(FRAME)
    expect(parseThumbnail({ data_url: null, suppressed: 'human_has_control' })).toBeNull()
    expect(parseThumbnail({ data_url: 'data:text/html;base64,PGI+' })).toBeNull()
    expect(parseThumbnail({ data_url: 'https://example.com/a.jpg' })).toBeNull()
  })
})

async function launched(display: Display | undefined, fixture: Fixture = WITH_BOTS) {
  const clock = manualClock()
  const script = scriptedDialer({ ...fixture, header: { ...fixture.header, ...(display === undefined ? {} : { display }) } }, { clock })
  const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  const run: typeof hermes.run = async command => {
    const answer = hermes.run(command)
    await clock.advance(0)
    return answer
  }
  return { hermes, clock, run, calls: (method: string) => callsIn(script.received).filter(call => call.method === method) }
}

describe("the open chat's screen", () => {
  it('says this Hermes cannot show its screen when it has no display methods, or reaches them through no socket of Highwing', async () => {
    expect((await launched(undefined)).hermes.screen.get()).toEqual({ bot: 'default', screen: { state: 'unavailable' } })
    expect((await launched({ default: { running: true, thumbnail: FRAME } }, BOUND)).hermes.screen.get()?.screen).toEqual({ state: 'unavailable' })
  })

  it('is off while the agent uses no screen, and asks for no frame', async () => {
    const { hermes, clock, calls } = await launched({})
    await clock.advance(THUMBNAIL_MS * 3)
    expect(hermes.screen.get()).toEqual({ bot: 'default', screen: { state: 'off' } })
    expect(calls('display.thumbnail')).toEqual([])
  })

  it("shows the agent's screen with its latest frame, asked for again every 2 s", async () => {
    const { hermes, clock, calls } = await launched({ default: { running: true, thumbnail: FRAME } })
    expect(hermes.screen.get()).toEqual({ bot: 'default', screen: { state: 'on', control: 'agent', thumbnail: FRAME } })
    const asked = calls('display.thumbnail').length
    await clock.advance(THUMBNAIL_MS)
    expect(calls('display.thumbnail').length).toBe(asked + 1)
  })

  it('takes control and hands it back, each a visible change, with the viewer id Hermes minted for this connection', async () => {
    const { hermes, run, calls } = await launched({ default: { running: true, thumbnail: FRAME } })
    expect(await run({ do: 'takeControl', bot: DEFAULT })).toEqual({ ok: true, value: undefined })
    expect(hermes.screen.get()?.screen, 'no frame while a person has control').toEqual({ state: 'on', control: 'you', thumbnail: null })
    const [minted] = calls('display.observe')
    expect(minted?.params).toEqual({ profile: 'default' })
    expect(calls('display.lease.acquire').map(call => call.params)).toEqual([{ profile: 'default', viewer_id: 'viewer-1', reason: 'Highwing' }])

    expect(await run({ do: 'handBack', bot: DEFAULT })).toEqual({ ok: true, value: undefined })
    expect(hermes.screen.get()?.screen).toMatchObject({ state: 'on', control: 'agent' })
    expect(calls('display.lease.release').map(call => call.params)).toEqual([{ profile: 'default', viewer_id: 'viewer-1', force: true }])
  })

  it('refuses to hand back control it never took', async () => {
    const { run, calls } = await launched({ default: { running: true } })
    expect(await run({ do: 'handBack', bot: DEFAULT })).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Highwing doesn't have control of this screen." } })
    expect(calls('display.lease.release')).toEqual([])
  })

  it('follows the open chat to another bot, whose screen is asked for once', async () => {
    const { hermes, run, calls } = await launched({ research: { running: true, thumbnail: FRAME } })
    expect(hermes.screen.get()?.screen).toEqual({ state: 'off' })
    await run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    expect(hermes.screen.get()).toEqual({ bot: 'research', screen: { state: 'on', control: 'agent', thumbnail: FRAME } })
    await run({ do: 'open', ref: { kind: 'bot', bot: DEFAULT } })
    await run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    expect(calls('display.status').map(call => call.params)).toEqual([{ profile: 'default' }, { profile: 'research' }])
  })

  it('has no live view to dial in a fixture, whose socket has no address', async () => {
    expect(await (await launched({ default: { running: true } })).hermes.screenSocket()).toBeNull()
  })
})

describe('the screen desk, against replies held open', () => {
  type Sent = { readonly method: string; readonly params: Record<string, unknown> }
  const hash = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 12)
  const status = (lease: object, running = true) => ({ profile: 'default', supported: true, installed: true, missing: [], running, geometry: '1x1', lease, profile_key: '/k' })
  const wire = (holder: 'agent' | 'human', epoch: number, id?: string) => ({ holder, viewer_id: null, viewer_hash: id === undefined ? null : hash(id), since: 0, epoch })

  function desk() {
    const sent: Sent[] = []
    const waiting: { readonly method: string; readonly answer: (reply: unknown) => void }[] = []
    const call = (method: string, params: Record<string, unknown>) => new Promise(answer => {
      sent.push({ method, params })
      waiting.push({ method, answer })
    })
    const conn = { call, as: (bot: string) => ({ call: (method: string, params: Record<string, unknown>) => call(method, { ...params, profile: bot }) }), sibling: async (path: string) => `ws://127.0.0.1:9${path}` }
    const screens = screenDesk(conn as unknown as Parameters<typeof screenDesk>[0], manualClock(), () => {})
    const settle = async () => {
      for (let turn = 0; turn < 5; turn++) await Promise.resolve()
    }
    const answer = async (method: string, reply: unknown) => {
      await settle()
      const at = waiting.findIndex(held => held.method === method)
      expect(at, `a ${method} waits for its answer`).toBeGreaterThanOrEqual(0)
      waiting.splice(at, 1)[0]!.answer(reply)
      await settle()
    }
    return { screens, sent, answer }
  }

  it('asks Hermes for one viewer id when the live view and Take control both need one at once', async () => {
    const { screens, sent, answer } = desk()
    screens.follow(DEFAULT)
    await answer('display.status', status(wire('agent', 1)))
    const socket = screens.socket()
    const taken = screens.control(DEFAULT, true)
    await answer('display.observe', { ...status(wire('agent', 1)), ticket: 't', path: '/api/display/ws', viewer_id: 'v1' })
    await answer('display.lease.acquire', { lease: wire('human', 2, 'v1') })
    expect(await taken).toEqual({ ok: true, value: undefined })
    expect(await socket).toBe('ws://127.0.0.1:9/api/display/ws?display_ticket=t')
    expect(sent.filter(call => call.method === 'display.observe' || call.method === 'display.lease.acquire').map(call => call.params)).toEqual([
      { profile: 'default' }, { profile: 'default', viewer_id: 'v1', reason: 'Highwing' }
    ])
    expect(screens.view?.screen).toEqual({ state: 'on', control: 'you', thumbnail: null })
  })

  it('keeps a lease event that came before the first status reply', async () => {
    const { screens, answer } = desk()
    screens.follow(DEFAULT)
    screens.moved({ key: '/k', running: null, lease: human(5, 'someone-else') })
    await answer('display.status', status(wire('agent', 4)))
    expect(screens.view?.screen).toMatchObject({ state: 'on', control: 'someone' })
  })

  it('asks again when the screen started while its status was asked, since a start carries no epoch', async () => {
    const { screens, sent, answer } = desk()
    screens.follow(DEFAULT)
    screens.moved({ key: '/k', running: true, lease: agent(1) })
    await answer('display.status', status(wire('agent', 1), false))
    expect(sent.filter(call => call.method === 'display.status')).toHaveLength(2)
    await answer('display.status', status(wire('agent', 1), true))
    expect(screens.view?.screen).toMatchObject({ state: 'on', control: 'agent' })
  })

  it("still shows the user's control after the link dropped, and hands it back with the id it was taken with", async () => {
    const { screens, sent, answer } = desk()
    screens.follow(DEFAULT)
    await answer('display.status', status(wire('agent', 1)))
    const taken = screens.control(DEFAULT, true)
    await answer('display.observe', { ...status(wire('agent', 1)), ticket: 't', path: '/p', viewer_id: 'v1' })
    await answer('display.lease.acquire', { lease: wire('human', 2, 'v1') })
    await taken
    screens.offline()
    screens.online()
    await answer('display.status', status(wire('human', 2, 'v1')))
    expect(screens.view?.screen).toMatchObject({ control: 'you' })
    const handed = screens.control(DEFAULT, false)
    await answer('display.lease.release', { lease: wire('agent', 3) })
    expect(await handed).toEqual({ ok: true, value: undefined })
    expect(sent.at(-1)).toEqual({ method: 'display.lease.release', params: { profile: 'default', viewer_id: 'v1', force: true } })
    expect(screens.view?.screen).toMatchObject({ control: 'agent' })
  })

  it('moves a lease from before a dropped link to the id the live view watches with', async () => {
    const { screens, sent, answer } = desk()
    screens.follow(DEFAULT)
    await answer('display.status', status(wire('agent', 1)))
    const taken = screens.control(DEFAULT, true)
    await answer('display.observe', { ...status(wire('agent', 1)), ticket: 't', path: '/p', viewer_id: 'v1' })
    await answer('display.lease.acquire', { lease: wire('human', 2, 'v1') })
    await taken
    screens.offline()
    screens.online()
    await answer('display.status', status(wire('human', 2, 'v1')))
    const socket = screens.socket()
    await answer('display.observe', { ...status(wire('human', 2, 'v1')), ticket: 't2', path: '/p', viewer_id: 'v2' })
    await answer('display.lease.acquire', { lease: wire('human', 3, 'v2') })
    expect(await socket).toBe('ws://127.0.0.1:9/p?display_ticket=t2')
    expect(sent.filter(call => call.method === 'display.observe').at(-1)?.params, 'the old id is not this connection\'s to ask with').toEqual({ profile: 'default' })
    expect(sent.at(-1)).toEqual({ method: 'display.lease.acquire', params: { profile: 'default', viewer_id: 'v2', reason: 'Highwing' } })
  })

  it('hands back after a lease move in flight has landed, so the move cannot take control again', async () => {
    const { screens, sent, answer } = desk()
    screens.follow(DEFAULT)
    await answer('display.status', status(wire('agent', 1)))
    const taken = screens.control(DEFAULT, true)
    await answer('display.observe', { ...status(wire('agent', 1)), ticket: 't', path: '/p', viewer_id: 'v1' })
    await answer('display.lease.acquire', { lease: wire('human', 2, 'v1') })
    await taken
    screens.offline()
    screens.online()
    await answer('display.status', status(wire('human', 2, 'v1')))
    const socket = screens.socket()
    const handed = screens.control(DEFAULT, false)
    await answer('display.observe', { ...status(wire('human', 2, 'v1')), ticket: 't2', path: '/p', viewer_id: 'v2' })
    await answer('display.lease.acquire', { lease: wire('human', 3, 'v2') })
    await answer('display.lease.release', { lease: wire('agent', 4) })
    expect(await handed).toEqual({ ok: true, value: undefined })
    await socket
    expect(sent.slice(-3).map(call => [call.method, call.params.viewer_id])).toEqual([['display.observe', undefined], ['display.lease.acquire', 'v2'], ['display.lease.release', 'v2']])
    expect(screens.view?.screen).toMatchObject({ control: 'agent' })
  })

  it('gives no live view of a bot the open chat moved away from while it was asked for', async () => {
    const { screens, answer } = desk()
    screens.follow(DEFAULT)
    await answer('display.status', status(wire('agent', 1)))
    const socket = screens.socket()
    screens.follow(RESEARCH)
    await answer('display.observe', { ...status(wire('agent', 1)), ticket: 't', path: '/p', viewer_id: 'v1' })
    expect(await socket).toBeNull()
  })

  it('takes only a plain path on the gateway for the live view', () => {
    const observed = (path: string) => parseObserved({ ...status(wire('agent', 1)), ticket: 't', path, viewer_id: 'v' } as never)
    expect(observed('/api/display/ws')).toEqual({ ticket: 't', path: '/api/display/ws', viewerId: 'v' })
    for (const path of ['//evil.example/x', 'https://evil.example/x', 'api/display/ws', '/a\\b']) expect(observed(path), path).toBeNull()
  })
})
