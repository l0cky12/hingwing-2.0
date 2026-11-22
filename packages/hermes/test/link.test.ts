import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { backoffMs, DialError, liveDialer, Offline, RpcRefusal } from '../src/wire/link'
import { DESCRIBE, fakeGateway } from './support/wire'

const NOT_RUNNING = new DialError('not-running')

describe('the handshake', () => {
  it('goes online after gateway.ready, client.capabilities and runtime.describe, in that order', async () => {
    const gateway = fakeGateway()
    expect(gateway.conn.link).toEqual({ state: 'connecting', attempt: 1 })
    await gateway.clock.advance(0)
    expect(gateway.last().sent).toMatchObject([
      { method: 'client.capabilities', params: { server_requests: true } },
      { method: 'runtime.describe', params: {} }
    ])
    expect(gateway.conn.link).toEqual({ state: 'online' })
    expect(gateway.links).toEqual([{ state: 'online' }])
    expect(gateway.state.online).toBe(1)
    expect(gateway.conn.creation).toEqual(DESCRIBE.session_create)
  })

  it('blocks on a gateway whose ready event names no session authority', async () => {
    const gateway = fakeGateway()
    gateway.state.ready = { heartbeat: true }
    await gateway.clock.advance(120_000)
    expect(gateway.conn.link).toEqual({ state: 'blocked', why: 'incompatible', message: 'This Hermes gateway is too old for Highwing.' })
    expect(gateway.last().closedByClient).toBe(true)
    expect(gateway.dials).toHaveLength(1)
  })

  it('gives up on a socket that sends no gateway.ready within 10 s and redials', async () => {
    const gateway = fakeGateway()
    gateway.state.ready = null
    await gateway.clock.advance(9_999)
    expect(gateway.conn.link.state).toBe('connecting')
    await gateway.clock.advance(1)
    expect(gateway.peers[0]?.closedByClient).toBe(true)
    expect(gateway.conn.link).toMatchObject({ state: 'waiting', why: 'dropped', attempt: 1 })
  })
})

describe('backoff', () => {
  it('waits 1 s, doubling to 30 s', async () => {
    const gateway = fakeGateway()
    gateway.state.failWith = NOT_RUNNING
    const waits: number[] = []
    for (let dial = 1; dial <= 8; dial++) {
      await gateway.clock.advance(0)
      expect(gateway.dials).toHaveLength(dial)
      const { link } = gateway.conn
      if (link.state !== 'waiting') throw new Error(`dial ${dial}: link is ${link.state}, expected waiting`)
      expect(link).toMatchObject({ why: 'not-running', attempt: dial, message: "Hermes isn't running." })
      waits.push(link.retryAt - gateway.clock.now())
      await gateway.clock.advance(link.retryAt - gateway.clock.now() - 1)
      expect(gateway.dials, `no dial before the wait of attempt ${dial} is over`).toHaveLength(dial)
      await gateway.clock.advance(1)
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000])
  })

  it('jitters each wait between half and all of it', () => {
    expect([1, 2, 6].map(attempt => backoffMs(attempt, 0))).toEqual([500, 1_000, 15_000])
    expect([1, 2, 6].map(attempt => backoffMs(attempt, 1))).toEqual([1_000, 2_000, 30_000])
    expect(backoffMs(3, 0.5)).toBe(3_000)
  })

  it('takes its jitter from the injected random source', async () => {
    const gateway = fakeGateway({ random: () => 0 })
    gateway.state.failWith = NOT_RUNNING
    await gateway.clock.advance(0)
    expect(gateway.conn.link).toMatchObject({ state: 'waiting', retryAt: 500 })
  })

  const flap = async (onlineMs: number) => {
    const gateway = fakeGateway()
    gateway.state.failWith = NOT_RUNNING
    await gateway.clock.advance(1_000 + 2_000)
    expect(gateway.dials).toHaveLength(3)
    gateway.state.failWith = null
    await gateway.clock.advance(4_000)
    expect(gateway.conn.link.state).toBe('online')
    await gateway.clock.advance(onlineMs)
    const droppedAt = gateway.clock.now()
    gateway.last().drop()
    await gateway.clock.advance(0)
    const { link } = gateway.conn
    if (link.state !== 'waiting') throw new Error(`link is ${link.state}, expected waiting`)
    return link.retryAt - droppedAt
  }

  it('starts again at 1 s after a socket that stayed online for 30 s', async () => {
    expect(await flap(30_000)).toBe(1_000)
  })

  it('keeps doubling after a socket that dropped sooner', async () => {
    expect(await flap(29_000)).toBe(8_000)
  })

  it('does not retry a failure that needs the user, until retryNow', async () => {
    const gateway = fakeGateway()
    gateway.state.failWith = new DialError('auth')
    await gateway.clock.advance(600_000)
    expect(gateway.conn.link).toEqual({ state: 'blocked', why: 'auth', message: 'Hermes refused access to this profile.' })
    expect(gateway.dials).toHaveLength(1)
    gateway.state.failWith = null
    gateway.conn.retryNow({ start: false })
    await gateway.clock.advance(0)
    expect(gateway.conn.link.state).toBe('online')
  })
})

