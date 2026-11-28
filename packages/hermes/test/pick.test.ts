import { describe, expect, it } from 'vitest'
import type { GatewayUrl, SshHost, Target } from '../src/domain/reach'
import type { PickMode } from '../src/domain/servers'
import { manualClock } from '../src/testing/clock'
import { FAKE_HOST, FAKE_LAN_HOST } from '../src/testing/fake-host'
import { DialError, type WireSocket } from '../src/wire/link'
import { TIE_MS } from '../src/domain/servers'
import { pickedRoute, TIME_MS, timeWay, type Picked, type Way } from '../src/wire/pick'
import { host, until } from './support/host'

const TAILNET: Target = { kind: 'remote', host: FAKE_HOST }
const LAN: Target = { kind: 'ssh', host: FAKE_LAN_HOST }
const WEB: Target = { kind: 'url', url: 'https://hermes.example.com' as GatewayUrl }

interface Plan { readonly ms: number | null | Promise<number | null>; readonly dial?: 'connects' | DialError | Promise<void> }
const planned = (entries: readonly (readonly [Target, Plan])[]) => new Map(entries)

/** Ways that answer and dial as planned, and a record of what the route did with them. */
function ways(plans: ReadonlyMap<Target, Plan>, pick: PickMode = 'fastest', listed: readonly Target[] = [...plans.keys()], clock = manualClock()) {
  const log: string[] = []
  const picks: Picked[] = []
  const sockets = new Map<Target, { closed: boolean }>()
  const name = (target: Target) => (target === TAILNET ? 'tailnet' : target === LAN ? 'lan' : 'web')
  const wayFor = (target: Target): Way => {
    const plan = () => plans.get(target) as Plan
    return {
      target,
      time: async () => {
        log.push(`time ${name(target)}`)
        return plan().ms
      },
      route: {
        dial: async () => {
          log.push(`dial ${name(target)}`)
          if (plan().dial instanceof DialError) throw plan().dial
          if (plan().dial instanceof Promise) await plan().dial
          const state = { closed: false }
          sockets.set(target, state)
          return { reach: 'host', send: () => {}, close: () => { state.closed = true }, onText: null, onClose: null, name: name(target) } as WireSocket
        },
        call: async () => ({ status: 200, body: name(target) }),
        transcribe: async () => ({ ok: true, value: name(target) }),
        dispose: () => void log.push(`dispose ${name(target)}`)
      }
    }
  }
  const route = pickedRoute({ ways: listed as [Target, ...Target[]], pick }, wayFor, picked => picks.push(picked), clock)
  return { route, log, picks, sockets, dial: () => route.dial({ start: false }) as Promise<WireSocket & { readonly name: string }> }
}

