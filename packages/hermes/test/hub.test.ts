import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import type { AttachmentId, BranchId, Item, PromptId, RequestId, Session, SessionId } from '../src/domain/session'
import { DialError, openHermes, RETAIN_MS, type Dialer, type HermesOptions, type WireSocket } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { MASKED, play, scriptedDialer, type Fixture, type FixtureStep, type Moment, type ScriptOptions } from '../src/testing/fixture'
import {
  BOUND, BRANCH, BRANCH_OLD, callsIn, DOWNLOADS, ERRAND, INVOICES, NO_HOME_CHAT, NO_TREE, paramsOf, PICK, PICK_ASK, PICK_DECLINED, PROFILES, RAE_SAID, REMINDER, RESEARCH_CHAT, RESEARCH_SAID,
  SESSION, SLASH, stepOf, SORTED, SORTED_2, SORTED_3, SUDO, SUDO_ASK, TEAM, TEAM_NO_RELAY, WITH_BOTS, WITH_CHATS, WITH_VERSIONS, withSteps
} from './support/errand'

const CLIENT = { name: 'highwing-test', version: '0.0.0' }
const TEXT = String(paramsOf('prompt.submit').text)
const PROMPT = paramsOf('approval.respond').prompt_id as PromptId

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
  expect(await opened.hermes.run({ do: 'send', sessionId: SESSION, text: TEXT })).toEqual({ ok: true, value: null })
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

describe('a request Highwing has no card for', () => {
  const declined = { kind: 'notice', what: 'declined', requestId: PICK, method: 'theme.pick' }
  const answersTo = (received: readonly unknown[], id: string) => received.filter(frame => (frame as { id?: unknown }).id === id)
  const last = async (played: AsyncIterable<Moment>) => {
    let moment: Moment | undefined
    for await (moment of played);
    return moment as Moment
  }

  it('is declined with JSON-RPC error -32601 while a window watches the chat, and leaves a notice', async () => {
    const moment = await last(play(withSteps(12, PICK_ASK, PICK_DECLINED)))
    expect(answersTo(moment.script.received, PICK)).toEqual([{ jsonrpc: '2.0', id: PICK, error: PICK_DECLINED.error }])
    expect(itemsOf(moment.session).filter(item => item.kind === 'notice')).toEqual([declined])
    expect(moment.session.history[0]?.outcome).toEqual({ kind: 'complete' })
  })

  it('is declined when an attach snapshot lists it as still open, and its notice is filed once', async () => {
    const moment = await last(play(withSteps(12, PICK_ASK, PICK_DECLINED), { drop: { afterPush: 13, missed: 3 } }))
    expect(moment.script.dials).toBe(2)
    expect(answersTo(moment.script.received, PICK)).toHaveLength(1)
    expect(itemsOf(moment.session).filter(item => item.kind === 'notice')).toEqual([declined])
  })

  it('is left open while no window watches the chat', async () => {
    const opened = open(withSteps(12, PICK_ASK))
    await toApproval(opened)
    expect(answersTo(opened.script.received, PICK), 'the story has no answer step, so a decline would also fail it').toEqual([])
    expect(opened.diagnostics).toContainEqual({ kind: 'unshown', type: 'theme.pick' })
    expect(opened.diagnostics.filter(what => what.kind === 'declined')).toEqual([])
    await expect(Promise.race([opened.script.done, Promise.resolve('playing')])).resolves.toBe('playing')
  })

  it('counts what it declined and what it did not show', async () => {
    const opened = open(withSteps(12, PICK_ASK, PICK_DECLINED))
    opened.watch()
    await toApproval(opened)
    expect(opened.diagnostics).toContainEqual({ kind: 'declined', type: 'theme.pick' })
    expect(opened.diagnostics).toContainEqual({ kind: 'unshown', type: 'agent.step' })
    expect(opened.diagnostics.filter(what => what.kind === 'unrouted' || what.kind === 'invalid')).toEqual([])
  })
})

describe('a request Highwing has a card for', () => {
  const answersTo = (opened: ReturnType<typeof open>) => opened.script.received.filter(frame => (frame as { id?: unknown }).id === SUDO)
  const sudo = (opened: ReturnType<typeof open>) => opened.hermes.run({ do: 'send', sessionId: SESSION, text: TEXT }).then(async sent => {
    await opened.clock.advance(0)
    return sent
  })
  const held = (opened: ReturnType<typeof open>) => {
    let session: Session | undefined
    opened.hermes.watch(SESSION, next => { session = next })()
    return session?.requests ?? []
  }

  it.each([['watched', true], ['unwatched', false]] as const)('is never declined, %s: it waits in the session', async (_name, watched) => {
    const opened = open(withSteps(12, SUDO_ASK))
    if (watched) opened.watch()
    await opened.clock.advance(0)
    await sudo(opened)
    expect(answersTo(opened)).toEqual([])
    expect(held(opened)).toMatchObject([{ id: SUDO, ask: { kind: 'secret', for: { is: 'sudo', command: 'sudo true' } }, state: { s: 'waiting' }, deadline: expect.any(Number) }])
    expect(opened.diagnostics.filter(what => what.kind === 'declined')).toEqual([])
  })

  it('keeps the chat attached while Hermes waits on it, and badges it as asking', async () => {
    const opened = open(withSteps(ERRAND.steps.filter(step => 'push' in step).length, SUDO_ASK))
    await opened.clock.advance(0)
    await sudo(opened)
    await approve(opened.hermes)
    await opened.clock.advance(120_000)
    expect(held(opened)).toHaveLength(1)
    expect(opened.detaches(), 'the turn ended, and the request still holds the chat').toEqual([])
    expect(opened.hermes.sidebar.get().rows).toMatchObject([{ id: SESSION, badge: 'asking' }])
  })

  it('is answered with a result frame, and the typed value reaches no published session', async () => {
    const opened = open(withSteps(12, SUDO_ASK, { answer: SUDO, result: { value: MASKED } }))
    opened.watch()
    await opened.clock.advance(0)
    await sudo(opened)
    expect(await opened.hermes.run({ do: 'answer', sessionId: SESSION, requestId: SUDO as RequestId, reply: { kind: 'secret', value: 'hunter2' } })).toEqual({ ok: true, value: undefined })
    await opened.clock.advance(0)
    expect(answersTo(opened)).toEqual([{ jsonrpc: '2.0', id: SUDO, result: { value: 'hunter2' } }])
    expect(opened.seen.at(-1)?.requests).toMatchObject([{ id: SUDO, state: { s: 'sending', reply: { kind: 'withheld' } } }])
    expect(JSON.stringify(opened.seen)).not.toContain('hunter2')
  })

  it('is skipped with an empty value', async () => {
    const opened = open(withSteps(12, SUDO_ASK, { answer: SUDO, result: { value: '' } }))
    opened.watch()
    await opened.clock.advance(0)
    await sudo(opened)
    await opened.hermes.run({ do: 'answer', sessionId: SESSION, requestId: SUDO as RequestId, reply: { kind: 'skip' } })
    await opened.clock.advance(0)
    expect(answersTo(opened)).toEqual([{ jsonrpc: '2.0', id: SUDO, result: { value: '' } }])
  })

  it('refuses a reply the request does not take, an empty secret, and a request that is not open, and sends nothing', async () => {
    const opened = open(withSteps(12, SUDO_ASK))
    opened.watch()
    await opened.clock.advance(0)
    await sudo(opened)
    const answer = (requestId: string, reply: Extract<Parameters<typeof opened.hermes.run>[0], { requestId: RequestId }>['reply']) =>
      opened.hermes.run({ do: 'answer', sessionId: SESSION, requestId: requestId as RequestId, reply })
    expect(await answer(SUDO, { kind: 'lock', question: 'q0', answer: ['a'] })).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(await answer(SUDO, { kind: 'secret', value: '' })).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(await answer('srq-gone', { kind: 'skip' })).toMatchObject({ ok: false, refusal: { kind: 'stale' } })
    await opened.clock.advance(0)
    expect(answersTo(opened)).toEqual([])
    expect(opened.seen.at(-1)?.requests).toMatchObject([{ state: { s: 'waiting', error: null } }])
  })
})

