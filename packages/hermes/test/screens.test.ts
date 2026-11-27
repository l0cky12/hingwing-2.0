import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import { controlOf, newerLease, type Lease } from '../src/domain/screen'
import { openHermes } from '../src/hub'
import { THUMBNAIL_MS } from '../src/screens'
import { manualClock } from '../src/testing/clock'
import { scriptedDialer, type Display, type Fixture } from '../src/testing/fixture'
import { parseEvent, parseThumbnail } from '../src/wire/parse'
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

  it('names the agent, this Highwing by its viewer hash, or someone else', () => {
    expect(controlOf(agent(1), 'abc')).toBe('agent')
    expect(controlOf(human(2, 'abc'), 'abc')).toBe('you')
    expect(controlOf(human(2, 'def'), 'abc')).toBe('someone')
    expect(controlOf(human(2, 'abc'), null), 'before Hermes minted this Highwing a viewer id, no person is this Highwing').toBe('someone')
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
    expect(calls('display.lease.release').map(call => call.params)).toEqual([{ profile: 'default', viewer_id: 'viewer-1' }])
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
