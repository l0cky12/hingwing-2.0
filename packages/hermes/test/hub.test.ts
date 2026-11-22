import { describe, expect, it } from 'vitest'
import type { Item, PromptId, Session } from '../src/domain/session'
import { DialError, openHermes, type Dialer, type HermesOptions } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { play, scriptedDialer, type Fixture, type Moment, type ScriptOptions } from '../src/testing/fixture'
import { callsIn, ERRAND, paramsOf, SESSION, withSudo } from './support/errand'

const CLIENT = { name: 'highwing-test', version: '0.0.0' }
const TEXT = String(paramsOf('prompt.submit').text)
const PROMPT = paramsOf('approval.respond').prompt_id as PromptId
const SUDO = 'srq-0123456789ab'

function open(fixture: Fixture = ERRAND, options: ScriptOptions & Partial<HermesOptions> = {}) {
  const clock = manualClock()
  const script = scriptedDialer(fixture, { clock, ...options })
  const diagnostics: { kind: string; type: string }[] = []
  const starts: boolean[] = []
  const state: { failWith: DialError | null } = { failWith: null }
  const dial: Dialer = request => {
    starts.push(request.start)
    return state.failWith === null ? script(request) : Promise.reject(state.failWith)
  }
  const client = (more: Partial<HermesOptions> = {}) => openHermes({ dial, clock, client: CLIENT, onDiagnostic: what => diagnostics.push(what), ...options, ...more })
  const hermes = client()
  const seen: Session[] = []
  const sent = () => callsIn(script.received)
  const detaches = () => sent().filter(call => call.method === 'session.detach')
  return { clock, script, hermes, client, diagnostics, starts, state, seen, sent, detaches, watch: () => hermes.watch(SESSION, session => seen.push(session)) }
}

async function toApproval(opened: ReturnType<typeof open>) {
  await opened.clock.advance(0)
  expect(await opened.hermes.run({ do: 'send', sessionId: SESSION, text: TEXT })).toEqual({ ok: true, value: undefined })
  await opened.clock.advance(0)
}

const approve = (hermes: ReturnType<typeof open>['hermes']) =>
  hermes.run({ do: 'answer', sessionId: SESSION, promptId: PROMPT, reply: { kind: 'choice', value: 'once' } })

const itemsOf = (session: Session | undefined): readonly Item[] =>
  session === undefined ? [] : [...session.history.flatMap(turn => turn.items), ...(session.run.state === 'running' ? session.run.turn.items : [])]

describe('watch', () => {
  it('gives the current value at once and every later one', async () => {
    const opened = open()
    opened.watch()
    expect(opened.seen.map(session => session.sync.state)).toEqual(['offline'])
    await opened.clock.advance(0)
    expect(opened.seen.map(session => session.sync.state)).toEqual(['offline', 'opening', 'live'])
    expect(opened.hermes.link.get()).toEqual({ state: 'online' })
  })

  it('shares one attach between two watchers', async () => {
    const opened = open()
    opened.watch()
    const other: Session[] = []
    opened.hermes.watch(SESSION, session => other.push(session))
    await opened.clock.advance(0)
    expect(other.at(-1)).toBe(opened.seen.at(-1))
    expect(opened.sent().filter(call => call.method === 'session.resume')).toHaveLength(1)
  })
})