describe('the sidebar', () => {
  it('lists the gateway\'s sessions and derives each badge from the attached session', async () => {
    const opened = open()
    const badges: string[] = []
    opened.hermes.sidebar.subscribe(sidebar => badges.push(`${sidebar.status}:${sidebar.rows.map(row => row.badge).join()}`))
    expect(opened.hermes.sidebar.get()).toEqual({ bot: null, status: 'loading', rows: [] })
    opened.watch()
    await toApproval(opened)
    await approve(opened.hermes)
    await opened.clock.advance(1_000)
    expect(badges).toEqual(['ready:none', 'ready:running', 'ready:asking', 'ready:running', 'ready:none'])
    expect(opened.hermes.sidebar.get().rows).toEqual([{ id: SESSION, title: '', preview: null, lastActiveAt: 1795251600000, badge: 'none' }])
  })

  it('goes stale while the socket is gone and reads the lists again when it is back', async () => {
    const opened = open(ERRAND, { drop: { afterPush: 5, missed: 0 } })
    opened.watch()
    await toApproval(opened)
    expect(opened.hermes.link.get()).toMatchObject({ state: 'waiting', why: 'dropped' })
    expect(opened.hermes.sidebar.get().status).toBe('stale')
    await opened.clock.advance(1_000)
    expect(opened.hermes.sidebar.get().status).toBe('ready')
    expect(opened.sent().filter(call => call.method === 'session.list'), 'the three lists, on each of the two sockets').toHaveLength(6)
  })
})

