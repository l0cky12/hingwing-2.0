import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket as WsClient } from 'ws'
import { manualClock } from '../src/testing/clock'
import { playToEnd, play, scriptedDialer } from '../src/testing/fixture'
import { RING_FRAMES, ScriptedGateway } from '../src/testing/gateway'
import { loopback, type Loopback } from '../src/testing/loopback'
import { dialWith, DialError, GATEWAY_PROTOCOL, systemClock, type Clock } from '../src/wire/link'
import { ERRAND, RESEARCH_CHAT, WITH_BOTS } from './support/errand'
import { errand, fold, ignoringStartTimes } from './support/story'

const closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})

async function listener(clock: Clock = systemClock, fixture = ERRAND): Promise<Loopback> {
  const gateway = new ScriptedGateway(fixture, { clock, timing: 'instant', ringFrames: RING_FRAMES, drop: null })
  const held = await loopback(gateway, clock)
  closers.push(() => held.close())
  return held
}

const upgradeWith = (url: string, protocols: readonly string[], headers: Record<string, string> = {}) =>
  new Promise<string>(resolve => {
    const ws = new WsClient(url, [...protocols], { headers })
    ws.on('open', () => { ws.terminate(); resolve('open') })
    ws.on('unexpected-response', (_request, response) => { ws.terminate(); resolve(`http ${response.statusCode}`) })
    ws.on('error', () => resolve('error'))
  })

describe('the real dial, against a loopback gateway', () => {
  it('plays the errand to the session the direct fold gives, and no upgrade carries an Origin header', async () => {
    let upgrades: readonly unknown[] = []
    let last
    for await (const moment of play(ERRAND, { transport: 'loopback' })) {
      last = moment.session
      upgrades = moment.script.upgrades
    }
    expect(ignoringStartTimes(last!)).toEqual({ ...fold(errand()).content, sync: { state: 'live' } })
    expect(upgrades).toEqual([{ origin: null, ticket: 0, refused: null }])
  })

  it('uses a new ticket on every dial', async () => {
    const script = scriptedDialer(ERRAND, { transport: 'loopback' })
    closers.push(() => script.close())
    const sockets = [await script({ start: false }), await script({ start: false }), await script({ start: false })]
    expect(script.upgrades).toEqual([0, 1, 2].map(ticket => ({ origin: null, ticket, refused: null })))
    expect(script.dials).toBe(3)
    sockets.forEach(socket => socket.close())
  })

  it('negotiates hermes-gateway-v1 and hands over the frames the gateway sent before the owner listened', async () => {
    const script = scriptedDialer(ERRAND, { transport: 'loopback' })
    closers.push(() => script.close())
    const socket = await script({ start: false })
    await new Promise(resolve => setTimeout(resolve, 20))
    const first = await new Promise<string>(resolve => { socket.onText = resolve })
    expect(JSON.parse(first)).toMatchObject({ method: 'event', params: { type: 'gateway.ready' } })
    socket.close()
  })

  it('is refused with a ticket that was used before', async () => {
    const gateway = await listener()
    const endpoint = gateway.mint('host')
    const dial = dialWith(async () => endpoint)
    const socket = await dial({ start: false })
    const again = await dial({ start: false }).catch((error: unknown) => error)
    expect(again).toBeInstanceOf(DialError)
    expect(again).toMatchObject({ kind: 'dropped' })
    expect(gateway.upgrades).toEqual([{ origin: null, ticket: 0, refused: null }, { origin: null, ticket: 0, refused: 'ticket' }])
    socket.close()
  })

  it('opens a socket that reaches what its ticket does', async () => {
    const gateway = await listener(systemClock, WITH_BOTS)
    const resumed = async (reach: 'host' | 'profile') => {
      const socket = await dialWith(async () => gateway.mint(reach))({ start: false })
      const reply = new Promise<{ result?: unknown; error?: { message: string } }>(resolve => {
        socket.onText = text => {
          const frame = JSON.parse(text) as { id?: number; result?: unknown; error?: { message: string } }
          if (frame.id === 1) resolve(frame)
        }
      })
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session.resume', params: { profile: 'research', session_id: RESEARCH_CHAT } }))
      const answer = await reply
      socket.close()
      return { reach: socket.reach, answer: answer.error?.message ?? 'resumed' }
    }
    expect(await resumed('host')).toEqual({ reach: 'host', answer: 'resumed' })
    expect(await resumed('profile')).toEqual({ reach: 'profile', answer: 'profile_mismatch' })
  })

  it('is refused with a ticket older than 30 s', async () => {
    const clock = manualClock()
    const gateway = await listener(clock)
    const dial = dialWith(async () => gateway.mint('host'))
    const stale = gateway.mint('host')
    await clock.advance(30_000)
    await expect(dialWith(async () => stale)({ start: false })).rejects.toBeInstanceOf(DialError)
    expect(gateway.upgrades.at(-1)).toMatchObject({ refused: 'ticket' })
    const fresh = await dial({ start: false })
    expect(gateway.upgrades.at(-1)).toMatchObject({ refused: null })
    fresh.close()
  })
})

describe('the loopback gateway\'s upgrade gate', () => {
  it('refuses an upgrade that carries an Origin header, even with a good ticket', async () => {
    const gateway = await listener()
    const { url, protocols } = gateway.mint('host')
    expect(await upgradeWith(url, protocols, { Origin: 'http://127.0.0.1:5173' })).toBe('http 403')
    expect(gateway.upgrades).toEqual([{ origin: 'http://127.0.0.1:5173', ticket: 0, refused: 'origin' }])
    expect(await upgradeWith(url, protocols), 'the refused upgrade did not spend the ticket').toBe('open')
  })

  it('refuses anything but the protocol and exactly one ticket', async () => {
    const gateway = await listener()
    const [ticket, second] = [gateway.mint('host'), gateway.mint('host')].map(endpoint => endpoint.protocols[1] as string)
    const { url } = gateway.mint('host')
    expect(await upgradeWith(url, [GATEWAY_PROTOCOL])).toBe('http 403')
    expect(await upgradeWith(url, [ticket as string])).toBe('http 403')
    expect(await upgradeWith(url, [GATEWAY_PROTOCOL, ticket as string, second as string])).toBe('http 403')
    expect(await upgradeWith(url, [GATEWAY_PROTOCOL, 'hermes-gateway-ticket.forged'])).toBe('http 403')
    expect(gateway.upgrades.map(upgrade => upgrade.refused)).toEqual(['ticket-count', 'protocol', 'ticket-count', 'ticket'])
  })
})

it('plays to the same end over loopback as in memory', async () => {
  expect(ignoringStartTimes(await playToEnd(ERRAND, { transport: 'loopback' }))).toEqual(ignoringStartTimes(await playToEnd(ERRAND)))
})