describe('retention', () => {
  it('detaches a session 60 s after nothing retains it', async () => {
    const opened = open()
    const unwatch = opened.watch()
    await opened.clock.advance(120_000)
    expect(opened.detaches(), 'a watched session stays attached').toEqual([])
    unwatch()
    await opened.clock.advance(59_999)
    expect(opened.detaches()).toEqual([])
    await opened.clock.advance(1)
    expect(opened.detaches()).toEqual([{ method: 'session.detach', params: { session_id: SESSION, subscription_id: 'subscription-1' } }])
  })

  it('keeps a session that is watched again inside the 60 s', async () => {
    const opened = open()
    const unwatch = opened.watch()
    await opened.clock.advance(0)
    unwatch()
    await opened.clock.advance(30_000)
    opened.watch()
    await opened.clock.advance(120_000)
    expect(opened.detaches()).toEqual([])
    expect(opened.sent().filter(call => call.method === 'session.resume')).toHaveLength(1)
  })

  it('keeps a session whose turn is running with no window on it, then lets it go 60 s after the turn ends', async () => {
    const opened = open()
    const unwatch = opened.watch()
    await toApproval(opened)
    unwatch()
    await opened.clock.advance(300_000)
    expect(opened.detaches(), 'the run is open').toEqual([])

    expect(await approve(opened.hermes)).toEqual({ ok: true, value: undefined })
    await opened.clock.advance(300)
    expect(opened.script.finished).toBe(true)
    expect(opened.hermes.sidebar.get().rows, 'the live list no longer reports it as running').toMatchObject([{ badge: 'none' }])
    await opened.clock.advance(59_999)
    expect(opened.detaches()).toEqual([])
    await opened.clock.advance(1)
    expect(opened.detaches()).toHaveLength(1)
  })

  it('attaches a session the gateway lists as running, so a chat no window shows turns its row to asking', async () => {
    const first = open()
    first.watch()
    await toApproval(first)

    const second = first.client()
    await first.clock.advance(0)
    expect(first.script.dials).toBe(2)
    expect(second.sidebar.get()).toMatchObject({ status: 'ready', rows: [{ id: SESSION, badge: 'asking' }] })

    expect(await approve(second), 'the second client is attached, so it may answer').toEqual({ ok: true, value: undefined })
    await first.clock.advance(1_000)
    expect(first.script.finished).toBe(true)
    expect(second.sidebar.get().rows).toMatchObject([{ id: SESSION, badge: 'none' }])
    expect(itemsOf(first.seen.at(-1)).find(item => item.kind === 'prompt')).toMatchObject({ state: { s: 'answered', reply: null } })
    await second.close()
  })
})

describe('refuse', () => {
  const declined = { kind: 'notice', what: 'declined', requestId: SUDO, method: 'sudo' }
  const declines = (moment: Moment) => moment.script.received.filter(frame => (frame as { id?: unknown }).id === SUDO)
  const last = async (played: AsyncIterable<Moment>) => {
    let moment: Moment | undefined
    for await (moment of played);
    return moment as Moment
  }

  it('answers a server request with JSON-RPC error -32601 and files a notice in the session', async () => {
    const moment = await last(play(withSudo(12)))
    expect(declines(moment)).toEqual([{ jsonrpc: '2.0', id: SUDO, error: { code: -32601, message: "Highwing can't show this prompt yet, so it said no." } }])
    expect(itemsOf(moment.session).filter(item => item.kind === 'notice')).toEqual([declined])
    expect(moment.session.history[0]?.outcome).toEqual({ kind: 'complete' })
  })

  it('refuses a request that an attach snapshot lists as still open', async () => {
    const moment = await last(play(withSudo(12), { drop: { afterPush: 12, missed: 3 } }))
    expect(moment.script.dials).toBe(2)
    expect(declines(moment)).toHaveLength(1)
    expect(itemsOf(moment.session).filter(item => item.kind === 'notice')).toEqual([declined])
  })

  it('counts what it declined and what it did not show', async () => {
    const opened = open(withSudo(12))
    opened.watch()
    await toApproval(opened)
    expect(opened.diagnostics).toContainEqual({ kind: 'declined', type: 'sudo' })
    expect(opened.diagnostics).toContainEqual({ kind: 'unshown', type: 'agent.step' })
    expect(opened.diagnostics.filter(what => what.kind === 'unrouted' || what.kind === 'invalid')).toEqual([])
  })
})

describe('the sidebar', () => {
  it('lists the gateway\'s sessions and derives each badge from the attached session', async () => {
    const opened = open()
    const badges: string[] = []
    opened.hermes.sidebar.subscribe(sidebar => badges.push(`${sidebar.status}:${sidebar.rows.map(row => row.badge).join()}`))
    expect(opened.hermes.sidebar.get()).toEqual({ status: 'loading', rows: [] })
    opened.watch()
    await toApproval(opened)
    await approve(opened.hermes)
    await opened.clock.advance(1_000)
    expect(badges).toEqual(['ready:none', 'ready:running', 'ready:asking', 'ready:running', 'ready:none'])
    expect(opened.hermes.sidebar.get().rows).toEqual([{ id: SESSION, title: '', preview: null, lastActiveAt: 1795251600000, badge: 'none' }])
  })

  it('goes stale while the socket is gone and reads both lists again when it is back', async () => {
    const opened = open(ERRAND, { drop: { afterPush: 5, missed: 0 } })
    opened.watch()
    await toApproval(opened)
    expect(opened.hermes.link.get()).toMatchObject({ state: 'waiting', why: 'dropped' })
    expect(opened.hermes.sidebar.get().status).toBe('stale')
    await opened.clock.advance(1_000)
    expect(opened.hermes.sidebar.get().status).toBe('ready')
    expect(opened.sent().filter(call => call.method === 'session.list'), 'both lists, on each of the two sockets').toHaveLength(4)
  })
})