describe('run', () => {
  it('refuses a session command while offline, as a value', async () => {
    const opened = open()
    expect(await opened.hermes.run({ do: 'send', sessionId: SESSION, text: 'hello' })).toEqual({
      ok: false, refusal: { kind: 'offline', message: "Highwing isn't connected to this chat right now." }
    })
  })

  it('attaches a session nobody watches before it sends to it', async () => {
    const opened = open()
    await opened.clock.advance(0)
    const outcome = opened.hermes.run({ do: 'send', sessionId: SESSION, text: TEXT })
    await opened.clock.advance(0)
    expect(await outcome).toEqual({ ok: true, value: null })
    expect(opened.sent().map(call => call.method)).toEqual(expect.arrayContaining(['session.resume', 'prompt.submit']))
  })

  it('refuses an answer to a prompt that is not open, and a stop with nothing running', async () => {
    const opened = open()
    opened.watch()
    await opened.clock.advance(0)
    expect(await approve(opened.hermes)).toMatchObject({ ok: false, refusal: { kind: 'stale' } })
    expect(await opened.hermes.run({ do: 'stop', sessionId: SESSION })).toMatchObject({ ok: false, refusal: { kind: 'stale' } })
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

const RECEIPT = (ERRAND.steps[stepOf('prompt.submit')] as Extract<FixtureStep, { await: string }>).reply
const story = (...steps: readonly Omit<Extract<FixtureStep, { await: string }>, 'at'>[]): Fixture => ({ header: SLASH.header, steps: steps.map(step => ({ at: 0, ...step })) })

describe('the slash catalog', () => {
  it('is read once the link is online, and lists the commands the gateway runs and the skills', async () => {
    const opened = open(SLASH)
    expect(opened.hermes.slash.get()).toEqual([])
    await opened.clock.advance(0)
    const names = opened.hermes.slash.get().map(entry => `${entry.kind}:${entry.name}`)
    expect(names).toHaveLength(36)
    expect(names.slice(0, 2)).toEqual(['command:new', 'command:title'])
    expect(names.slice(-2)).toEqual(['skill:code-review', 'skill:release-notes'])
    expect(opened.sent().filter(call => call.method === 'commands.catalog')).toEqual([{ method: 'commands.catalog', params: {} }])
  })

  it('stays empty, with nothing counted, when Hermes does not know the call', async () => {
    const opened = open(ERRAND)
    await opened.clock.advance(0)
    expect(opened.sent().some(call => call.method === 'commands.catalog')).toBe(true)
    expect(opened.hermes.slash.get()).toEqual([])
    expect(opened.diagnostics).toEqual([])
  })

  it('is read again on every new socket', async () => {
    const opened = open(SLASH, { drop: { afterPush: 5, missed: 0 } })
    opened.watch()
    await toApproval(opened)
    await opened.clock.advance(1_000)
    expect(opened.sent().filter(call => call.method === 'commands.catalog'), 'once on each of the two sockets').toHaveLength(2)
    expect(opened.hermes.slash.get()).toHaveLength(36)
  })
})

describe('the bots', () => {
  const asks = (opened: ReturnType<typeof open>) => opened.sent().filter(call => call.method === 'profiles.list')
  const names = (opened: ReturnType<typeof open>) => {
    const bots = opened.hermes.bots.get()
    return bots.state === 'listed' ? [bots.roster.featured?.name, ...bots.roster.sections.flatMap(section => section.bots.map(bot => bot.name))] : bots.state
  }

  it('are loading, then listed once the link is online, in the order the sidebar draws them', async () => {
    const opened = open(WITH_BOTS)
    const states: string[] = []
    opened.hermes.bots.subscribe(bots => states.push(bots.state))
    expect(opened.hermes.bots.get()).toEqual({ state: 'loading' })
    await opened.clock.advance(0)
    expect(states).toEqual(['listed'])
    expect(names(opened)).toEqual(['Emu', 'dr eggbot', 'Research', 'Timothy · CEO', 'Hermes', 'highwing'])
    expect(asks(opened)).toEqual([{ method: 'profiles.list', params: { include_sessions: true } }])
  })

  it('are unsupported, with nothing counted, on a Hermes that does not know the call, which is then asked once for the whole errand', async () => {
    const opened = open()
    opened.watch()
    await opened.clock.advance(0)
    expect(opened.hermes.bots.get()).toEqual({ state: 'unsupported' })
    expect(opened.diagnostics).toEqual([])
    await toApproval(opened)
    await approve(opened.hermes)
    await opened.clock.advance(1_000)
    expect(opened.script.finished).toBe(true)
    expect(asks(opened)).toHaveLength(1)
  })

  it('are offline when the first dial fails, then listed after a reconnect', async () => {
    const opened = open(WITH_BOTS)
    opened.state.failWith = new DialError('not-running')
    await opened.clock.advance(100)
    expect(opened.hermes.bots.get()).toEqual({ state: 'offline' })
    opened.state.failWith = null
    await opened.hermes.run({ do: 'reconnect', start: true })
    await opened.clock.advance(0)
    expect(names(opened)).toHaveLength(6)
  })

  it('stay listed while the socket is gone, and are read again on the new one', async () => {
    const opened = open(WITH_BOTS, { drop: { afterPush: 5, missed: 0 } })
    opened.watch()
    await toApproval(opened)
    expect(opened.hermes.link.get()).toMatchObject({ state: 'waiting', why: 'dropped' })
    expect(names(opened)).toHaveLength(6)
    await opened.clock.advance(1_000)
    expect(opened.hermes.link.get()).toEqual({ state: 'online' })
    expect(asks(opened).length, 'at least once on each of the two sockets').toBeGreaterThanOrEqual(2)
    expect(names(opened)).toHaveLength(6)
  })

  it('show a preview that changed in Hermes 300 ms after the turn ends', async () => {
    const profiles = structuredClone(PROFILES) as { profiles: { canonical_session: { preview: string } | null }[] }
    const opened = open({ ...ERRAND, header: { ...ERRAND.header, profiles } })
    const previewOf = () => {
      const bots = opened.hermes.bots.get()
      return bots.state === 'listed' ? bots.roster.sections[0]?.bots[0]?.preview : bots.state
    }
    opened.watch()
    await toApproval(opened)
    profiles.profiles[1]!.canonical_session!.preview = 'A newer line.'
    await approve(opened.hermes)
    await opened.clock.advance(0)
    expect(opened.script.finished).toBe(true)
    expect(previewOf()).toBe('the SOUL.md is the same thi')
    await opened.clock.advance(300)
    expect(previewOf()).toBe('A newer line.')
  })
})

describe('the open chat', () => {
  const [EMU, RESEARCH, HERMES_DEV] = ['default', 'research', 'hermes-dev'] as BotId[] as [BotId, BotId, BotId]
  const MADE = 'bot-chat-hermes-dev' as SessionId
  const bot = (id: BotId) => ({ kind: 'bot', bot: id }) as const
  const unstarted = (id: BotId) => ({ kind: 'bot', bot: id, sessionId: null }) as const
  const calls = (opened: ReturnType<typeof open>, method: string) => opened.sent().filter(call => call.method === method)
  const saidIn = (opened: ReturnType<typeof open>, id: SessionId) => {
    let latest: Session | undefined
    opened.hermes.watch(id, session => { latest = session })()
    return (latest?.history ?? []).map(turn => [turn.request?.text ?? null, ...turn.items.map(item => (item.kind === 'text' ? item.markdown : item.kind))])
  }
  const launched = async (fixture: Fixture) => {
    const opened = open(fixture)
    await opened.clock.advance(0)
    return opened
  }

  it('is the newest chat, with no bot and no profile on any call, on a Hermes that lists no bots', async () => {
    const opened = await launched(ERRAND)
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'chat', bot: null, sessionId: SESSION }, opening: null })
    opened.watch()
    await toApproval(opened)
    expect(opened.sent().filter(call => 'profile' in (call.params ?? {}))).toEqual([])
  })

  it("is the default bot's Bot Chat at launch, and launching creates nothing", async () => {
    const opened = await launched(WITH_BOTS)
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'bot', bot: EMU, sessionId: SESSION }, opening: null })
    opened.watch()
    await opened.clock.advance(0)
    expect(calls(opened, 'session.resume')).toEqual([{ method: 'session.resume', params: { session_id: SESSION, display_projection: true, profile: 'default' } }])
    expect(calls(opened, 'session.create')).toEqual([])
  })

  it('opens a bot whose chat the roster names with no call, runs a message there as that bot, and returns to the same chat', async () => {
    const opened = await launched({ ...WITH_BOTS, header: { ...WITH_BOTS.header, models: { providers: [] } } })
    const before = opened.sent().length
    expect(await opened.hermes.run({ do: 'open', ref: bot(RESEARCH) })).toEqual({ ok: true, value: RESEARCH_CHAT })
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'bot', bot: RESEARCH, sessionId: RESEARCH_CHAT }, opening: null })
    expect(opened.sent().slice(before), "the roster named the chat, so the click only lists the bot's chats").toEqual([
      { method: 'session.list', params: { scope: 'live', picker: true, profile: 'research' } },
      { method: 'session.list', params: { scope: 'live', include_hidden: true, profile: 'research' } },
      { method: 'session.list', params: { scope: 'stored', limit: 100, include_hidden: true, picker: true, profile: 'research' } }
    ])

    const unwatch = opened.hermes.watch(RESEARCH_CHAT, () => {})
    await opened.clock.advance(0)
    expect(saidIn(opened, RESEARCH_CHAT)).toEqual([[null, RESEARCH_SAID]])
    expect(await opened.hermes.run({ do: 'send', sessionId: RESEARCH_CHAT, text: 'hello' })).toEqual({ ok: true, value: null })
    await opened.clock.advance(0)
    expect(saidIn(opened, RESEARCH_CHAT)).toEqual([[null, RESEARCH_SAID], ['hello', 'research: hello']])

    unwatch()
    expect(await opened.hermes.run({ do: 'open', ref: bot(EMU) })).toEqual({ ok: true, value: SESSION })
    expect(await opened.hermes.run({ do: 'open', ref: bot(RESEARCH) })).toEqual({ ok: true, value: RESEARCH_CHAT })
    expect(saidIn(opened, RESEARCH_CHAT), 'the reply is still there after the switch').toEqual([[null, RESEARCH_SAID], ['hello', 'research: hello']])
    await opened.hermes.run({ do: 'models', sessionId: RESEARCH_CHAT })
    await opened.hermes.run({ do: 'rename', sessionId: RESEARCH_CHAT, title: 'Other' })
    await opened.clock.advance(60_000)

    const forResearch = opened.sent().filter(call => call.params?.session_id === RESEARCH_CHAT)
    expect(forResearch.map(call => call.method), 'one resume for the whole visit, and a read each time a window began to watch it').toEqual([
      'session.resume', 'session.stats', 'config.get', 'config.get', 'session.stats', 'prompt.submit', 'session.stats', 'config.get', 'config.get', 'model.options',
      'session.mutate', 'session.detach'
    ])
    expect(forResearch.map(call => call.params?.profile), 'every call that names the chat names its bot').toEqual(Array(12).fill('research'))
    expect(calls(opened, 'session.create')).toEqual([])
  })

  it('shows an unstarted chat for a bot that has none, and makes its Bot Chat once for two messages sent at once', async () => {
    const opened = await launched(WITH_BOTS)
    const first = opened.hermes.run({ do: 'open', ref: bot(HERMES_DEV) })
    const second = opened.hermes.run({ do: 'open', ref: bot(HERMES_DEV) })
    expect(opened.hermes.open.get(), 'the chat stays while Hermes is asked').toEqual({ shown: { kind: 'bot', bot: EMU, sessionId: SESSION }, opening: bot(HERMES_DEV) })
    await opened.clock.advance(0)
    expect([await first, await second]).toEqual([{ ok: true, value: null }, { ok: true, value: null }])
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'bot', bot: HERMES_DEV, sessionId: null }, opening: null })
    expect(calls(opened, 'session.list').filter(call => 'title' in (call.params ?? {})), 'one lookup for the two clicks')
      .toEqual([{ method: 'session.list', params: { title: 'Bot Chat', include_hidden: true, profile: 'hermes-dev' } }])
    expect(calls(opened, 'session.create'), 'a click makes no session').toEqual([])

    const sends = [opened.hermes.run({ do: 'start', chat: unstarted(HERMES_DEV), text: 'one' }), opened.hermes.run({ do: 'start', chat: unstarted(HERMES_DEV), text: 'two' })]
    await opened.clock.advance(0)
    expect(await Promise.all(sends)).toEqual([{ ok: true, value: null }, { ok: true, value: null }])
    expect(calls(opened, 'session.create')).toEqual([{
      method: 'session.create',
      params: { source: 'gui', title: 'Bot Chat', follow_profile_config: true, request_id: expect.any(String) as string, client: CLIENT, hidden: true, profile: 'hermes-dev' }
    }])
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'bot', bot: HERMES_DEV, sessionId: MADE }, opening: null })
    expect(saidIn(opened, MADE)).toEqual([['one', 'hermes-dev: one'], ['two', 'hermes-dev: two']])

    expect(await opened.hermes.run({ do: 'start', chat: unstarted(HERMES_DEV), text: 'three' }), 'a message that still thinks the chat is unstarted goes to the chat').toEqual({ ok: true, value: null })
    await opened.clock.advance(300)
    expect(saidIn(opened, MADE).at(-1)).toEqual(['three', 'hermes-dev: three'])
    expect(calls(opened, 'session.create')).toHaveLength(1)
    expect(await opened.hermes.run({ do: 'open', ref: bot(EMU) })).toEqual({ ok: true, value: SESSION })
    expect(await opened.hermes.run({ do: 'open', ref: bot(HERMES_DEV) }), 'and a click finds it with no call').toEqual({ ok: true, value: MADE })
    expect(calls(opened, 'session.list').filter(call => 'title' in (call.params ?? {})), 'the titled create finds or makes the chat, so a first message looks nothing up').toHaveLength(1)
  })

  it('is the default bot unstarted when it has no Bot Chat, and its first message makes the chat', async () => {
    const opened = await launched(NO_HOME_CHAT)
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'bot', bot: EMU, sessionId: null }, opening: null })
    await opened.clock.advance(1_000)
    expect(calls(opened, 'session.create')).toEqual([])
    expect(await opened.hermes.run({ do: 'start', chat: unstarted(EMU), text: 'hello' })).toEqual({ ok: true, value: null })
    await opened.clock.advance(0)
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'bot', bot: EMU, sessionId: 'bot-chat-default' }, opening: null })
    expect(saidIn(opened, 'bot-chat-default' as SessionId)).toEqual([['hello', 'default: hello']])
    expect(calls(opened, 'session.create')).toMatchObject([{ params: { profile: 'default', title: 'Bot Chat' } }])
  })

  it('opens the newest chat and refuses to switch bots on a Hermes whose socket reaches one profile', async () => {
    const opened = await launched(BOUND)
    const shown = { shown: { kind: 'chat', bot: null, sessionId: SESSION }, opening: null }
    expect(opened.hermes.open.get()).toEqual(shown)
    const before = opened.sent().length
    const refusal = { kind: 'unsupported', message: "This Hermes can't switch bots from Highwing yet. Update Hermes on that machine, then reconnect." }
    expect(await opened.hermes.run({ do: 'open', ref: bot(RESEARCH) })).toEqual({ ok: false, refusal })
    expect(await opened.hermes.run({ do: 'start', chat: unstarted(RESEARCH), text: 'hello' })).toEqual({ ok: false, refusal })
    expect(opened.hermes.open.get()).toEqual(shown)
    expect(opened.sent().length, 'nothing was asked of Hermes').toBe(before)
  })

  it('keeps the chat and says why when a bot cannot be opened', async () => {
    const opened = await launched(WITH_BOTS)
    const shown = opened.hermes.open.get()
    expect(await opened.hermes.run({ do: 'open', ref: bot('parked' as BotId) }))
      .toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes isn't running that bot right now." } })
    expect(opened.hermes.open.get()).toEqual(shown)

    const offline = open(WITH_BOTS)
    offline.state.failWith = new DialError('not-running')
    await offline.clock.advance(100)
    expect(await offline.hermes.run({ do: 'open', ref: bot(RESEARCH) })).toEqual({ ok: false, refusal: { kind: 'offline', message: "Highwing isn't connected to Hermes right now." } })
    expect(offline.hermes.open.get()).toEqual({ shown: null, opening: null })
  })

  describe('a new chat', () => {
    const fresh = (bot: BotId | null, draftId: string) => ({ kind: 'new', bot, draftId, sessionId: null }) as const
    const WITH_CATALOG: Fixture = { ...SLASH, header: { ...SLASH.header, profiles: PROFILES } }
    const MADE = 'chat-default-1' as SessionId

    it("opens empty with no call, makes its session in the bot's profile on the first message, and stays open after the list and roster refresh", async () => {
      const opened = await launched(WITH_BOTS)
      const before = opened.sent().length
      expect(await opened.hermes.run({ do: 'open', ref: { kind: 'new', bot: EMU, draftId: 'draft-1' } })).toEqual({ ok: true, value: null })
      expect(opened.hermes.open.get()).toEqual({ shown: fresh(EMU, 'draft-1'), opening: null })
      expect(opened.sent().length, 'opening a new chat asks Hermes nothing').toBe(before)

      expect(await opened.hermes.run({ do: 'start', chat: fresh(EMU, 'draft-1'), text: 'hello' })).toEqual({ ok: true, value: null })
      await opened.clock.advance(0)
      expect(calls(opened, 'session.create')).toEqual([{
        method: 'session.create', params: { source: 'gui', request_id: 'draft-1', follow_profile_config: true, client: CLIENT, profile: 'default' }
      }])
      expect(opened.hermes.open.get()).toEqual({ shown: { ...fresh(EMU, 'draft-1'), sessionId: MADE }, opening: null })
      expect(saidIn(opened, MADE)).toEqual([['hello', 'default: hello']])
      expect(calls(opened, 'session.resume').filter(call => call.params?.session_id === MADE), 'the new session takes the one attach path').toHaveLength(1)

      const rosters = calls(opened, 'profiles.list').length
      await opened.clock.advance(1_000)
      expect(calls(opened, 'profiles.list').length, 'the roster was read again, and still names the story as the Bot Chat').toBeGreaterThan(rosters)
      expect(opened.hermes.open.get()).toEqual({ shown: { ...fresh(EMU, 'draft-1'), sessionId: MADE }, opening: null })
    })

    it('makes one session for two messages sent at once, and both land there in order', async () => {
      const opened = await launched(WITH_BOTS)
      await opened.hermes.run({ do: 'open', ref: { kind: 'new', bot: RESEARCH, draftId: 'draft-1' } })
      const sends = [
        opened.hermes.run({ do: 'start', chat: fresh(RESEARCH, 'draft-1'), text: 'one' }),
        opened.hermes.run({ do: 'start', chat: fresh(RESEARCH, 'draft-1'), text: 'two' })
      ]
      await opened.clock.advance(0)
      expect(await Promise.all(sends)).toEqual([{ ok: true, value: null }, { ok: true, value: null }])
      expect(calls(opened, 'session.create')).toMatchObject([{ params: { request_id: 'draft-1', profile: 'research' } }])
      expect(saidIn(opened, 'chat-research-1' as SessionId)).toEqual([['one', 'research: one'], ['two', 'research: two']])
    })

    it("makes it in the socket's own profile on a Hermes that lists no bots", async () => {
      const opened = await launched(ERRAND)
      expect(await opened.hermes.run({ do: 'start', chat: fresh(null, 'draft-1'), text: 'hello' })).toEqual({ ok: true, value: null })
      expect(calls(opened, 'session.create').map(call => call.params)).toEqual([{ source: 'gui', request_id: 'draft-1', follow_profile_config: true, client: CLIENT }])
    })

    it('refuses its first message while offline, or on a gateway that offers no gui source', async () => {
      const offline = open(WITH_BOTS)
      offline.state.failWith = new DialError('not-running')
      await offline.clock.advance(100)
      expect(await offline.hermes.run({ do: 'start', chat: fresh(null, 'draft-1'), text: 'hello' })).toMatchObject({ ok: false, refusal: { kind: 'offline' } })

      const header = { ...ERRAND.header, describe: { ...(ERRAND.header.describe as object), session_create: { sources: ['cli'], parameters: [] } } }
      const noGui = await launched({ ...ERRAND, header })
      expect(await noGui.hermes.run({ do: 'start', chat: fresh(null, 'draft-1'), text: 'hello' })).toMatchObject({ ok: false, refusal: { kind: 'unsupported' } })
      expect(calls(noGui, 'session.create')).toEqual([])
    })

    const minting = async (fixture: Fixture) => {
      let minted = 0
      const opened = open(fixture, { mintId: () => `minted-${++minted}` })
      await opened.clock.advance(0)
      return opened
    }

    it("opens for a bare /new typed into a chat, in that chat's bot, and asks Hermes nothing", async () => {
      const opened = await minting(WITH_CATALOG)
      expect(await opened.hermes.run({ do: 'send', sessionId: SESSION, text: '/new' })).toEqual({ ok: true, value: null })
      expect(opened.hermes.open.get()).toEqual({ shown: fresh(EMU, 'minted-1'), opening: null })
      expect(calls(opened, 'session.create')).toEqual([])
      expect(calls(opened, 'command.dispatch')).toEqual([])
      expect(calls(opened, 'prompt.submit')).toEqual([])
    })

    it('opens for a /new typed into a chat that has no session yet, and makes none', async () => {
      const opened = await minting({ ...WITH_CATALOG, header: { ...WITH_CATALOG.header, homeBotChat: false } })
      expect(opened.hermes.open.get()).toEqual({ shown: unstarted(EMU), opening: null })
      expect(await opened.hermes.run({ do: 'start', chat: unstarted(EMU), text: ' /new ' })).toEqual({ ok: true, value: null })
      expect(opened.hermes.open.get()).toEqual({ shown: fresh(EMU, 'minted-1'), opening: null })
      expect(await opened.hermes.run({ do: 'start', chat: fresh(EMU, 'minted-1'), text: '/NEW' })).toEqual({ ok: true, value: null })
      expect(opened.hermes.open.get()).toEqual({ shown: fresh(EMU, 'minted-2'), opening: null })
      expect(calls(opened, 'session.create')).toEqual([])
    })
  })
})