describe('pickedRoute', () => {
  it('dials the way that answered fastest, and says which it took with every time', async () => {
    const { dial, picks, log } = ways(planned([[TAILNET, { ms: 120 }], [LAN, { ms: 15 }], [WEB, { ms: null }]]))
    expect((await dial()).name).toBe('lan')
    expect(picks).toEqual([{ using: LAN, times: [{ target: TAILNET, ms: 120 }, { target: LAN, ms: 15 }, { target: WEB, ms: null }] }])
    expect(log.filter(line => line.startsWith('dial'))).toEqual(['dial lan'])
  })

  it('in order, dials the first way that answered, however slow', async () => {
    const { dial } = ways(planned([[TAILNET, { ms: 120 }], [LAN, { ms: 15 }]]), 'order')
    expect((await dial()).name).toBe('tailnet')
  })

  it('falls back to the next way when the dial of the best one fails', async () => {
    const { dial, picks, log } = ways(planned([[TAILNET, { ms: 120 }], [LAN, { ms: 15, dial: new DialError('unreachable') }]]))
    expect((await dial()).name).toBe('tailnet')
    expect(log.filter(line => line.startsWith('dial'))).toEqual(['dial lan', 'dial tailnet'])
    expect(picks.map(({ using }) => using)).toEqual([TAILNET])
  })

  it('dials a way that did not answer the timing once the others have failed', async () => {
    const { dial } = ways(planned([[TAILNET, { ms: null }], [LAN, { ms: 15, dial: new DialError('dropped') }]]))
    expect((await dial()).name).toBe('tailnet')
  })

  it('fails as the first way does when every way fails, and says nothing was picked', async () => {
    const { dial, picks } = ways(planned([[TAILNET, { ms: 120, dial: new DialError('auth') }], [LAN, { ms: 15, dial: new DialError('unreachable') }]]))
    await expect(dial()).rejects.toMatchObject({ kind: 'auth' })
    expect(picks).toEqual([])
  })

  it('dials the first answer once no slower way could win the tie, without waiting on a way that has not answered', async () => {
    let answer: (ms: number | null) => void = () => {}
    const silent = new Promise<number | null>(resolve => { answer = resolve })
    const clock = manualClock()
    const { dial, picks } = ways(planned([[TAILNET, { ms: silent }], [LAN, { ms: 15 }]]), 'fastest', undefined, clock)
    const dialing = dial()
    await clock.advance(TIE_MS)
    expect((await dialing).name).toBe('lan')
    expect(picks).toEqual([{ using: LAN, times: [{ target: LAN, ms: 15 }] }])
    answer(null)
    await until('the late time to be told', () => picks.length === 2)
    expect(picks[1]).toEqual({ using: LAN, times: [{ target: TAILNET, ms: null }, { target: LAN, ms: 15 }] })
  })

  it('in order, waits for the ways above an answer before it dials', async () => {
    let answer: (ms: number | null) => void = () => {}
    const first = new Promise<number | null>(resolve => { answer = resolve })
    const clock = manualClock()
    const { dial, log } = ways(planned([[TAILNET, { ms: first }], [LAN, { ms: 15 }]]), 'order', undefined, clock)
    const dialing = dial()
    await clock.advance(TIME_MS)
    expect(log.some(line => line.startsWith('dial'))).toBe(false)
    answer(120)
    expect((await dialing).name).toBe('tailnet')
  })

  it('when the fastest way fails, dials the next fastest once the ways still being timed are done, not the next in order', async () => {
    let tailnetAnswers: (ms: number | null) => void = () => {}
    let webAnswers: (ms: number | null) => void = () => {}
    const tailnet = new Promise<number | null>(resolve => { tailnetAnswers = resolve })
    const web = new Promise<number | null>(resolve => { webAnswers = resolve })
    const clock = manualClock()
    const { dial, log } = ways(planned([[TAILNET, { ms: tailnet }], [LAN, { ms: 15, dial: new DialError('unreachable') }], [WEB, { ms: web }]]), 'fastest', undefined, clock)
    const dialing = dial()
    await clock.advance(TIE_MS)
    await until('the LAN dial to fail', () => log.includes('dial lan'))
    webAnswers(40)
    tailnetAnswers(null)
    expect((await dialing).name).toBe('web')
    expect(log.filter(line => line.startsWith('dial'))).toEqual(['dial lan', 'dial web'])
  })

  it('when the fastest way fails, dials the next way to answer without waiting for a way still being timed', async () => {
    let webAnswers: (ms: number | null) => void = () => {}
    const web = new Promise<number | null>(resolve => { webAnswers = resolve })
    const clock = manualClock()
    const silent = new Promise<number | null>(() => {})
    const { dial, log } = ways(planned([[TAILNET, { ms: silent }], [LAN, { ms: 15, dial: new DialError('unreachable') }], [WEB, { ms: web }]]), 'fastest', undefined, clock)
    const dialing = dial()
    await clock.advance(TIE_MS)
    await until('the LAN dial to fail', () => log.includes('dial lan'))
    webAnswers(40)
    expect((await dialing).name).toBe('web')
    expect(log.filter(line => line.startsWith('dial'))).toEqual(['dial lan', 'dial web'])
  })

  it('lets only the latest of two dials in flight set the way in use', async () => {
    let connect = () => {}
    const slow = new Promise<void>(resolve => { connect = resolve })
    const plans = planned([[TAILNET, { ms: 120 }], [LAN, { ms: 15, dial: slow }]])
    const { route, dial, log, picks, sockets } = ways(plans)
    const first = dial()
    await until('the first dial to reach the LAN way', () => log.includes('dial lan'))
    plans.set(LAN, { ms: null, dial: new DialError('unreachable') })
    expect((await dial()).name).toBe('tailnet')
    connect()
    await expect(first).rejects.toMatchObject({ kind: 'dropped' })
    expect(sockets.get(LAN)?.closed).toBe(true)
    expect(picks.map(({ using }) => using)).toEqual([TAILNET])
    expect(await route.call({ method: 'GET', path: '/api/x', profile: null })).toEqual({ status: 200, body: 'tailnet' })
  })

  it('picks again when the pick changed while a dial was in flight, and closes a socket the new pick would not take', async () => {
    let connect = () => {}
    const slow = new Promise<void>(resolve => { connect = resolve })
    const { route, dial, log, sockets } = ways(planned([[TAILNET, { ms: 120 }], [LAN, { ms: 15, dial: slow }]]))
    const dialing = dial()
    await until('the dial to reach the LAN way', () => log.includes('dial lan'))
    route.arrange([TAILNET, LAN], 'order')
    connect()
    expect((await dialing).name).toBe('lan')
    await until('the LAN socket to close', () => sockets.get(LAN)?.closed === true)
    expect((await dial()).name).toBe('tailnet')
  })

  it('does not let the late times of an earlier dial hide the times of a way added since', async () => {
    let answer: (ms: number | null) => void = () => {}
    const silent = new Promise<number | null>(resolve => { answer = resolve })
    const clock = manualClock()
    const plans = planned([[TAILNET, { ms: silent }], [LAN, { ms: 15 }], [WEB, { ms: 300 }]])
    const { route, dial, picks } = ways(plans, 'fastest', [TAILNET, LAN], clock)
    const dialing = dial()
    await clock.advance(TIE_MS)
    await dialing
    plans.set(TAILNET, { ms: 120 })
    route.arrange([TAILNET, LAN, WEB], 'fastest')
    await until('the ways to be timed again', () => picks.some(({ times }) => times.length === 3))
    answer(null)
    await clock.advance(TIME_MS)
    expect(picks.at(-1)).toEqual({ using: LAN, times: [{ target: TAILNET, ms: 120 }, { target: LAN, ms: 15 }, { target: WEB, ms: 300 }] })
  })

  it('picks again on every dial', async () => {
    const plans = planned([[TAILNET, { ms: 120 }], [LAN, { ms: 15 }]])
    const { dial, picks } = ways(plans)
    await dial()
    plans.set(LAN, { ms: null, dial: new DialError('unreachable') })
    expect((await dial()).name).toBe('tailnet')
    expect(picks.map(({ using }) => using)).toEqual([LAN, TAILNET])
  })

  it('dials one way without timing it', async () => {
    const { dial, picks, log } = ways(planned([[TAILNET, { ms: 120 }]]))
    expect((await dial()).name).toBe('tailnet')
    expect(log).toEqual(['dial tailnet'])
    expect(picks).toEqual([{ using: TAILNET, times: [] }])
  })

  it('reads and transcribes through the first way until one connects, then through the way in use', async () => {
    const { route, dial } = ways(planned([[TAILNET, { ms: 120 }], [LAN, { ms: 15 }]]))
    expect(await route.call({ method: 'GET', path: '/api/x', profile: null })).toEqual({ status: 200, body: 'tailnet' })
    await dial()
    expect(await route.call({ method: 'GET', path: '/api/x', profile: null })).toEqual({ status: 200, body: 'lan' })
    expect(await route.transcribe({ bytes: new Uint8Array(), type: 'audio/webm' } as never)).toEqual({ ok: true, value: 'lan' })
  })

  it('arrange disposes a dropped way and closes the socket that went through it', async () => {
    const { route, dial, log, sockets } = ways(planned([[TAILNET, { ms: 120 }], [LAN, { ms: 15 }]]))
    await dial()
    route.arrange([TAILNET], 'fastest')
    expect(sockets.get(LAN)?.closed).toBe(true)
    expect(log.filter(line => line.startsWith('dispose'))).toEqual(['dispose lan'])
    log.length = 0
    expect((await dial()).name).toBe('tailnet')
    expect(log).toEqual(['dial tailnet'])
    expect(await route.call({ method: 'GET', path: '/api/x', profile: null })).toEqual({ status: 200, body: 'tailnet' })
  })

  it('arrange disposes no way that stays, and the next dial takes a way it added', async () => {
    const plans = planned([[TAILNET, { ms: 120 }], [LAN, { ms: 15 }], [WEB, { ms: 4 }]])
    const { route, dial, log } = ways(plans, 'fastest', [TAILNET, LAN])
    await dial()
    route.arrange([WEB, LAN, TAILNET], 'order')
    expect(log.some(line => line.startsWith('dispose'))).toBe(false)
    expect((await dial()).name).toBe('web')
  })

  it('arrange times the ways again, and closes the socket when a dial would now take another way', async () => {
    const { route, dial, sockets, picks } = ways(planned([[TAILNET, { ms: 120 }], [LAN, { ms: 15 }]]), 'fastest', [TAILNET])
    await dial()
    route.arrange([TAILNET, LAN], 'fastest')
    await until('the tailnet socket to close', () => sockets.get(TAILNET)?.closed === true)
    expect((await dial()).name).toBe('lan')
    expect(picks.at(-1)).toEqual({ using: LAN, times: [{ target: TAILNET, ms: 120 }, { target: LAN, ms: 15 }] })
  })

  it('arrange keeps the socket when the way in use is still the one a dial would take, and tells the new times', async () => {
    const { route, dial, sockets, picks, log } = ways(planned([[TAILNET, { ms: 120 }], [LAN, { ms: 15 }], [WEB, { ms: 300 }]]), 'fastest', [TAILNET, LAN])
    await dial()
    route.arrange([WEB, LAN, TAILNET], 'fastest')
    await until('the ways to be timed again', () => picks.length === 2)
    expect(sockets.get(LAN)?.closed).toBe(false)
    expect(picks[1]).toEqual({ using: LAN, times: [{ target: WEB, ms: 300 }, { target: LAN, ms: 15 }, { target: TAILNET, ms: 120 }] })
    expect(log.filter(line => line.startsWith('dial'))).toEqual(['dial lan'])
  })

  it('arrange down to one way stops telling times', async () => {
    const { route, dial, picks } = ways(planned([[TAILNET, { ms: 120 }], [LAN, { ms: 15 }]]))
    await dial()
    route.arrange([LAN], 'fastest')
    await until('the pick to be told again', () => picks.length === 2)
    expect(picks[1]).toEqual({ using: LAN, times: [] })
  })

  it('does not hand back a socket through a way an arrange dropped while it was being dialed', async () => {
    let connect = () => {}
    const slow = new Promise<void>(resolve => { connect = resolve })
    const { route, dial, log, sockets } = ways(planned([[TAILNET, { ms: 120 }], [LAN, { ms: 15, dial: slow }]]))
    const dialing = dial()
    await until('the dial to reach the LAN way', () => log.includes('dial lan'))
    route.arrange([TAILNET], 'fastest')
    connect()
    expect((await dialing).name).toBe('tailnet')
    expect(sockets.get(LAN)?.closed).toBe(true)
  })

  it('dispose ends every way, fails a dial in flight as dropped and refuses the next', async () => {
    let connect = () => {}
    const slow = new Promise<void>(resolve => { connect = resolve })
    const { route, dial, log, sockets } = ways(planned([[TAILNET, { ms: 120 }], [LAN, { ms: 15, dial: slow }]]))
    const dialing = dial()
    await until('the dial to reach the LAN way', () => log.includes('dial lan'))
    route.dispose()
    connect()
    await expect(dialing).rejects.toMatchObject({ kind: 'dropped' })
    expect(sockets.get(LAN)?.closed).toBe(true)
    expect(log.filter(line => line.startsWith('dispose'))).toEqual(['dispose tailnet', 'dispose lan'])
    await expect(dial()).rejects.toMatchObject({ kind: 'dropped' })
  })
})