describe('start', () => {
  it('is passed on the first dial after launch and on no automatic retry', async () => {
    const gateway = fakeGateway()
    gateway.state.failWith = NOT_RUNNING
    await gateway.clock.advance(60_000)
    expect(gateway.dials.length).toBeGreaterThan(5)
    expect(gateway.dials).toEqual([true, ...gateway.dials.slice(1).map(() => false)])
  })

  it('is not passed at launch when the app may not start the gateway', async () => {
    const gateway = fakeGateway({ startOnLaunch: false })
    await gateway.clock.advance(0)
    expect(gateway.dials).toEqual([false])
  })

  it('is passed by retryNow({start: true}), at once, and not by the retry after it', async () => {
    const gateway = fakeGateway({ startOnLaunch: false })
    gateway.state.failWith = NOT_RUNNING
    await gateway.clock.advance(100)
    gateway.conn.retryNow({ start: true })
    await gateway.clock.advance(0)
    expect(gateway.dials).toEqual([false, true])
    await gateway.clock.advance(60_000)
    expect(gateway.dials.slice(2).every(start => !start)).toBe(true)
    gateway.conn.retryNow({ start: false })
    await gateway.clock.advance(0)
    expect(gateway.dials.at(-1)).toBe(false)
  })

  it('is not passed on the redial after a drop', async () => {
    const gateway = fakeGateway()
    await gateway.clock.advance(0)
    gateway.last().drop()
    await gateway.clock.advance(1_000)
    expect(gateway.dials).toEqual([true, false])
    expect(gateway.conn.link.state).toBe('online')
  })
})

describe('the heartbeat', () => {
  it('pings every 15 s and keeps a socket that answers', async () => {
    const gateway = fakeGateway()
    await gateway.clock.advance(120_000)
    expect(gateway.last().sent.filter(frame => frame.method === 'gateway.ping')).toHaveLength(8)
    expect(gateway.conn.link.state).toBe('online')
    expect(gateway.peers).toHaveLength(1)
  })

  it('closes the socket after 45 s with no frame, and fails the calls that were waiting', async () => {
    const gateway = fakeGateway()
    await gateway.clock.advance(0)
    const peer = gateway.last()
    peer.mute.add('gateway.ping')
    const waiting = gateway.conn.call('session.info', { session_id: 's' }).catch((error: unknown) => error)
    await gateway.clock.advance(44_999)
    expect(peer.closedByClient).toBe(false)
    await gateway.clock.advance(1)
    expect(peer.closedByClient).toBe(true)
    expect(gateway.conn.link).toMatchObject({ state: 'waiting', why: 'dropped' })
    expect(await waiting).toBeInstanceOf(Offline)
  })

  it('counts any frame as life, not only a pong', async () => {
    const gateway = fakeGateway()
    await gateway.clock.advance(0)
    const peer = gateway.last()
    peer.mute.add('gateway.ping')
    await gateway.clock.advance(40_000)
    peer.push({ jsonrpc: '2.0', method: 'event', params: { type: 'sessions.changed' } })
    await gateway.clock.advance(44_000)
    expect(peer.closedByClient).toBe(false)
    await gateway.clock.advance(6_000)
    expect(peer.closedByClient).toBe(true)
  })
})