describe("a bot's chats", () => {
  const [EMU, RESEARCH] = ['default', 'research'] as BotId[] as [BotId, BotId]
  const picked = (sessionId: SessionId) => ({ do: 'open', ref: { kind: 'chat', sessionId } }) as const
  const rowsOf = (opened: ReturnType<typeof open>) => opened.hermes.sidebar.get().rows.map(row => [row.id, row.title, row.badge])

  it('follow the open bot, and open a chat picked from them in that bot with no create', async () => {
    const opened = open(WITH_CHATS)
    await opened.clock.advance(0)
    expect(opened.hermes.sidebar.get()).toMatchObject({ bot: EMU, status: 'ready', rows: [{ id: SESSION }] })

    await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    await opened.clock.advance(0)
    expect(opened.hermes.sidebar.get()).toMatchObject({ bot: RESEARCH, status: 'ready' })
    expect(rowsOf(opened), 'newest first, and the one that waits on an approval says so').toEqual([
      [REMINDER, 'Send invoice reminder', 'asking'], [INVOICES, 'Sort the invoices', 'none'], [DOWNLOADS, 'Clean up Downloads', 'none']
    ])

    expect(await opened.hermes.run(picked(INVOICES))).toEqual({ ok: true, value: INVOICES })
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'chat', bot: RESEARCH, sessionId: INVOICES }, opening: null })
    expect(await opened.hermes.run(picked(DOWNLOADS))).toEqual({ ok: true, value: DOWNLOADS })
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'chat', bot: RESEARCH, sessionId: DOWNLOADS }, opening: null })

    opened.hermes.watch(DOWNLOADS, () => {})
    await opened.clock.advance(0)
    expect(await opened.hermes.run({ do: 'send', sessionId: DOWNLOADS, text: 'hello' })).toEqual({ ok: true, value: null })
    await opened.clock.advance(0)
    expect(opened.sent().filter(call => call.params?.session_id === DOWNLOADS && call.method !== 'session.stats').map(call => [call.method, call.params?.profile]), 'a picked chat runs as its bot')
      .toEqual([['session.resume', 'research'], ['config.get', 'research'], ['config.get', 'research'], ['prompt.submit', 'research']])
    expect(rowsOf(opened)[2], 'the badge comes from the attached chat').toEqual([DOWNLOADS, 'Clean up Downloads', 'none'])

    expect(opened.sent().filter(call => call.method === 'session.create')).toEqual([])
    const lists = opened.sent().filter(call => call.method === 'session.list' && !('title' in (call.params ?? {})))
    expect(lists.map(call => call.params?.profile), "the socket's own profile until the open chat names a bot").toEqual([undefined, undefined, undefined, EMU, EMU, EMU, RESEARCH, RESEARCH, RESEARCH])
  })

  it('mark a hidden chat that waits on an approval, with no window on it', async () => {
    const seeds = WITH_CHATS.header.chats ?? {}
    const hiddenReminder = Object.fromEntries(Object.entries(seeds).map(([profile, chats]) => [profile, chats.map(chat => (chat.id === REMINDER ? { ...chat, hidden: true } : chat))]))
    const opened = open({ ...WITH_CHATS, header: { ...WITH_CHATS.header, chats: hiddenReminder } })
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    await opened.clock.advance(0)
    expect(rowsOf(opened)[0]).toEqual([REMINDER, 'Send invoice reminder', 'asking'])
  })

  it('drop a list that answers after the user left its bot', async () => {
    const opened = open(WITH_CHATS)
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    await opened.clock.advance(0)
    const seen: string[] = []
    opened.hermes.sidebar.subscribe(sidebar => seen.push(`${sidebar.bot}:${sidebar.status}:${sidebar.rows.map(row => row.id).join()}`))

    void opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: EMU } })
    void opened.hermes.run(picked(INVOICES))
    await opened.clock.advance(0)
    expect(seen).toEqual([`${EMU}:loading:`, `${RESEARCH}:loading:`, `${RESEARCH}:ready:${[REMINDER, INVOICES, DOWNLOADS].join()}`])
    expect(opened.sent().filter(call => call.method === 'session.list' && call.params?.profile === EMU), "Emu's list was asked for, and its answer dropped").toHaveLength(6)
  })
})