describe('run', () => {
  it('refuses a session command while offline, as a value', async () => {
    const opened = open()
    expect(await opened.hermes.run({ do: 'send', sessionId: SESSION, text: 'hello' })).toEqual({
      ok: false, refusal: { kind: 'offline', message: "Highwing isn't connected to this chat right now." }
    })
    expect(await opened.hermes.run({ do: 'create', draftId: 'd', cwd: null })).toMatchObject({ ok: false, refusal: { kind: 'offline' } })
  })

  it('attaches a session nobody watches before it sends to it', async () => {
    const opened = open()
    await opened.clock.advance(0)
    const outcome = opened.hermes.run({ do: 'send', sessionId: SESSION, text: TEXT })
    await opened.clock.advance(0)
    expect(await outcome).toEqual({ ok: true, value: undefined })
    expect(opened.sent().map(call => call.method)).toEqual(expect.arrayContaining(['session.resume', 'prompt.submit']))
  })

  it('refuses an answer to a prompt that is not open, and a stop with nothing running', async () => {
    const opened = open()
    opened.watch()
    await opened.clock.advance(0)
    expect(await approve(opened.hermes)).toMatchObject({ ok: false, refusal: { kind: 'stale' } })
    expect(await opened.hermes.run({ do: 'stop', sessionId: SESSION })).toMatchObject({ ok: false, refusal: { kind: 'stale' } })
  })

  it('creates a session with the gateway\'s default folder unless one is given, then attaches it', async () => {
    const opened = open()
    await opened.clock.advance(0)
    const made = opened.hermes.run({ do: 'create', draftId: 'draft-1', cwd: null })
    await opened.clock.advance(0)
    expect(await made).toEqual({ ok: true, value: SESSION })
    const inFolder = opened.hermes.run({ do: 'create', draftId: 'draft-2', cwd: '/tmp/work' })
    await opened.clock.advance(0)
    await inFolder
    expect(opened.sent().filter(call => call.method === 'session.create').map(call => call.params)).toEqual([
      { source: 'gui', request_id: 'draft-1', client: CLIENT },
      { source: 'gui', request_id: 'draft-2', cwd: '/tmp/work', cwd_explicit: true, client: CLIENT }
    ])
    expect(opened.sent().filter(call => call.method === 'session.resume'), 'the new session takes the one attach path').toHaveLength(1)
  })

  it('refuses to create when the gateway offers no gui source', async () => {
    const header = { ...ERRAND.header, describe: { ...(ERRAND.header.describe as object), session_create: { sources: ['cli'], parameters: [] } } }
    const opened = open({ ...ERRAND, header })
    await opened.clock.advance(0)
    expect(await opened.hermes.run({ do: 'create', draftId: 'd', cwd: null })).toMatchObject({ ok: false, refusal: { kind: 'unsupported' } })
  })
})

describe('starting the gateway', () => {
  it('is asked on the first dial after launch by default, and never on an automatic retry', async () => {
    const opened = open()
    opened.state.failWith = new DialError('not-running')
    await opened.clock.advance(120_000)
    expect(opened.starts.length).toBeGreaterThan(5)
    expect(opened.starts).toEqual([true, ...opened.starts.slice(1).map(() => false)])
    expect(opened.hermes.link.get()).toMatchObject({ state: 'waiting', why: 'not-running', message: "Hermes isn't running." })
  })

  it('is not asked at launch when startGatewayOnLaunch is false, and is asked by reconnect with start', async () => {
    const opened = open(ERRAND, { startGatewayOnLaunch: false })
    opened.state.failWith = new DialError('not-running')
    await opened.clock.advance(100)
    expect(opened.starts).toEqual([false])
    opened.state.failWith = null
    expect(await opened.hermes.run({ do: 'reconnect', start: true })).toEqual({ ok: true, value: undefined })
    await opened.clock.advance(0)
    expect(opened.starts).toEqual([false, true])
    expect(opened.hermes.link.get()).toEqual({ state: 'online' })
  })
})