describe('timeWay', () => {
  const signal = () => new AbortController().signal

  it('takes no time for this computer', async () => {
    expect(await timeWay({ kind: 'local' }, { signal: signal() })).toBe(0)
  })

  it('times a machine by one ssh login that runs no hermes command, the LAN name sooner than the tailnet name', async () => {
    const held = await host('ok')
    const [tailnet, lan] = await Promise.all([TAILNET, LAN].map(target => timeWay(target, { signal: signal(), sshBin: held.ssh })))
    expect(lan).not.toBeNull()
    expect(tailnet as number).toBeGreaterThan(lan as number)
    expect([...held.calls].sort()).toEqual([`ping ${FAKE_LAN_HOST}`, `ping ${FAKE_HOST}`])
  })

  it.each(['ssh-denied', 'ssh-missing'] as const)('gets no answer from a machine in the %s scenario', async name => {
    const held = await host(name)
    expect(await timeWay(LAN, { signal: signal(), sshBin: held.ssh })).toBeNull()
  })

  it('gets no answer from a machine ssh cannot resolve', async () => {
    const held = await host('ok')
    expect(await timeWay({ kind: 'ssh', host: '192.168.1.99' as SshHost }, { signal: signal(), sshBin: held.ssh })).toBeNull()
  })

  it('gives up on a silent machine at the deadline, and ends its ssh', async () => {
    const clock = manualClock()
    const held = await host('slow')
    const timing = timeWay(LAN, { signal: signal(), sshBin: held.ssh, clock })
    await until('ssh to start', () => held.running().length === 1)
    await clock.advance(TIME_MS)
    expect(await timing).toBeNull()
    await until('the hung ssh to end', () => held.running().length === 0)
  })

  it('times a gateway address by one HEAD request, and counts any status as an answer', async () => {
    const clock = manualClock()
    const asked: (readonly [string, string | undefined])[] = []
    const fetcher = (async (address: string, init?: RequestInit) => {
      asked.push([address, init?.method])
      await clock.advance(40)
      return new Response(null, { status: 401 })
    }) as typeof fetch
    expect(await timeWay(WEB, { signal: signal(), clock, fetch: fetcher })).toBe(40)
    expect(asked).toEqual([['https://hermes.example.com', 'HEAD']])
  })

  it('gets no answer from an address nothing answers at, or that answers after the deadline', async () => {
    const refused = (async () => { throw new TypeError('fetch failed') }) as typeof fetch
    expect(await timeWay(WEB, { signal: signal(), fetch: refused })).toBeNull()
    const clock = manualClock()
    const silent = ((_address: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })) as typeof fetch
    const timing = timeWay(WEB, { signal: signal(), clock, fetch: silent })
    await clock.advance(TIME_MS)
    expect(await timing).toBeNull()
  })
})