describe('sending a slash line', () => {
  const send = async (fixture: Fixture, text: string) => {
    const opened = open(fixture)
    await opened.clock.advance(0)
    const outcome = opened.hermes.run({ do: 'send', sessionId: SESSION, text })
    await opened.clock.advance(0)
    return { opened, outcome: await outcome }
  }

  it('runs a listed command with command.dispatch and answers its output', async () => {
    const { opened, outcome } = await send(story(
      { await: 'command.dispatch', params: { session_id: SESSION, name: 'status' }, reply: { type: 'exec', output: '\u001b[1mModel:\u001b[0m test-model\n' } }
    ), '/status')
    expect(outcome).toEqual({ ok: true, value: 'Model: test-model' })
    expect(opened.sent().find(call => call.method === 'command.dispatch')?.params).toEqual({ session_id: SESSION, name: 'status' })
    expect(opened.sent().some(call => call.method === 'prompt.submit')).toBe(false)
    await expect(opened.script.done).resolves.toBeUndefined()
  })

  it("runs a command in the profile of the chat's bot", async () => {
    const withBots = story({ await: 'command.dispatch', params: { session_id: SESSION, name: 'status', profile: 'default' }, reply: { type: 'exec', output: 'ok' } })
    const { opened, outcome } = await send({ ...withBots, header: { ...withBots.header, profiles: PROFILES } }, '/status')
    expect(outcome).toEqual({ ok: true, value: 'ok' })
    expect(opened.sent().find(call => call.method === 'command.dispatch')?.params).toEqual({ session_id: SESSION, name: 'status', profile: 'default' })
  })

  it('submits a skill with the typed line shown and the skill text for the model', async () => {
    const { opened, outcome } = await send(story(
      { await: 'command.dispatch', params: { session_id: SESSION, name: 'release-notes', arg: 'since v2' }, reply: { type: 'skill', name: 'release-notes', message: 'SKILL BODY since v2', display: '/release-notes since v2' } },
      { await: 'prompt.submit', params: { session_id: SESSION, text: '/release-notes since v2', input_id: 'minted', api_text: 'SKILL BODY since v2' }, reply: RECEIPT }
    ), '/release-notes   since v2')
    expect(outcome).toEqual({ ok: true, value: null })
    const submit = opened.sent().find(call => call.method === 'prompt.submit')?.params
    expect(submit).toMatchObject({ session_id: SESSION, text: '/release-notes since v2', api_text: 'SKILL BODY since v2' })
    await expect(opened.script.done).resolves.toBeUndefined()
  })

  it('answers a command Hermes refuses as a value', async () => {
    const { outcome } = await send(story(
      { await: 'command.dispatch', params: { session_id: SESSION, name: 'usage', arg: 'reset' }, error: { code: 4001, message: 'unsupported_command', data: { reason: 'unsupported_command' } } }
    ), '/usage reset')
    expect(outcome).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "Hermes can't run that command from Highwing." } })
  })

  it('leaves /new with a name to Hermes, and opens no new chat for it', async () => {
    const { opened, outcome } = await send(story(
      { await: 'command.dispatch', params: { session_id: SESSION, name: 'new', arg: 'Holiday' }, error: { code: 4001, message: 'unsupported_command', data: { reason: 'unsupported_command' } } }
    ), '/new Holiday')
    expect(outcome).toMatchObject({ ok: false, refusal: { kind: 'unsupported' } })
    expect(opened.hermes.open.get().shown).toMatchObject({ kind: 'chat', sessionId: SESSION })
  })

  it('renames the chat for /title with a name, through Highwing\'s own rename', async () => {
    const { opened, outcome } = await send(story(
      { await: 'session.mutate', params: { session_id: SESSION, request_id: 'minted', expected_revision: 0, operation: 'rename', payload: { title: 'Holiday plan' } }, reply: { session_id: SESSION, operation: 'rename', revision: 1, title: 'Holiday plan' } }
    ), '/title Holiday plan')
    expect(outcome).toEqual({ ok: true, value: null })
    expect(opened.sent().some(call => call.method === 'command.dispatch')).toBe(false)
  })

  it('waits for the catalog of a new connection before it decides a line is text', async () => {
    const opened = open(story(
      { await: 'command.dispatch', params: { session_id: SESSION, name: 'status' }, reply: { type: 'exec', output: 'Model: test-model' } }
    ))
    const sent: Promise<unknown>[] = []
    opened.hermes.watch(SESSION, session => {
      if (session.sync.state !== 'live' || sent.length > 0) return
      expect(opened.hermes.slash.get(), 'the chat is live before the catalog answers').toEqual([])
      sent.push(opened.hermes.run({ do: 'send', sessionId: SESSION, text: '/status' }))
    })
    await opened.clock.advance(0)
    expect(await sent[0]).toEqual({ ok: true, value: 'Model: test-model' })
  })

  it('reads a listed name in any case and runs it by its catalog name', async () => {
    const { opened, outcome } = await send(story(
      { await: 'command.dispatch', params: { session_id: SESSION, name: 'status' }, reply: { type: 'exec', output: 'Model: test-model' } }
    ), '/Status')
    expect(outcome).toEqual({ ok: true, value: 'Model: test-model' })
    expect(opened.sent().find(call => call.method === 'command.dispatch')?.params).toEqual({ session_id: SESSION, name: 'status' })
  })

  it('sends text at once while the catalog read is slow, and a slash line as text once the read gives up', async () => {
    const clock = manualClock()
    const script = scriptedDialer(story(
      { await: 'prompt.submit', params: { session_id: SESSION, text: 'hello', input_id: 'minted' }, reply: RECEIPT },
      { await: 'prompt.submit', params: { session_id: SESSION, text: '/status', input_id: 'minted' }, reply: RECEIPT }
    ), { clock })
    const unanswered: Dialer = async request => {
      const socket = await script(request)
      return {
        reach: socket.reach,
        send: text => (text.includes('"method":"commands.catalog"') ? undefined : socket.send(text)),
        close: () => socket.close(),
        get onText() { return socket.onText },
        set onText(listener) { socket.onText = listener },
        get onClose() { return socket.onClose },
        set onClose(listener) { socket.onClose = listener }
      } satisfies WireSocket
    }
    const hermes = openHermes({ dial: unanswered, clock, client: CLIENT })
    await clock.advance(0)
    expect(await hermes.run({ do: 'send', sessionId: SESSION, text: 'hello' })).toEqual({ ok: true, value: null })
    let settled = false
    const slashLine = hermes.run({ do: 'send', sessionId: SESSION, text: '/status' }).finally(() => { settled = true })
    await clock.advance(9_999)
    expect(settled, 'a slash line waits for the catalog read').toBe(false)
    await clock.advance(1)
    expect(await slashLine).toEqual({ ok: true, value: null })
    expect(callsIn(script.received).filter(call => call.method === 'prompt.submit').map(call => call.params?.text)).toEqual(['hello', '/status'])
  })

  it('sends a line whose name is not listed as text', async () => {
    const { opened } = await send(story(
      { await: 'prompt.submit', params: { session_id: SESSION, text: '/compress', input_id: 'minted' }, reply: RECEIPT }
    ), '/compress')
    expect(opened.sent().find(call => call.method === 'prompt.submit')?.params).toMatchObject({ text: '/compress' })
    expect(opened.sent().some(call => call.method === 'command.dispatch')).toBe(false)
  })
})