describe('calls', () => {
  const online = async () => {
    const gateway = fakeGateway()
    await gateway.clock.advance(0)
    const peer = gateway.last()
    peer.sent.length = 0
    return { gateway, peer, conn: gateway.conn }
  }

  it('writes calls in call order and matches each reply by id', async () => {
    const { gateway, peer, conn } = await online()
    const since = conn.call('session.events.since', { session_id: 's', last_seen: 4, replay_epoch: 'e' })
    const resume = conn.call('session.resume', { session_id: 's', omit_messages: true, defer_history: true })
    expect(peer.sent.map(frame => frame.method)).toEqual(['session.events.since', 'session.resume'])
    peer.reply(peer.sent[1]?.id, { which: 'resume' })
    peer.reply(peer.sent[0]?.id, { which: 'since' })
    await gateway.clock.advance(0)
    expect(await since).toEqual({ which: 'since' })
    expect(await resume).toEqual({ which: 'resume' })
  })

  it('rejects with the gateway\'s reason, and the revision a conflict carries', async () => {
    const { peer, conn } = await online()
    const call = conn.call('session.interrupt', { session_id: 's', execution_generation: 1 }).catch((error: unknown) => error)
    peer.refuse(peer.sent[0]?.id, { code: 4001, message: 'revision_conflict', data: { reason: 'revision_conflict', revision: 7 } })
    const refusal = await call
    expect(refusal).toBeInstanceOf(RpcRefusal)
    expect(refusal).toMatchObject({ code: 4001, reason: 'revision_conflict', revision: 7 })
  })

  it('rejects a call made while not online, without writing it', async () => {
    const gateway = fakeGateway()
    gateway.state.failWith = NOT_RUNNING
    await gateway.clock.advance(0)
    await expect(gateway.conn.call('session.list', {})).rejects.toBeInstanceOf(Offline)
  })

  it('rejects a call that outlives its own timeout', async () => {
    const { gateway, conn } = await online()
    const call = conn.call('session.list', {}, 5_000).catch((error: unknown) => error)
    await gateway.clock.advance(5_000)
    expect(await call).toBeInstanceOf(Offline)
    expect(conn.link.state).toBe('online')
  })

  it('hands events and server requests to the owner, and declines a request with -32601', async () => {
    const { gateway, peer, conn } = await online()
    peer.push({ jsonrpc: '2.0', method: 'event', params: { type: 'sessions.changed' } })
    peer.push({ jsonrpc: '2.0', id: 'srq-1', method: 'sudo', params: { session_id: 's', command: 'sudo ls' } })
    expect(gateway.events).toEqual([{ type: 'sessions.changed' }])
    expect(gateway.requests).toEqual([{ id: 'srq-1', method: 'sudo', params: { session_id: 's', command: 'sudo ls' } }])
    conn.decline('srq-1', 'no')
    expect(peer.sent).toEqual([{ jsonrpc: '2.0', id: 'srq-1', error: { code: -32601, message: 'no' } }])
  })

  it('stops for good on close', async () => {
    const { gateway, peer, conn } = await online()
    conn.close()
    expect(peer.closedByClient).toBe(true)
    await gateway.clock.advance(600_000)
    expect(gateway.dials).toHaveLength(1)
    await expect(conn.call('session.list', {})).rejects.toBeInstanceOf(Offline)
  })
})

describe('liveDialer', () => {
  /** A stand-in `hermes` that records its arguments, prints `stdout` and exits with `code`. */
  const hermes = (code: number, stdout: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'highwing-hermes-'))
    const bin = join(dir, 'hermes')
    writeFileSync(join(dir, 'stdout'), stdout)
    writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${dir}/args"\ncat "${dir}/stdout"\nexit ${code}\n`)
    chmodSync(bin, 0o755)
    return { bin, args: () => readFileSync(join(dir, 'args'), 'utf8').trim().split('\n') }
  }
  const kindOf = (dial: Promise<unknown>) => dial.then(() => 'resolved', (error: unknown) => (error instanceof DialError ? error.kind : `threw ${String(error)}`))

  it.each([
    [2, 'incompatible'], [3, 'incompatible'], [4, 'auth'], [5, 'not-running'], [6, 'draining'], [7, 'inaccessible'], [9, 'inaccessible']
  ])('reads exit code %i of `hermes gateway attach` as %s', async (code, kind) => {
    const { bin } = hermes(code, '{"state":"absent","message":"gateway absent"}\n')
    expect(await kindOf(liveDialer({ hermesBin: bin })({ start: false }))).toBe(kind)
  })

  it('reads a missing hermes command as hermes-missing', async () => {
    expect(await kindOf(liveDialer({ hermesBin: join(tmpdir(), 'no-such-hermes') })({ start: false }))).toBe('hermes-missing')
  })

  it('asks for a start only when told to, and dials the url the command printed', async () => {
    const { bin, args } = hermes(0, '{"url":"ws://127.0.0.1:1/api/ws","protocols":["hermes-gateway-v1","hermes-gateway-ticket.t"],"ticket":"t"}\n')
    const dial = liveDialer({ hermesBin: bin })
    expect(await kindOf(dial({ start: false }))).toBe('dropped')
    expect(await kindOf(dial({ start: true }))).toBe('dropped')
    expect(args()).toEqual(['gateway attach --json --timeout 20', 'gateway attach --json --start --timeout 75'])
  })

  it('reads output that names no url as incompatible', async () => {
    const { bin } = hermes(0, 'ready\n')
    expect(await kindOf(liveDialer({ hermesBin: bin })({ start: false }))).toBe('incompatible')
  })
})

describe('time', () => {
  it('is read from the system in one file, where the system clock is', () => {
    const src = fileURLToPath(new URL('../src/', import.meta.url))
    const readers = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter(file => file.endsWith('.ts') && !file.endsWith('contract.generated.ts'))
      .filter(file => /\bDate\b|\bperformance\b|(?<![.\w])(setTimeout|setInterval)\(/.test(readFileSync(join(src, file), 'utf8')))
    expect(readers).toEqual(['wire/link.ts'])
  })
})