describe('branching a chat', () => {
  const RESEARCH = 'research' as BotId
  const [B1, B2] = ['branch-1', 'branch-2'] as BranchId[] as [BranchId, BranchId]
  const CHILD = 'branch-default-1' as SessionId
  const SECOND_REQUEST = 'Add a line about the deadline under it'
  const branch = (rowId: number, branchId: BranchId, sessionId: SessionId = SESSION) => ({ do: 'branch', sessionId, rowId, branchId }) as const
  const mutations = (opened: ReturnType<typeof open>) => opened.sent().filter(call => call.method === 'session.mutate')

  async function branched(fixture: Fixture, command: ReturnType<typeof branch>) {
    const opened = open(fixture)
    await opened.clock.advance(0)
    const outcome = opened.hermes.run(command)
    await opened.clock.advance(0)
    return { opened, outcome: await outcome }
  }

  it('asks Hermes for one branch through the last stored row of the turn, and answers the new chat', async () => {
    const { opened, outcome } = await branched(BRANCH, branch(3, B1))
    expect(outcome).toEqual({ ok: true, value: CHILD })
    expect(mutations(opened)).toHaveLength(1)
    expect(mutations(opened)[0]?.params).toMatchObject({
      session_id: SESSION, request_id: B1, operation: 'branch', payload: { through_message_id: 4 }, expected_revision: 0, expected_generation: 0
    })
    expect(opened.script.branchesMade).toBe(1)
  })

  it('shows the new chat with the message in its box, and leaves the parent as it was', async () => {
    const { opened } = await branched(BRANCH, branch(3, B1))
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'branch', bot: null, sessionId: CHILD, text: SECOND_REQUEST }, opening: null })
    const history = (id: SessionId) => {
      let latest: Session | undefined
      opened.hermes.watch(id, session => { latest = session })()
      return (latest?.history ?? []).map(turn => turn.request?.text)
    }
    await opened.clock.advance(0)
    expect(history(SESSION)).toEqual(['Rename the heading in notes.md to Plan', SECOND_REQUEST, 'List the folder'])
  })

  it('makes a chat that holds the turns through the reply and lists it by the next title in the lineage', async () => {
    const { opened } = await branched(BRANCH, branch(3, B1))
    await opened.clock.advance(1_000)
    expect(opened.hermes.sidebar.get().rows.map(row => row.title).sort()).toEqual(['Notes heading', 'Notes heading #2'])
    let child: Session | undefined
    opened.hermes.watch(CHILD, session => { child = session })
    await opened.clock.advance(0)
    expect(child?.history.map(turn => turn.request?.text)).toEqual(['Rename the heading in notes.md to Plan', SECOND_REQUEST])
  })

  it('answers a retry with the same key from the first branch, even after the parent moved on', async () => {
    const { opened, outcome: first } = await branched(BRANCH, branch(3, B1))
    const second = opened.hermes.run(branch(5, B2))
    await opened.clock.advance(0)
    expect(await second).toEqual({ ok: true, value: 'branch-default-2' })
    expect(mutations(opened)[1]?.params, "the parent's revision moved with the first branch").toMatchObject({ expected_revision: 1 })

    const retry = opened.hermes.run(branch(3, B1))
    await opened.clock.advance(0)
    expect(await retry).toEqual(first)
    expect(mutations(opened)).toHaveLength(3)
    expect(mutations(opened)[2]?.params, 'the request goes out as it did the first time').toEqual(mutations(opened)[0]?.params)
    expect(opened.script.branchesMade).toBe(2)
  })

  it('answers a retry with the same key from the first branch after the parent was detached', async () => {
    const { opened, outcome: first } = await branched(BRANCH, branch(3, B1))
    await opened.clock.advance(RETAIN_MS + 1)
    const retry = opened.hermes.run(branch(3, B1))
    await opened.clock.advance(0)
    expect(await retry).toEqual(first)
    expect(mutations(opened)[1]?.params).toEqual(mutations(opened)[0]?.params)
    expect(opened.script.branchesMade).toBe(1)
  })

  it('answers a retry sent at once with the same chat', async () => {
    const opened = open(BRANCH)
    await opened.clock.advance(0)
    const both = Promise.all([opened.hermes.run(branch(3, B1)), opened.hermes.run(branch(3, B1))])
    await opened.clock.advance(0)
    const [first, again] = await both
    expect(again).toEqual(first)
    expect(opened.script.branchesMade).toBe(1)
  })

  it("refuses on a Hermes that can't branch, changes nothing, and asks Hermes again on the next click", async () => {
    const { opened, outcome } = await branched(BRANCH_OLD, branch(3, B1))
    const refusal = { ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't branch a chat." } }
    expect(outcome).toEqual(refusal)
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'chat', bot: null, sessionId: SESSION }, opening: null })
    expect(opened.script.branchesMade).toBe(0)

    const again = opened.hermes.run(branch(3, B1))
    await opened.clock.advance(0)
    expect(await again).toEqual(refusal)
    expect(mutations(opened)).toHaveLength(2)
  })

  it('refuses a message that is not in the chat without asking Hermes', async () => {
    const { opened, outcome } = await branched(BRANCH, branch(99, B1))
    expect(outcome).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'That message is no longer in this chat.' } })
    expect(mutations(opened)).toEqual([])
    expect(opened.hermes.open.get().shown).toMatchObject({ kind: 'chat', sessionId: SESSION })
  })

  it('refuses while a reply is running, asking Hermes nothing', async () => {
    const opened = open()
    opened.watch()
    await toApproval(opened)
    const outcome = await opened.hermes.run(branch(1, B1))
    expect(outcome).toEqual({ ok: false, refusal: { kind: 'stale', message: 'Wait for the reply to finish, then branch.' } })
    expect(mutations(opened)).toEqual([])
  })

  it("opens the new chat in the parent's bot, and runs a message there as that bot", async () => {
    const opened = open({ ...WITH_CHATS, header: { ...WITH_CHATS.header, branches: true } })
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'open', ref: { kind: 'chat', sessionId: INVOICES } })

    const made = opened.hermes.run(branch(1, B1, INVOICES))
    await opened.clock.advance(0)
    const child = 'branch-research-1' as SessionId
    expect(await made).toEqual({ ok: true, value: child })
    expect(opened.hermes.open.get().shown).toMatchObject({ kind: 'branch', bot: RESEARCH, sessionId: child, text: 'Sort the invoices in the inbox folder by due date.' })
    expect(mutations(opened)[0]?.params).toMatchObject({ profile: 'research', payload: { through_message_id: 2 } })

    const sent = opened.hermes.run({ do: 'send', sessionId: child, text: 'hello' })
    await opened.clock.advance(0)
    expect(await sent).toEqual({ ok: true, value: null })
    expect(opened.sent().filter(call => call.params?.session_id === child && call.method !== 'session.stats').map(call => [call.method, call.params?.profile]))
      .toEqual([['session.resume', 'research'], ['prompt.submit', 'research']])
  })
})

describe('the versions of a message', () => {
  const RESEARCH = 'research' as BotId
  const reads = (opened: ReturnType<typeof open>) => opened.sent().filter(call => call.method === 'projects.tree' || call.method === 'session.transcript')
  const inResearch = async (fixture: Fixture) => {
    const opened = open(fixture)
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    await opened.clock.advance(0)
    return opened
  }

  it('are read from Hermes in the chat\'s bot, with no attach of the chat or of its versions', async () => {
    const opened = await inResearch(WITH_VERSIONS)
    const versions = [{ sessionId: SORTED, landing: 3 }, { sessionId: SORTED_2, landing: 3 }, { sessionId: SORTED_3, landing: 3 }]
    expect(await opened.hermes.run({ do: 'versions', sessionId: SORTED })).toEqual({ ok: true, value: [{ versions, current: 0 }] })
    expect(await opened.hermes.run({ do: 'versions', sessionId: SORTED_3 })).toEqual({ ok: true, value: [{ versions, current: 2 }] })
    expect(reads(opened).every(call => call.params?.profile === 'research')).toBe(true)
    expect(reads(opened).filter(call => call.method === 'projects.tree'), 'each ask reads the tree again').toHaveLength(2)
    expect(opened.sent().filter(call => call.method === 'session.resume' && call.params?.session_id !== SESSION)).toEqual([])
  })

  it('are none for a chat that was never branched, at the cost of the tree alone', async () => {
    const opened = await inResearch(WITH_VERSIONS)
    expect(await opened.hermes.run({ do: 'versions', sessionId: 'local-0103' as SessionId })).toEqual({ ok: true, value: [] })
    expect(reads(opened).map(call => call.method)).toEqual(['projects.tree'])
  })

  it('place a chat a branch just made at the end of its thread, and at its own message once it holds one', async () => {
    const opened = await inResearch(WITH_VERSIONS)
    const made = await opened.hermes.run({ do: 'branch', sessionId: SORTED, rowId: 3, branchId: 'branch-1' as BranchId })
    if (!made.ok) throw new Error(made.refusal.message)
    await opened.clock.advance(0)
    const child = made.value
    expect(await opened.hermes.run({ do: 'versions', sessionId: child }), 'the branch holds the second message and its reply, so the third is where it parts').toEqual({
      ok: true, value: [{ versions: [{ sessionId: SORTED, landing: 5 }, { sessionId: child, landing: 'end' }], current: 1 }]
    })
    opened.hermes.watch(child, () => {})
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'send', sessionId: child, text: 'Now group them by week.' })
    await opened.clock.advance(0)
    expect(await opened.hermes.run({ do: 'versions', sessionId: child })).toEqual({
      ok: true, value: [{ versions: [{ sessionId: SORTED, landing: 5 }, { sessionId: child, landing: 5 }], current: 1 }]
    })
    expect(await opened.hermes.run({ do: 'versions', sessionId: SORTED }), 'the first chat has two messages with versions').toMatchObject({
      ok: true, value: [{ versions: [{ sessionId: SORTED, landing: 3 }, { sessionId: SORTED_2 }, { sessionId: SORTED_3 }] }, { versions: [{ sessionId: SORTED, landing: 5 }, { sessionId: child, landing: 5 }], current: 0 }]
    })
  })

  it('are refused by a Hermes that lists no tree, and no chat is read', async () => {
    const opened = await inResearch(NO_TREE)
    expect(await opened.hermes.run({ do: 'versions', sessionId: SORTED })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes doesn't support that." } })
    expect(reads(opened).map(call => call.method)).toEqual(['projects.tree'])
  })
})

describe('when a turn began', () => {
  it('stamps a live turn from the hub\'s clock', async () => {
    const opened = open()
    opened.watch()
    await opened.clock.advance(4_321)
    await toApproval(opened)
    const { run } = opened.seen.at(-1) as Session
    if (run.state !== 'running') throw new Error('expected the turn to be running at the approval')
    expect(run.turn.began).toEqual({ at: 4_321, clock: 'client' })
  })
})

describe('mentioning another bot', () => {
  const ASK = 'Ask @Rae for the weekly report'
  const relays = (opened: ReturnType<typeof open>) => opened.hermes.relay.get().bySession[SESSION] ?? []
  const states = (opened: ReturnType<typeof open>) => relays(opened).map(relay => relay.state)
  const delivers = (opened: ReturnType<typeof open>) => opened.sent().filter(call => call.method === 'bot_relay.deliver' && call.params?.id !== undefined)
  const submits = (opened: ReturnType<typeof open>) => opened.sent().filter(call => call.method === 'prompt.submit')
  const send = async (opened: ReturnType<typeof open>, text: string) => {
    await opened.clock.advance(0)
    const outcome = await opened.hermes.run({ do: 'send', sessionId: SESSION, text })
    await opened.clock.advance(0)
    return outcome
  }

  it('hands the message to that bot alone, and shows it waiting until the one reply comes back', async () => {
    const opened = open(TEAM)
    const seen: string[] = []
    opened.hermes.relay.subscribe(desk => seen.push((desk.bySession[SESSION] ?? []).map(relay => relay.state.s).join()))
    expect(opened.hermes.relay.get()).toEqual({ supported: false, bySession: {} })
    expect(await send(opened, ASK), 'the composer clears').toEqual({ ok: true, value: null })

    const [relay] = relays(opened)
    expect(relays(opened)).toEqual([{ id: expect.stringMatching(/^[0-9a-f]{32}$/) as unknown, to: 'rae', name: 'Rae', tone: 'umber', text: ASK, after: null, state: { s: 'waiting' } }])
    expect(delivers(opened)).toEqual([{ method: 'bot_relay.deliver', params: { profile: 'rae', id: relay?.id, message: ASK } }])
    expect(submits(opened), "the chat's own bot is not asked").toEqual([])
    expect(opened.script.step, 'the story has not moved').toBe(0)

    await opened.clock.advance(1_499)
    expect(states(opened)).toEqual([{ s: 'waiting' }])
    await opened.clock.advance(1)
    expect(states(opened)).toEqual([{ s: 'answered', reply: RAE_SAID }])
    expect(seen).toEqual(['', 'waiting', 'answered'])
    expect(delivers(opened)).toHaveLength(1)
  })

  it('refuses a message that carries attachments, and hands nothing to the bot', async () => {
    const opened = open(TEAM)
    await opened.clock.advance(0)
    const outcome = await opened.hermes.run({ do: 'send', sessionId: SESSION, text: ASK, attachments: ['a-1' as AttachmentId] })
    await opened.clock.advance(0)
    expect(outcome).toEqual({ ok: false, refusal: { kind: 'rejected', message: "A message to another bot can't carry attachments. Remove them, or send it without the mention." } })
    expect(relays(opened)).toEqual([])
    expect(delivers(opened)).toEqual([])
    expect(opened.sent().filter(call => /attach/.test(call.method))).toEqual([])
  })

  it('says in words that a bot is offline, and leaves the message sent', async () => {
    const opened = open(TEAM)
    expect(await send(opened, '@Sam why does the build fail?')).toEqual({ ok: true, value: null })
    expect(relays(opened)).toMatchObject([{ to: 'sam', name: 'Sam', text: '@Sam why does the build fail?', state: { s: 'failed', words: "Sam is offline, so it didn't get your message." } }])
    expect(submits(opened)).toEqual([])
  })

  it('hands one message to every bot it names, in the order it names them', async () => {
    const opened = open(TEAM)
    await send(opened, 'Ask @Sam and @Rae, then @sam again.')
    expect(relays(opened).map(relay => relay.to)).toEqual(['sam', 'rae'])
    expect(delivers(opened).map(call => call.params?.profile)).toEqual(['sam', 'rae'])
    expect(new Set(delivers(opened).map(call => call.params?.id)).size, 'each delivery has its own id').toBe(2)
  })

  it('files the handed message after the newest turn the chat holds', async () => {
    const opened = open(TEAM)
    opened.watch()
    await toApproval(opened)
    await approve(opened.hermes)
    await opened.clock.advance(1_000)
    const last = opened.seen.at(-1)?.history.at(-1)?.id
    expect(last).toBeDefined()
    await send(opened, ASK)
    expect(relays(opened)).toMatchObject([{ after: last }])
  })

  it('gives up in words when no reply comes in 25 minutes', async () => {
    const opened = open({ ...TEAM, header: { ...TEAM.header, relay: { rae: { reply: 'Too late.', delay_ms: 1_500_001 } } } })
    await send(opened, ASK)
    await opened.clock.advance(1_499_999)
    expect(states(opened)).toEqual([{ s: 'waiting' }])
    await opened.clock.advance(1)
    expect(states(opened)).toEqual([{ s: 'failed', words: "Rae didn't answer in 25 minutes." }])
    await opened.clock.advance(1)
    expect(states(opened), 'a reply after the deadline changes nothing').toEqual([{ s: 'failed', words: "Rae didn't answer in 25 minutes." }])
  })

  it("sends a message that names only the chat's own bot, or nobody, as a normal message", async () => {
    const opened = open(TEAM)
    expect(await send(opened, '@Ada mail me at sam@example')).toEqual({ ok: true, value: null })
    expect(submits(opened)).toMatchObject([{ params: { session_id: SESSION, text: '@Ada mail me at sam@example' } }])
    expect(delivers(opened)).toEqual([])
    expect(relays(opened)).toEqual([])
  })

  it('sends the text as a normal message on a Hermes that cannot hand a message over, which it asks once per socket', async () => {
    const opened = open(TEAM_NO_RELAY)
    expect(await send(opened, ASK)).toEqual({ ok: true, value: null })
    expect(opened.hermes.relay.get()).toEqual({ supported: false, bySession: {} })
    expect(submits(opened)).toMatchObject([{ params: { session_id: SESSION, text: ASK } }])
    expect(opened.sent().filter(call => call.method === 'bot_relay.deliver')).toEqual([{ method: 'bot_relay.deliver', params: {} }])
  })

  it('keeps what it learned while the socket is gone, and asks the new socket again', async () => {
    const opened = open(TEAM, { drop: { afterPush: 1, missed: 0 } })
    opened.watch()
    await toApproval(opened)
    expect(opened.hermes.link.get().state).toBe('waiting')
    expect(opened.hermes.relay.get().supported).toBe(true)
    await opened.clock.advance(1_000)
    expect(opened.hermes.link.get().state).toBe('online')
    expect(opened.sent().filter(call => call.method === 'bot_relay.deliver' && call.params?.id === undefined)).toHaveLength(2)
  })
})

describe('the pane', () => {
  /** The errand with its first `agent.step` frame turned into `type`, on the same stream position. */
  const asking = (type: string, payload: object, sessionId: string = SESSION): Fixture => {
    const at = ERRAND.steps.findIndex(step => 'push' in step && (step.push as { params: { type: string } }).params.type === 'agent.step')
    const step = ERRAND.steps[at] as { at: number; push: { params: object } }
    const push = { ...step.push, params: { ...step.push.params, type, session_id: sessionId, payload } }
    return { ...ERRAND, steps: ERRAND.steps.with(at, { ...step, push }) }
  }
  const OPEN = { url: 'http://localhost:5173/', label: 'demo' }

  async function asked(fixture: Fixture, before: (opened: ReturnType<typeof open>) => Promise<unknown> = async () => {}) {
    const asks: { ask: unknown; from: SessionId }[] = []
    const opened = open(fixture, { onPane: (ask, from) => asks.push({ ask, from: from.id }) })
    opened.watch()
    await opened.clock.advance(0)
    await before(opened)
    await toApproval(opened)
    return { ...opened, asks }
  }

  it('hears the open chat ask to open a page, and to close one, counting neither as unshown', async () => {
    const opened = await asked(asking('preview.open', OPEN))
    expect(opened.asks).toEqual([{ ask: { do: 'open', url: OPEN.url, label: 'demo' }, from: SESSION }])
    expect(opened.diagnostics.filter(what => what.type.startsWith('preview.'))).toEqual([])
    expect((await asked(asking('preview.close', { url: '' }))).asks).toEqual([{ ask: { do: 'close', url: null }, from: SESSION }])
  })

  it('hears a frame the gateway sends twice once', async () => {
    const once = asking('preview.open', OPEN)
    const at = once.steps.findIndex(step => 'push' in step && (step.push as { params: { type: string } }).params.type === 'preview.open')
    const twice = { ...once, steps: once.steps.toSpliced(at + 1, 0, once.steps[at]!) }
    expect((await asked(twice)).asks).toHaveLength(1)
  })

  it('drops an ask from a chat the window does not show', async () => {
    const hidden = await asked(asking('preview.open', OPEN), opened => opened.hermes.run({ do: 'open', ref: { kind: 'new', bot: null, draftId: 'draft-1' } }))
    expect(hidden.hermes.open.get().shown?.sessionId).toBeNull()
    expect(hidden.asks).toEqual([])
    expect((await asked(asking('preview.open', OPEN, 'local-elsewhere'))).asks).toEqual([])
  })

  it('counts an ask it cannot read as invalid', async () => {
    const opened = await asked(asking('preview.open', { url: '  ' }))
    expect(opened.asks).toEqual([])
    expect(opened.diagnostics).toContainEqual({ kind: 'invalid', type: 'preview.open' })
  })
})

describe('the reasoning switch', () => {
  const SHOWN_OFF: Fixture = { ...ERRAND, header: { ...ERRAND.header, controls: { show_reasoning: '0' } } }
  const reads = (opened: ReturnType<typeof open>) => opened.sent().filter(call => call.method === 'config.get' && call.params?.key === 'show_reasoning')

  it('reads it once a window watches the chat, and not for a command that only waits for the attach', async () => {
    const opened = open(SHOWN_OFF)
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'models', sessionId: SESSION })
    expect(reads(opened), 'nothing watches yet').toEqual([])
    opened.watch()
    await opened.clock.advance(0)
    expect(reads(opened)).toEqual([{ method: 'config.get', params: { session_id: SESSION, key: 'show_reasoning' } }])
    expect(opened.seen.at(-1)?.tuning).toEqual({ reasoning: false, busy: null })
  })

  it('reads it again after the chat is attached again', async () => {
    const opened = open(SHOWN_OFF, { drop: { afterPush: 2, missed: 0 } })
    opened.watch()
    await toApproval(opened)
    await opened.clock.advance(5_000)
    expect(opened.script.dials).toBe(2)
    expect(reads(opened)).toHaveLength(2)
  })

  it('sets it for the chat and takes the value Hermes answers', async () => {
    const opened = open(SHOWN_OFF)
    opened.watch()
    await opened.clock.advance(0)
    expect(await opened.hermes.run({ do: 'tune', sessionId: SESSION, set: 'reasoning', on: true })).toEqual({ ok: true, value: undefined })
    expect(opened.sent().filter(call => call.method === 'config.set')).toEqual([{ method: 'config.set', params: { session_id: SESSION, key: 'show_reasoning', value: 'on' } }])
    expect(opened.seen.at(-1)?.tuning).toEqual({ reasoning: true, busy: null })
  })

  it('stays unknown on a Hermes that refuses the read, and says it cannot set it', async () => {
    const opened = open()
    opened.watch()
    await opened.clock.advance(0)
    expect(reads(opened)).toHaveLength(1)
    expect(opened.seen.at(-1)?.tuning).toEqual({ reasoning: null, busy: null })
    expect(await opened.hermes.run({ do: 'tune', sessionId: SESSION, set: 'reasoning', on: true })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes doesn't support that." } })
  })
})
