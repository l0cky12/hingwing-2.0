import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import type { GroupChat, GroupDraft, GroupId } from '../src/domain/groups'
import { shownChat } from '../src/domain/open'
import type { AttachmentId, BranchId, Item, PromptId, RequestId, Session, SessionId } from '../src/domain/session'
import { DialError, openHermes, RETAIN_MS, type Dialer, type HermesOptions, type WireSocket } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { MASKED, play, scriptedDialer, type Fixture, type FixtureStep, type GroupsScript, type Moment, type ScriptOptions } from '../src/testing/fixture'
import {
  BOUND, BRANCH, BRANCH_COMPACTED, BRANCH_OLD, callsIn, DOWNLOADS, EDIT_COMPACTED, ERRAND, INVOICES, LAUNCH, LAUNCH_GROUP, LAUNCH_NO_GROUPS, NO_HOME_CHAT, NO_TREE, paramsOf, PICK, PICK_ASK, PICK_DECLINED, PROFILES, RAE_SAID,
  REGENERATE_TEAM, REMINDER, RESEARCH_CHAT, RESEARCH_SAID, SESSION, SLASH, stepOf, SORTED, SORTED_2, SORTED_3, SUDO, SUDO_ASK, TEAM, TEAM_NO_RELAY, WITH_BOTS, WITH_CHATS, WITH_VERSIONS, withGroups, withSteps
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

  it("shows a released session's content at once when it is watched again, then brings it up to date", async () => {
    const opened = open()
    const unwatch = opened.watch()
    await opened.clock.advance(0)
    const before = opened.seen.at(-1)
    unwatch()
    await opened.clock.advance(RETAIN_MS)
    expect(opened.detaches()).toHaveLength(1)
    expect(opened.hermes.sidebar.get().rows, 'its row badges nothing from what it kept').toMatchObject([{ id: SESSION, badge: 'none' }])

    const again: Session[] = []
    opened.hermes.watch(SESSION, session => again.push(session))
    expect(again[0]?.history, 'before any reply').toEqual(before?.history)
    expect(again[0]?.sync.state).not.toBe('live')
    await opened.clock.advance(0)
    expect(again.at(-1)?.sync.state).toBe('live')
    expect(again.at(-1)?.history).toEqual(before?.history)
    expect(opened.sent().filter(call => call.method === 'session.resume'), 'attached again').toHaveLength(2)
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

  it('keeps a session whose background prompt runs with no window on it, then lets it go 60 s after its answer', async () => {
    const epoch = (ERRAND.steps[1] as { push: { params: { replay_epoch: string } } }).push.params.replay_epoch
    const answer = { type: 'background.complete', session_id: SESSION, payload: { task_id: 'bg_1', text: 'Tidied.' }, replay_epoch: epoch, seq: 1 }
    const opened = open({
      ...ERRAND,
      steps: [
        { at: 0, await: 'prompt.background', params: { session_id: SESSION, text: 'Tidy the notes' }, reply: { task_id: 'bg_1' } },
        { at: 300_000, push: { jsonrpc: '2.0', method: 'event', params: answer } }
      ]
    }, { timing: 'recorded' })
    const unwatch = opened.watch()
    await opened.clock.advance(0)
    expect(await opened.hermes.run({ do: 'side', sessionId: SESSION, kind: 'background', text: 'Tidy the notes' })).toEqual({ ok: true, value: undefined })
    unwatch()
    await opened.clock.advance(299_999)
    expect(opened.detaches(), 'the background prompt is running').toEqual([])

    await opened.clock.advance(1)
    expect(opened.script.finished).toBe(true)
    const glance: Session[] = []
    opened.hermes.watch(SESSION, session => glance.push(session))()
    expect(glance.at(-1)?.sides, 'its answer reached the chat').toMatchObject([{ id: 'bg_1', state: { s: 'done', text: 'Tidied.' } }])
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
    expect(opened.hermes.sidebar.get()).toEqual({ bot: null, status: 'loading', rows: [], complete: false })
    opened.watch()
    await toApproval(opened)
    await approve(opened.hermes)
    await opened.clock.advance(1_000)
    expect(badges).toEqual(['ready:none', 'ready:running', 'ready:asking', 'ready:running', 'ready:none'])
    expect(opened.hermes.sidebar.get().rows).toEqual([{ id: SESSION, title: '', preview: null, lastActiveAt: 1795251600000, pinned: false, botChat: false, badge: 'none' }])
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
    expect(names).toHaveLength(42)
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
    expect(opened.hermes.slash.get()).toHaveLength(42)
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
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'chat', bot: null, sessionId: SESSION }, opening: null, missing: null })
    opened.watch()
    await toApproval(opened)
    expect(opened.sent().filter(call => 'profile' in (call.params ?? {}))).toEqual([])
  })

  it('is the newest chat a user can talk in, not a newer chat a scheduled job runs', async () => {
    const [chat] = (ERRAND.header.list as { sessions: Record<string, unknown>[] }).sessions
    const job = { ...chat, session_id: 'local-job', id: 'local-job', title: 'Nightly backup check', source: 'cron', started_at: Number(chat?.started_at) + 60 }
    const opened = await launched({ ...ERRAND, header: { ...ERRAND.header, list: { sessions: [job, chat], scope: 'live' } } })
    expect(opened.hermes.open.get().shown).toEqual({ kind: 'chat', bot: null, sessionId: SESSION })
    expect(opened.hermes.sidebar.get().rows.map(row => row.id)).toEqual([SESSION])
  })

  it("is the default bot's Bot Chat at launch, and launching creates nothing", async () => {
    const opened = await launched(WITH_BOTS)
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'bot', bot: EMU, sessionId: SESSION }, opening: null, missing: null })
    opened.watch()
    await opened.clock.advance(0)
    expect(calls(opened, 'session.resume')).toEqual([{ method: 'session.resume', params: { session_id: SESSION, display_projection: true, profile: 'default' } }])
    expect(calls(opened, 'session.create')).toEqual([])
  })

  it('opens a bot whose chat the roster names with no call, runs a message there as that bot, and returns to the same chat', async () => {
    const opened = await launched({ ...WITH_BOTS, header: { ...WITH_BOTS.header, models: { providers: [] } } })
    const before = opened.sent().length
    expect(await opened.hermes.run({ do: 'open', ref: bot(RESEARCH) })).toEqual({ ok: true, value: RESEARCH_CHAT })
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'bot', bot: RESEARCH, sessionId: RESEARCH_CHAT }, opening: null, missing: null })
    expect(opened.sent().slice(before), "the roster named the chat, so the click only lists the bot's chats and asks after its screen").toEqual([
      { method: 'session.list', params: { scope: 'live', picker: true, profile: 'research' } },
      { method: 'session.list', params: { scope: 'live', include_hidden: true, profile: 'research' } },
      { method: 'session.list', params: { scope: 'stored', limit: 100, include_hidden: true, picker: true, profile: 'research' } },
      { method: 'display.status', params: { profile: 'research' } }
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
    expect(forResearch.map(call => call.method), 'one resume for the whole visit, a read each time a window began to watch it, and the processes again after the turn').toEqual([
      'session.resume', 'session.stats', 'config.get', 'config.get', 'config.get', 'session.control.read', 'process.list', 'session.stats', 'prompt.submit', 'session.stats', 'process.list',
      'config.get', 'config.get', 'config.get', 'session.control.read', 'process.list', 'model.options', 'session.mutate', 'session.detach'
    ])
    expect(forResearch.map(call => call.params?.profile), 'every call that names the chat names its bot').toEqual(Array(19).fill('research'))
    expect(calls(opened, 'session.create')).toEqual([])
  })

  it('shows an unstarted chat for a bot that has none, and makes its Bot Chat once for two messages sent at once', async () => {
    const opened = await launched(WITH_BOTS)
    const first = opened.hermes.run({ do: 'open', ref: bot(HERMES_DEV) })
    const second = opened.hermes.run({ do: 'open', ref: bot(HERMES_DEV) })
    expect(opened.hermes.open.get(), 'the chat stays while Hermes is asked').toEqual({ shown: { kind: 'bot', bot: EMU, sessionId: SESSION }, opening: bot(HERMES_DEV), missing: null })
    await opened.clock.advance(0)
    expect([await first, await second]).toEqual([{ ok: true, value: null }, { ok: true, value: null }])
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'bot', bot: HERMES_DEV, sessionId: null }, opening: null, missing: null })
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
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'bot', bot: HERMES_DEV, sessionId: MADE }, opening: null, missing: null })
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
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'bot', bot: EMU, sessionId: null }, opening: null, missing: null })
    await opened.clock.advance(1_000)
    expect(calls(opened, 'session.create')).toEqual([])
    expect(await opened.hermes.run({ do: 'start', chat: unstarted(EMU), text: 'hello' })).toEqual({ ok: true, value: null })
    await opened.clock.advance(0)
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'bot', bot: EMU, sessionId: 'bot-chat-default' }, opening: null, missing: null })
    expect(saidIn(opened, 'bot-chat-default' as SessionId)).toEqual([['hello', 'default: hello']])
    expect(calls(opened, 'session.create')).toMatchObject([{ params: { profile: 'default', title: 'Bot Chat' } }])
  })

  it('opens the newest chat and refuses to switch bots on a Hermes whose socket reaches one profile', async () => {
    const opened = await launched(BOUND)
    const shown = { shown: { kind: 'chat', bot: null, sessionId: SESSION }, opening: null, missing: null }
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
    expect(offline.hermes.open.get()).toEqual({ shown: null, opening: null, missing: null })
  })

  describe('a new chat', () => {
    const fresh = (bot: BotId | null, draftId: string) => ({ kind: 'new', bot, draftId, sessionId: null }) as const
    const WITH_CATALOG: Fixture = { ...SLASH, header: { ...SLASH.header, profiles: PROFILES } }
    const MADE = 'chat-default-1' as SessionId

    it("opens empty with no call, makes its session in the bot's profile on the first message, and stays open after the list and roster refresh", async () => {
      const opened = await launched(WITH_BOTS)
      const before = opened.sent().length
      expect(await opened.hermes.run({ do: 'open', ref: { kind: 'new', bot: EMU, draftId: 'draft-1' } })).toEqual({ ok: true, value: null })
      expect(opened.hermes.open.get()).toEqual({ shown: fresh(EMU, 'draft-1'), opening: null, missing: null })
      expect(opened.sent().length, 'opening a new chat asks Hermes nothing').toBe(before)

      expect(await opened.hermes.run({ do: 'start', chat: fresh(EMU, 'draft-1'), text: 'hello' })).toEqual({ ok: true, value: null })
      await opened.clock.advance(0)
      expect(calls(opened, 'session.create')).toEqual([{
        method: 'session.create', params: { source: 'gui', request_id: 'draft-1', follow_profile_config: true, client: CLIENT, profile: 'default' }
      }])
      expect(opened.hermes.open.get()).toEqual({ shown: { ...fresh(EMU, 'draft-1'), sessionId: MADE }, opening: null, missing: null })
      expect(saidIn(opened, MADE)).toEqual([['hello', 'default: hello']])
      expect(calls(opened, 'session.resume').filter(call => call.params?.session_id === MADE), 'the new session takes the one attach path').toHaveLength(1)

      const rosters = calls(opened, 'profiles.list').length
      await opened.clock.advance(1_000)
      expect(calls(opened, 'profiles.list').length, 'the roster was read again, and still names the story as the Bot Chat').toBeGreaterThan(rosters)
      expect(opened.hermes.open.get()).toEqual({ shown: { ...fresh(EMU, 'draft-1'), sessionId: MADE }, opening: null, missing: null })
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

    it('opens up front only when its first message could be sent, and otherwise says why and leaves the open chat', async () => {
      const ready = await launched(WITH_BOTS)
      expect(await ready.hermes.run({ do: 'open', ref: { kind: 'new', bot: RESEARCH, draftId: 'draft-1' }, upFront: true })).toEqual({ ok: true, value: null })
      expect(ready.hermes.open.get().shown).toEqual(fresh(RESEARCH, 'draft-1'))
      expect(calls(ready, 'session.create'), 'opening it still makes nothing').toEqual([])

      const offline = open(WITH_BOTS)
      offline.state.failWith = new DialError('not-running')
      await offline.clock.advance(100)
      const before = offline.hermes.open.get()
      expect(await offline.hermes.run({ do: 'open', ref: { kind: 'new', bot: RESEARCH, draftId: 'draft-1' }, upFront: true }))
        .toEqual({ ok: false, refusal: { kind: 'offline', message: "Highwing isn't connected to Hermes right now." } })
      expect(offline.hermes.open.get()).toEqual(before)
      expect(await offline.hermes.run({ do: 'open', ref: { kind: 'new', bot: RESEARCH, draftId: 'draft-2' } }), 'Ctrl+N still opens a draft offline').toEqual({ ok: true, value: null })

      const bound = await launched(BOUND)
      const shown = bound.hermes.open.get()
      expect(await bound.hermes.run({ do: 'open', ref: { kind: 'new', bot: RESEARCH, draftId: 'draft-1' }, upFront: true }))
        .toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't switch bots from Highwing yet. Update Hermes on that machine, then reconnect." } })
      expect(bound.hermes.open.get()).toEqual(shown)

      const header = { ...WITH_BOTS.header, describe: { ...(WITH_BOTS.header.describe as object), session_create: { sources: ['cli'], parameters: [] } } }
      const noGui = await launched({ ...WITH_BOTS, header })
      expect(await noGui.hermes.run({ do: 'open', ref: { kind: 'new', bot: RESEARCH, draftId: 'draft-1' }, upFront: true }))
        .toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't start a chat from Highwing." } })
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
      expect(opened.hermes.open.get()).toEqual({ shown: fresh(EMU, 'minted-1'), opening: null, missing: null })
      expect(calls(opened, 'session.create')).toEqual([])
      expect(calls(opened, 'command.dispatch')).toEqual([])
      expect(calls(opened, 'prompt.submit')).toEqual([])
    })

    it('opens for a /new typed into a chat that has no session yet, and makes none', async () => {
      const opened = await minting({ ...WITH_CATALOG, header: { ...WITH_CATALOG.header, homeBotChat: false } })
      expect(opened.hermes.open.get()).toEqual({ shown: unstarted(EMU), opening: null, missing: null })
      expect(await opened.hermes.run({ do: 'start', chat: unstarted(EMU), text: ' /new ' })).toEqual({ ok: true, value: null })
      expect(opened.hermes.open.get()).toEqual({ shown: fresh(EMU, 'minted-1'), opening: null, missing: null })
      expect(await opened.hermes.run({ do: 'start', chat: fresh(EMU, 'minted-1'), text: '/NEW' })).toEqual({ ok: true, value: null })
      expect(opened.hermes.open.get()).toEqual({ shown: fresh(EMU, 'minted-2'), opening: null, missing: null })
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
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'chat', bot: RESEARCH, sessionId: INVOICES }, opening: null, missing: null })
    expect(await opened.hermes.run(picked(DOWNLOADS))).toEqual({ ok: true, value: DOWNLOADS })
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'chat', bot: RESEARCH, sessionId: DOWNLOADS }, opening: null, missing: null })

    opened.hermes.watch(DOWNLOADS, () => {})
    await opened.clock.advance(0)
    expect(await opened.hermes.run({ do: 'send', sessionId: DOWNLOADS, text: 'hello' })).toEqual({ ok: true, value: null })
    await opened.clock.advance(0)
    expect(opened.sent().filter(call => call.params?.session_id === DOWNLOADS && call.method !== 'session.stats').map(call => [call.method, call.params?.profile]), 'a picked chat runs as its bot')
      .toEqual([
        ['session.resume', 'research'], ['config.get', 'research'], ['config.get', 'research'], ['config.get', 'research'], ['session.control.read', 'research'], ['process.list', 'research'],
        ['prompt.submit', 'research'], ['process.list', 'research']
      ])
    expect(rowsOf(opened)[2], 'the badge comes from the attached chat').toEqual([DOWNLOADS, 'Clean up Downloads', 'none'])

    expect(opened.sent().filter(call => call.method === 'session.create')).toEqual([])
    const lists = opened.sent().filter(call => call.method === 'session.list' && !('title' in (call.params ?? {})))
    const each = (...bots: (BotId | undefined)[]) => bots.flatMap(bot => [bot, bot, bot])
    expect(lists.map(call => call.params?.profile), "the socket's own profile until the open chat names a bot, then every other bot behind it, then Research again on its click").toEqual(
      each(undefined, EMU, ...['dr-eggbot', 'research', 'timothy', 'hermes-dev', 'highwing'] as BotId[], RESEARCH)
    )
  })

  it("move the open chat to its bot's own chat when it is archived, and leave the list", async () => {
    const opened = open(WITH_CHATS)
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    await opened.clock.advance(0)
    await opened.hermes.run(picked(INVOICES))
    opened.hermes.watch(INVOICES, () => {})
    await opened.clock.advance(0)

    expect(await opened.hermes.run({ do: 'archive', sessionId: INVOICES, archived: true })).toEqual({ ok: true, value: undefined })
    expect(opened.hermes.open.get().shown, 'Research has no Bot Chat yet, so its unstarted one').toEqual({ kind: 'bot', bot: RESEARCH, sessionId: null })
    expect(rowsOf(opened).map(([id]) => id)).toEqual([REMINDER, DOWNLOADS])
    await opened.clock.advance(1_000)
    expect(rowsOf(opened).map(([id]) => id), 'Hermes lists it no more').toEqual([REMINDER, DOWNLOADS])
  })

  it('remove a chat at its generation, which moves the open chat off it, and refuse one whose reply still runs', async () => {
    const opened = open(WITH_CHATS)
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    await opened.clock.advance(0)
    await opened.hermes.run(picked(DOWNLOADS))
    opened.hermes.watch(DOWNLOADS, () => {})
    await opened.clock.advance(0)

    expect(await opened.hermes.run({ do: 'remove', sessionId: REMINDER })).toEqual({ ok: false, refusal: { kind: 'stale', message: 'Wait for the reply to finish, then delete this chat.' } })
    expect(await opened.hermes.run({ do: 'remove', sessionId: DOWNLOADS })).toEqual({ ok: true, value: undefined })
    expect(opened.sent().filter(call => call.method === 'session.mutate').map(call => call.params))
      .toEqual([{ profile: 'research', session_id: DOWNLOADS, request_id: expect.any(String), operation: 'delete', payload: {}, expected_revision: 0, expected_generation: 0 }])
    expect(opened.hermes.open.get().shown).toEqual({ kind: 'bot', bot: RESEARCH, sessionId: null })
    await opened.clock.advance(1_000)
    expect(rowsOf(opened).map(([id]) => id)).toEqual([REMINDER, INVOICES])
  })

  it("mark the bot's own chat as the roster names it, and not a chat that only has its title", async () => {
    const lookalike = { id: 'local-0199', title: 'Bot Chat', last_active: 1795251000, rows: [{ role: 'user' as const, text: 'hi' }] }
    const opened = open({ ...WITH_BOTS, header: { ...WITH_BOTS.header, chats: { research: [lookalike] } } })
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    await opened.clock.advance(0)
    expect(opened.hermes.sidebar.get().rows.map(row => [row.id, row.title, row.botChat])).toEqual([['local-0199', 'Bot Chat', false], [RESEARCH_CHAT, 'Bot Chat', true]])
  })

  it("mark the bot's own chat on a Hermes whose socket reaches one profile, where the list follows no bot", async () => {
    const opened = open(BOUND)
    await opened.clock.advance(1_000)
    expect(opened.hermes.sidebar.get()).toMatchObject({ bot: null, rows: [{ id: SESSION, botChat: true }] })
  })

  it('show a pin at once, keep it after the list is read again, and take it off again', async () => {
    const opened = open(WITH_CHATS)
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    await opened.clock.advance(0)
    const pins = () => opened.hermes.sidebar.get().rows.filter(row => row.pinned).map(row => row.id)

    expect(await opened.hermes.run({ do: 'pin', sessionId: DOWNLOADS, pinned: true })).toEqual({ ok: true, value: undefined })
    expect(pins()).toEqual([DOWNLOADS])
    await opened.clock.advance(1_000)
    expect(pins(), 'as Hermes lists it').toEqual([DOWNLOADS])
    expect(await opened.hermes.run({ do: 'pin', sessionId: DOWNLOADS, pinned: false })).toEqual({ ok: true, value: undefined })
    await opened.clock.advance(1_000)
    expect(pins()).toEqual([])
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

  const listsOf = (opened: ReturnType<typeof open>, bot: BotId) => opened.sent().filter(call => call.method === 'session.list' && call.params?.profile === bot && !('title' in (call.params ?? {})))
  const shown = (opened: ReturnType<typeof open>) => {
    const seen: string[] = []
    opened.hermes.sidebar.subscribe(sidebar => seen.push(`${sidebar.bot}:${sidebar.status}:${sidebar.rows.map(row => row.id).join()}`))
    return seen
  }

  it("show a bot's last rows at once when the user comes back to it, and refresh them behind", async () => {
    const opened = open(WITH_CHATS)
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    await opened.clock.advance(0)
    const seen = shown(opened)

    void opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: EMU } })
    expect(seen, 'before any reply').toEqual([`${EMU}:stale:${SESSION}`])
    await opened.clock.advance(0)
    expect(seen).toEqual([`${EMU}:stale:${SESSION}`, `${EMU}:ready:${SESSION}`])
    expect(listsOf(opened, EMU), 'listed again').toHaveLength(6)
  })

  it('list every other bot behind the open one, one at a time, so a first visit shows its rows at once', async () => {
    const opened = open(WITH_CHATS, { latencyMs: 75 })
    const seen = shown(opened)
    while (listsOf(opened, EMU).length === 0) await opened.clock.advance(5)
    expect(listsOf(opened, 'dr-eggbot' as BotId), 'nothing behind the open bot while its list is on its way').toHaveLength(0)
    await opened.clock.advance(76)
    expect(listsOf(opened, 'dr-eggbot' as BotId), 'the first bot behind it, once that answered').toHaveLength(3)
    expect(listsOf(opened, RESEARCH), 'the next, after that one answers').toHaveLength(0)
    await opened.clock.advance(1_000)
    expect(listsOf(opened, RESEARCH)).toHaveLength(3)
    expect(seen.every(each => each.startsWith(`${EMU}:`)), 'no other bot\'s answer is shown under the open one').toBe(true)

    void opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    await opened.clock.advance(80)
    expect(seen.at(-1), 'once its title lookup answers, shown from the answer kept for it').toBe(`${RESEARCH}:stale:${[REMINDER, INVOICES, DOWNLOADS].join()}`)
    await opened.clock.advance(80)
    expect(seen.at(-1)).toBe(`${RESEARCH}:ready:${[REMINDER, INVOICES, DOWNLOADS].join()}`)
  })

  it('list no bot behind the open one on a Hermes whose socket reaches one profile', async () => {
    const opened = open(BOUND)
    await opened.clock.advance(1_000)
    expect(opened.sent().filter(call => call.method === 'session.list' && call.params?.profile !== undefined)).toEqual([])
  })

  it('ask for the new bot at once while the list of the bot it left is still on its way', async () => {
    const opened = open(WITH_CHATS, { latencyMs: 75 })
    await opened.clock.advance(2_000)
    void opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    await opened.clock.advance(90)
    const asked = { research: listsOf(opened, RESEARCH).length, emu: listsOf(opened, EMU).length }
    void opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: EMU } })
    await opened.clock.advance(1)
    expect(listsOf(opened, RESEARCH), "Research's refresh has not answered").toHaveLength(asked.research)
    expect(listsOf(opened, EMU)).toHaveLength(asked.emu + 3)
  })
})

describe('a chat link', () => {
  const RESEARCH = 'research' as BotId
  const UNKNOWN = 'local-9999' as SessionId
  const linked = (sessionId: SessionId) => ({ do: 'open', ref: { kind: 'link', sessionId } }) as const
  const seeks = (opened: ReturnType<typeof open>) =>
    opened.sent().filter(call => call.method === 'session.list' && call.params?.scope === 'stored' && call.params.picker === undefined).map(call => call.params)

  it("waits for Hermes's bots, then opens a chat the roster names in its bot with no search", async () => {
    const opened = open(WITH_BOTS)
    const outcome = opened.hermes.run(linked(RESEARCH_CHAT))
    expect(opened.hermes.open.get(), 'held while Hermes has said nothing about its bots').toEqual({ shown: null, opening: { kind: 'link', sessionId: RESEARCH_CHAT }, missing: null })
    await opened.clock.advance(0)
    expect(await outcome).toEqual({ ok: true, value: RESEARCH_CHAT })
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'chat', bot: RESEARCH, sessionId: RESEARCH_CHAT }, opening: null, missing: null })
    expect(seeks(opened)).toEqual([])
  })

  it('looks through every bot for a chat only a list names, and opens it as that bot', async () => {
    const opened = open(WITH_CHATS)
    const outcome = opened.hermes.run(linked(INVOICES))
    expect(opened.hermes.open.get().opening, 'asked before any list could name it').toEqual({ kind: 'link', sessionId: INVOICES })
    await opened.clock.advance(0)
    expect(await outcome).toEqual({ ok: true, value: INVOICES })
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'chat', bot: RESEARCH, sessionId: INVOICES }, opening: null, missing: null })
    expect(seeks(opened).map(params => params?.profile).sort()).toEqual(['default', 'dr-eggbot', 'hermes-dev', 'highwing', 'research', 'timothy'])
    expect(seeks(opened)[0]).toEqual({ scope: 'stored', include_hidden: true, limit: 200, profile: expect.any(String) as string })

    opened.hermes.watch(INVOICES, () => {})
    await opened.clock.advance(0)
    expect(opened.sent().filter(call => call.method === 'session.resume' && call.params?.session_id === INVOICES).map(call => call.params?.profile)).toEqual(['research'])
    expect(opened.sent().filter(call => call.method === 'session.create')).toEqual([])
  })

  it('keeps the open chat and names the missing one when Hermes has no chat by that id', async () => {
    const opened = open(WITH_CHATS)
    await opened.clock.advance(0)
    const before = opened.hermes.open.get().shown
    const outcome = opened.hermes.run(linked(UNKNOWN))
    await opened.clock.advance(0)
    expect(await outcome).toEqual({ ok: true, value: null })
    expect(opened.hermes.open.get()).toEqual({ shown: before, opening: null, missing: UNKNOWN })
    await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    expect(opened.hermes.open.get().missing, 'the next click clears it').toBeNull()
  })

  it("looks only in the socket's own profile on a Hermes whose socket reaches one", async () => {
    const opened = open(BOUND)
    await opened.clock.advance(0)
    const outcome = opened.hermes.run(linked(UNKNOWN))
    await opened.clock.advance(0)
    expect(await outcome).toEqual({ ok: true, value: null })
    expect(seeks(opened)).toEqual([{ scope: 'stored', include_hidden: true, limit: 200 }])
    expect(opened.hermes.open.get().missing).toBe(UNKNOWN)
  })

  it('holds a link while Highwing cannot reach Hermes, and opens it once connected', async () => {
    const opened = open(WITH_CHATS)
    opened.state.failWith = new DialError('not-running')
    await opened.clock.advance(100)
    const outcome = opened.hermes.run(linked(INVOICES))
    expect(opened.hermes.open.get()).toEqual({ shown: null, opening: { kind: 'link', sessionId: INVOICES }, missing: null })
    opened.state.failWith = null
    await opened.clock.advance(30_000)
    expect(await outcome).toEqual({ ok: true, value: INVOICES })
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'chat', bot: RESEARCH, sessionId: INVOICES }, opening: null, missing: null })
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
      { await: 'prompt.submit', params: { session_id: SESSION, text: '/undo', input_id: 'minted' }, reply: RECEIPT }
    ), '/undo')
    expect(opened.sent().find(call => call.method === 'prompt.submit')?.params).toMatchObject({ text: '/undo' })
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
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'branch', bot: null, sessionId: CHILD, text: SECOND_REQUEST }, opening: null, missing: null })
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
    expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'chat', bot: null, sessionId: SESSION }, opening: null, missing: null })
    expect(opened.script.branchesMade).toBe(0)

    const again = opened.hermes.run(branch(3, B1))
    await opened.clock.advance(0)
    expect(await again).toEqual(refusal)
    expect(mutations(opened)).toHaveLength(2)
  })

  describe('in a chat Hermes compacted', () => {
    const CANT_BRANCH_COMPACTED = { ok: false, refusal: { kind: 'rejected', message: "Hermes compacted this part of the chat, so it can't branch from here." } }
    const reads = (opened: ReturnType<typeof open>) => opened.sent().filter(call => call.method === 'session.transcript')

    it('says Hermes compacted a message from before the compaction, which the chat as opened does not show', async () => {
      const { opened, outcome } = await branched(BRANCH_COMPACTED, branch(1, B1))
      let shown: Session | undefined
      opened.hermes.watch(SESSION, session => { shown = session })()
      expect(shown?.history.flatMap(turn => turn.items).filter(item => item.kind === 'notice')).toEqual([])
      expect(outcome).toEqual(CANT_BRANCH_COMPACTED)
      expect(mutations(opened)).toHaveLength(1)
      expect(reads(opened)).toHaveLength(1)
      expect(reads(opened)[0]?.params).toMatchObject({ session_id: SESSION, order: 'latest' })
      expect(opened.script.branchesMade).toBe(0)
      expect(opened.hermes.open.get()).toEqual({ shown: { kind: 'chat', bot: null, sessionId: SESSION }, opening: null, missing: null })
    })

    it('branches from a message after the compaction', async () => {
      const { outcome } = await branched(BRANCH_COMPACTED, branch(4, B1))
      expect(outcome).toEqual({ ok: true, value: CHILD })
    })

    it("says a Hermes that can't branch can't, from a message after the compaction", async () => {
      const { outcome } = await branched({ ...BRANCH_OLD, header: { ...BRANCH_OLD.header, stored: BRANCH_COMPACTED.header.stored } }, branch(4, B1))
      expect(outcome).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't branch a chat." } })
    })
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

describe('editing a message from before a compaction', () => {
  it('says Hermes compacted it, sends nothing and keeps every turn', async () => {
    const opened = open(EDIT_COMPACTED)
    await opened.clock.advance(0)
    const outcome = opened.hermes.run({ do: 'rewind', sessionId: SESSION, rowId: 1, text: 'Rename the heading in notes.md to Goals' })
    await opened.clock.advance(0)
    expect(await outcome).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes compacted this part of the chat, so it can't edit this message." } })
    expect(opened.sent().filter(call => call.method === 'session.mutate')).toHaveLength(1)
    expect(opened.sent().map(call => call.method)).not.toContain('prompt.submit')
    let shown: Session | undefined
    opened.hermes.watch(SESSION, session => { shown = session })()
    expect(shown?.history.map(turn => turn.request?.text)).toEqual(['Rename the heading in notes.md to Plan', 'Add a line about the deadline under it', 'List the folder'])
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

  it('moves a handed message to the newest turn kept when a regenerate cuts the turn it was sent after', async () => {
    const opened = open(REGENERATE_TEAM)
    opened.watch()
    await send(opened, ASK)
    const [, kept, cut] = opened.seen.at(-1)?.history.map(turn => turn.id) ?? []
    expect(kept).toBeDefined()
    expect(relays(opened)).toMatchObject([{ after: cut }])
    await opened.hermes.run({ do: 'rewind', sessionId: SESSION, rowId: 5, text: 'List the folder' })
    await opened.clock.advance(0)
    expect(relays(opened)).toMatchObject([{ after: kept }])
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
    expect(shownChat(hidden.hermes.open.get())?.sessionId).toBeNull()
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
    expect(opened.seen.at(-1)?.tuning).toEqual({ reasoning: false, busy: null, effort: null, fast: null, yolo: null, approvals: null })
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
    expect(opened.seen.at(-1)?.tuning).toEqual({ reasoning: true, busy: null, effort: null, fast: null, yolo: null, approvals: null })
  })

  it('stays unknown on a Hermes that refuses the read, and says it cannot set it', async () => {
    const opened = open()
    opened.watch()
    await opened.clock.advance(0)
    expect(reads(opened)).toHaveLength(1)
    expect(opened.seen.at(-1)?.tuning).toEqual({ reasoning: null, busy: null, effort: null, fast: null, yolo: null, approvals: null })
    expect(await opened.hermes.run({ do: 'tune', sessionId: SESSION, set: 'reasoning', on: true })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes doesn't support that." } })
  })
})

describe('group chats', () => {
  const groupCalls = (opened: ReturnType<typeof open>) => opened.sent().filter(call => call.method.startsWith('groups.'))
  const creates = (opened: ReturnType<typeof open>) => opened.sent().filter(call => call.method === 'groups.create')
  const rows = (opened: ReturnType<typeof open>) => {
    const groups = opened.hermes.groups.get()
    return groups.state === 'listed' ? groups.rows.map(row => [row.name, row.members.map(member => member.handle).join(' ')]) : groups.state
  }
  const draft = (bots: readonly string[], more: Partial<GroupDraft> = {}): GroupDraft => ({ group: 'launch-plan' as GroupId, name: 'Launch plan', bots: bots as BotId[], ...more })
  const launched = async (fixture: Fixture) => {
    const opened = open(fixture)
    await opened.clock.advance(0)
    return opened
  }
  const STANDUP = { id: 'standup', name: 'Standup', members: [{ profile: 'otto', handle: 'otto' }, { profile: 'mia', handle: 'mia' }] }

  it('are unsupported on a Hermes that has none, which is asked once for the whole errand and never polled', async () => {
    const opened = open(LAUNCH_NO_GROUPS)
    opened.watch()
    expect(opened.hermes.groups.get()).toEqual({ state: 'loading' })
    await toApproval(opened)
    expect(opened.hermes.groups.get()).toEqual({ state: 'unsupported' })
    await approve(opened.hermes)
    await opened.clock.advance(120_000)
    expect(opened.script.finished).toBe(true)
    expect(groupCalls(opened)).toEqual([{ method: 'groups.capabilities', params: {} }])
    expect(await opened.hermes.run({ do: 'createGroup', draft: draft(['default', 'sam']) })).toEqual({
      ok: false, refusal: { kind: 'unsupported', message: 'This Hermes has no group chats. Update Hermes on that machine, then reconnect.' }
    })
  })

  it('are listed with their seats, most recently changed first, with the bots Hermes would seat and who is answering in each', async () => {
    const opened = await launched(withGroups({ seatable: ['default', 'sam', 'juno'], rooms: [{ id: 'launch-plan', name: 'Launch plan', members: [{ profile: 'default', handle: 'ada' }, { profile: 'sam', handle: 'sam' }] }, STANDUP] }))
    expect(opened.hermes.groups.get()).toEqual({
      state: 'listed', driver: true, seatable: ['default', 'juno', 'sam'], rows: [
        { id: 'launch-plan', name: 'Launch plan', members: [{ id: 'default', bot: 'default', handle: 'ada', name: 'ada' }, { id: 'sam', bot: 'sam', handle: 'sam', name: 'sam' }], answering: [] },
        { id: 'standup', name: 'Standup', members: [{ id: 'otto', bot: 'otto', handle: 'otto', name: 'otto' }, { id: 'mia', bot: 'mia', handle: 'mia', name: 'mia' }], answering: [] }
      ]
    })
    expect(groupCalls(opened), 'all on the socket\'s own profile, and no log of a group nobody looks at').toEqual([
      { method: 'groups.capabilities', params: {} }, { method: 'groups.list', params: {} },
      { method: 'groups.state', params: { room_id: 'launch-plan' } }, { method: 'groups.state', params: { room_id: 'standup' } }
    ])
  })

  it('list a new group first as soon as Hermes makes it, each bot asked by the name the sidebar shows', async () => {
    const opened = await launched(withGroups({ rooms: [STANDUP] }))
    const seen: string[] = []
    opened.hermes.groups.subscribe(groups => seen.push(groups.state === 'listed' ? groups.rows.map(row => row.name).join(', ') : groups.state))
    expect(await opened.hermes.run({ do: 'createGroup', draft: draft(['default', 'sam', 'juno']) })).toEqual({ ok: true, value: undefined })
    expect(seen[0], 'before Hermes is asked for its list again').toBe('Launch plan, Standup')
    expect(creates(opened)).toEqual([{
      method: 'groups.create',
      params: { room_id: 'launch-plan', name: 'Launch plan', members: [{ member_id: 'default', profile: 'default', handle: 'ada' }, { member_id: 'sam', profile: 'sam', handle: 'sam' }, { member_id: 'juno', profile: 'juno', handle: 'juno' }] }
    }])
    await opened.clock.advance(0)
    expect(rows(opened)).toEqual([['Launch plan', 'ada sam juno'], ['Standup', 'otto mia']])
  })

  it('make one group for a create sent twice under one id, and refuse another group under it', async () => {
    const opened = await launched(LAUNCH)
    expect(await opened.hermes.run({ do: 'createGroup', draft: draft(['default', 'sam']) })).toEqual({ ok: true, value: undefined })
    expect(await opened.hermes.run({ do: 'createGroup', draft: draft(['default', 'sam']) })).toEqual({ ok: true, value: undefined })
    await opened.clock.advance(0)
    expect(rows(opened)).toEqual([['Launch plan', 'ada sam']])
    expect(creates(opened)).toHaveLength(2)

    expect(await opened.hermes.run({ do: 'createGroup', draft: draft(['default', 'sam'], { name: 'Release' }) })).toEqual({
      ok: false, refusal: { kind: 'rejected', message: "Hermes didn't accept this group chat. Try again." }
    })
    await opened.clock.advance(0)
    expect(rows(opened)).toEqual([['Launch plan', 'ada sam']])
  })

  it('refuse a bot Hermes would not seat under the dialog\'s list, in Hermes\'s words, and list nothing', async () => {
    const opened = await launched(withGroups({ seatable: ['default', 'sam', 'juno'] }))
    expect(await opened.hermes.run({ do: 'createGroup', draft: draft(['default', 'otto']) })).toEqual({
      ok: false, refusal: { kind: 'rejected', field: 'members', message: "Hermes can't seat these bots: member 1 profile 'otto': this bot can't join group chats yet" }
    })
    await opened.clock.advance(0)
    expect(rows(opened)).toEqual([])
  })

  it('refuse a bot the roster no longer lists before Hermes is asked', async () => {
    const opened = await launched(LAUNCH)
    expect(await opened.hermes.run({ do: 'createGroup', draft: draft(['default', 'zed']) })).toMatchObject({ ok: false, refusal: { kind: 'rejected', field: 'members' } })
    expect(creates(opened)).toEqual([])
  })

  it('are made on a Hermes that is not running them now, which says so', async () => {
    const opened = await launched(withGroups({ driver: false }))
    expect(opened.hermes.groups.get()).toMatchObject({ state: 'listed', driver: false, rows: [] })
    expect(await opened.hermes.run({ do: 'createGroup', draft: draft(['default', 'sam']) })).toEqual({ ok: true, value: undefined })
    expect(rows(opened)).toEqual([['Launch plan', 'ada sam']])
  })

  it('stay listed while the socket is gone, are read again on the new one, and refuse a create meanwhile', async () => {
    const opened = open(withGroups({ rooms: [STANDUP] }), { drop: { afterPush: 5, missed: 0 } })
    opened.watch()
    await toApproval(opened)
    expect(opened.hermes.link.get()).toMatchObject({ state: 'waiting', why: 'dropped' })
    expect(rows(opened)).toEqual([['Standup', 'otto mia']])
    expect(await opened.hermes.run({ do: 'createGroup', draft: draft(['default', 'sam']) })).toEqual({ ok: false, refusal: { kind: 'offline', message: "Highwing isn't connected to Hermes right now." } })
    await opened.clock.advance(1_000)
    expect(opened.hermes.link.get()).toEqual({ state: 'online' })
    expect(groupCalls(opened).filter(call => call.method === 'groups.list').length, 'at least once on each of the two sockets').toBeGreaterThanOrEqual(2)
    expect(rows(opened)).toEqual([['Standup', 'otto mia']])
  })

  it('are offline when the first dial fails, then listed after a reconnect', async () => {
    const opened = open(LAUNCH)
    opened.state.failWith = new DialError('not-running')
    await opened.clock.advance(100)
    expect(opened.hermes.groups.get()).toEqual({ state: 'offline' })
    opened.state.failWith = null
    await opened.hermes.run({ do: 'reconnect', start: true })
    await opened.clock.advance(0)
    expect(rows(opened)).toEqual([])
  })
})

describe('a group chat', () => {
  const PLAN = 'launch-plan' as GroupId
  const ROOM = { id: PLAN, name: 'Launch plan', members: [{ profile: 'default', handle: 'ada' }, { profile: 'sam', handle: 'sam' }, { profile: 'juno', handle: 'juno' }] }
  const STANDUP = { id: 'standup', name: 'Standup', members: [{ profile: 'otto', handle: 'otto' }, { profile: 'mia', handle: 'mia' }] }
  const ASK = 'Can we ship the login fix on Thursday? Sam, how close is it? Juno, what else is on that release?'
  const replies = Object.fromEntries(Object.entries(LAUNCH_GROUP.header.groups?.turns ?? {}).map(([profile, [first]]) => [profile, first !== undefined && 'reply' in first ? first.reply : '']))
  const room = (more: GroupsScript = {}) => withGroups({ rooms: [ROOM], ...more })

  const readOf = (chat: GroupChat | null) => (chat?.at === 'read' ? chat : null)
  const thread = (chat: GroupChat | null) => readOf(chat)?.events.map(event => (event.kind === 'said' ? ['said', event.text] : [event.member, event.kind === 'reply' ? event.text : event.why])) ?? null
  const who = (chat: GroupChat | null) => readOf(chat)?.answering.map(turn => [turn.member, turn.doing]) ?? null

  async function shown(fixture: Fixture = LAUNCH_GROUP, options: Partial<HermesOptions> = {}) {
    const opened = open(fixture, options)
    await opened.clock.advance(0)
    expect(await opened.hermes.run({ do: 'open', ref: { kind: 'group', group: PLAN } })).toEqual({ ok: true, value: null })
    await opened.clock.advance(0)
    const chat = () => opened.hermes.groupChat.get()
    const calls = (method: string) => opened.sent().filter(call => call.method === method)
    const say = (text: string, group = PLAN) => opened.hermes.run({ do: 'sendToGroup', group, text })
    return { ...opened, chat, calls, say }
  }

  function dropping(...gateways: Fixture[]) {
    const clock = manualClock()
    const scripts = gateways.map(fixture => scriptedDialer(fixture, { clock }))
    let socket: WireSocket | null = null
    let dials = 0
    const dial: Dialer = async request => (socket = await scripts[Math.min(dials++, scripts.length - 1)]!(request))
    const hermes = openHermes({ dial, clock, client: CLIENT })
    const sent = () => scripts.flatMap(script => callsIn(script.received))
    return { clock, hermes, scripts, sent, drop: () => socket?.onClose?.(1006, 'dropped') }
  }

  it('shows who is thinking, then each reply in roster order, and a member a reply asks for answers again', async () => {
    const opened = await shown()
    expect(opened.chat()).toEqual({ group: PLAN, at: 'read', name: 'Launch plan', members: expect.any(Array), events: [], earlier: false, answering: [], sending: [] })
    expect(await opened.say(ASK)).toEqual({ ok: true, value: undefined })
    await opened.clock.advance(0)
    expect(thread(opened.chat())).toEqual([['said', ASK]])
    expect(who(opened.chat()), 'Ada is thinking').toEqual([['default', 'thinking']])
    await opened.clock.advance(900)
    expect(thread(opened.chat())).toEqual([['said', ASK], ['default', replies.default]])
    expect(who(opened.chat())).toEqual([['sam', 'thinking']])
    await opened.clock.advance(1_800)
    expect(thread(opened.chat())).toEqual([['said', ASK], ['default', replies.default], ['sam', replies.sam], ['juno', replies.juno]])
    expect(who(opened.chat()), "Juno's @sam gives Sam another turn").toEqual([['sam', 'thinking']])
    expect(opened.hermes.groups.get(), 'the sidebar row says so too').toMatchObject({ rows: [{ id: PLAN, answering: [{ member: 'sam', doing: 'thinking' }] }] })
    expect(opened.calls('groups.send').map(call => call.params)).toEqual([{ room_id: PLAN, event_id: expect.any(String), payload: { text: ASK, thread_id: 'main' } }])
  })

  it('stops the member that is answering, and shows that it was stopped', async () => {
    const opened = await shown()
    await opened.say(ASK)
    await opened.clock.advance(2_700)
    expect(who(opened.chat())).toEqual([['sam', 'thinking']])
    expect(await opened.hermes.run({ do: 'stopGroup', group: PLAN })).toEqual({ ok: true, value: undefined })
    await opened.clock.advance(0)
    expect(who(opened.chat())).toEqual([])
    expect(thread(opened.chat())?.at(-1)).toEqual(['sam', 'stopped'])
    expect(opened.hermes.groups.get()).toMatchObject({ rows: [{ id: PLAN, answering: [] }] })
    expect(opened.calls('groups.stop').map(call => call.params)).toEqual([{ room_id: PLAN, cancel_id: expect.any(String) }])
  })

  it('shows a reply a newer message came before as not posted, under the message it answered, and then the newer one\'s', async () => {
    const opened = await shown(room({ turns: { default: [{ reply: 'Thursday.', delay_ms: 900 }, { reply: 'Friday, then.', delay_ms: 900 }] } }))
    await opened.say('Ship Thursday?')
    await opened.clock.advance(300)
    await opened.say('Or Friday?')
    await opened.clock.advance(0)
    expect(who(opened.chat()), "Hermes lets Ada's first turn run on").toEqual([['default', 'thinking']])
    await opened.clock.advance(600)
    expect(thread(opened.chat())).toEqual([['said', 'Ship Thursday?'], ['said', 'Or Friday?'], ['default', 'superseded']])
    const [first, , late] = readOf(opened.chat())?.events ?? []
    expect(late, 'it answered the first message').toMatchObject({ kind: 'silent', about: first?.kind === 'said' ? first.id : null })
    await opened.clock.advance(900)
    expect(thread(opened.chat())?.at(-1)).toEqual(['default', 'Friday, then.'])
    expect(new Set(opened.calls('groups.send').map(call => (call.params?.payload as { thread_id: string }).thread_id)), 'one thread for every message').toEqual(new Set(['main']))
  })

  it('reads a group again when Hermes says it moved, with a slow backstop behind the pushes', async () => {
    const opened = await shown()
    await opened.say(ASK)
    await opened.clock.advance(900)
    expect(thread(opened.chat())?.at(-1), 'the reply lands with the push, not at the next poll').toEqual(['default', replies.default])
    await opened.clock.advance(1_800)
    const states = opened.calls('groups.state').length
    await opened.clock.advance(14_999)
    expect(opened.calls('groups.state')).toHaveLength(states)
    await opened.clock.advance(1)
    expect(opened.calls('groups.state')).toHaveLength(states + 1)
  })

  it('lists a group another client made as soon as Hermes says it moved', async () => {
    const opened = await shown(room())
    const other = opened.client()
    await opened.clock.advance(0)
    expect(await other.run({ do: 'createGroup', draft: { group: 'standup' as GroupId, name: 'Standup', bots: ['otto', 'mia'] as BotId[] } })).toEqual({ ok: true, value: undefined })
    await opened.clock.advance(0)
    expect(opened.hermes.groups.get()).toMatchObject({ rows: [{ id: 'standup' }, { id: PLAN }] })
  })

  it('asks every 2 s on a Hermes that does not push, only while a group is shown or busy, and then not at all', async () => {
    const opened = await shown(room({ change_events: false, turns: { default: [{ reply: 'Thursday.', delay_ms: 900 }] } }))
    await opened.say('Ship Thursday?')
    await opened.clock.advance(1_999)
    expect(thread(opened.chat()), 'nothing pushed, and the next ask is due at 2 s').toEqual([['said', 'Ship Thursday?']])
    await opened.clock.advance(1)
    expect(thread(opened.chat())?.at(-1)).toEqual(['default', 'Thursday.'])
    const shownStates = opened.calls('groups.state').length
    await opened.clock.advance(10_000)
    expect(opened.calls('groups.state').length - shownStates, 'a shown group is asked about every 2 s').toBe(5)

    await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: 'default' as BotId } })
    const idle = opened.calls('groups.state').length
    await opened.clock.advance(60_000)
    expect(opened.calls('groups.state'), 'nothing shown and nothing busy').toHaveLength(idle)
  })

  it('keeps asking about a busy group nobody looks at on a Hermes that does not push, until nobody answers in it', async () => {
    const opened = await shown(room({ change_events: false, turns: { default: [{ reply: 'Thursday.', delay_ms: 5_000 }] } }))
    await opened.say('Ship Thursday?')
    await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: 'default' as BotId } })
    await opened.clock.advance(4_000)
    expect(opened.hermes.groups.get()).toMatchObject({ rows: [{ answering: [{ member: 'default' }] }] })
    await opened.clock.advance(2_000)
    expect(opened.hermes.groups.get()).toMatchObject({ rows: [{ answering: [] }] })
    const idle = opened.calls('groups.state').length
    await opened.clock.advance(60_000)
    expect(opened.calls('groups.state')).toHaveLength(idle)
    expect(opened.calls('groups.log').every(call => call.params?.room_id === PLAN)).toBe(true)
  })

  it.each([
    ['a new authority epoch', { epoch: 2, log: [{ user: 'Ship it?' }, { member: 'juno', text: 'Not yet.' }, { user: 'When?' }] }, [['said', 'Ship it?'], ['juno', 'Not yet.'], ['said', 'When?']]],
    ['a log that now ends before where Highwing read to', { log: [{ user: 'Fresh start' }] }, [['said', 'Fresh start']]]
  ])('reads the log again from the start after %s, and shows each line once', async (_, after, then) => {
    const before = room({ rooms: [{ ...ROOM, log: [{ user: 'Ship it?' }, { member: 'sam', text: 'Yes.' }] }] })
    const opened = dropping(before, room({ rooms: [{ ...ROOM, ...after }] }))
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'open', ref: { kind: 'group', group: PLAN } })
    await opened.clock.advance(0)
    expect(thread(opened.hermes.groupChat.get())).toEqual([['said', 'Ship it?'], ['sam', 'Yes.']])
    opened.drop()
    await opened.clock.advance(1_000)
    expect(opened.hermes.link.get()).toEqual({ state: 'online' })
    expect(thread(opened.hermes.groupChat.get())).toEqual(then)
  })

  it('reads every listed group on a new socket, so a group that got busy meanwhile says who is answering', async () => {
    const opened = dropping(withGroups({ change_events: false, rooms: [ROOM, STANDUP], turns: { default: [{ hold: true }] } }))
    await opened.clock.advance(0)
    expect(opened.hermes.groups.get()).toMatchObject({ rows: [{ id: PLAN, answering: [] }, { id: 'standup', answering: [] }] })
    const other = openHermes({ dial: opened.scripts[0]!, clock: opened.clock, client: CLIENT })
    await opened.clock.advance(0)
    expect(await other.run({ do: 'sendToGroup', group: PLAN, text: 'Ship it?' })).toEqual({ ok: true, value: undefined })
    await opened.clock.advance(60_000)
    expect(opened.hermes.groups.get(), 'no push, and nothing shown or busy to ask about').toMatchObject({ rows: [{ id: PLAN, answering: [] }, { id: 'standup', answering: [] }] })
    const states = (room: string) => opened.sent().filter(call => call.method === 'groups.state' && call.params?.room_id === room).length
    const before = [states(PLAN), states('standup')]
    opened.drop()
    await opened.clock.advance(1_000)
    expect([states(PLAN), states('standup')]).toEqual(before.map(count => count + 1))
    expect(opened.hermes.groups.get()).toMatchObject({ rows: [{ id: PLAN, answering: [{ member: 'default', doing: 'thinking' }] }, { id: 'standup', answering: [] }] })
  })

  it('refuses a message and a Stop while Hermes is not running group chats, in words, and sends neither', async () => {
    const opened = await shown(room({ driver: false }))
    const words = { ok: false, refusal: { kind: 'rejected', message: "Hermes isn't running group chats right now." } }
    expect(await opened.say('Ship it?')).toEqual(words)
    expect(await opened.hermes.run({ do: 'stopGroup', group: PLAN })).toEqual(words)
    expect([...opened.calls('groups.send'), ...opened.calls('groups.stop')]).toEqual([])
    expect(readOf(opened.chat())?.sending).toEqual([])
  })

  it('refuses text over 64 KB before Hermes is asked, and sends text of exactly that size', async () => {
    const opened = await shown(room())
    expect(await opened.say('é'.repeat(32_769))).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'This message is too long for a group chat. Hermes takes up to 64 KB of text.' } })
    expect(opened.calls('groups.send')).toEqual([])
    expect(await opened.say('a'.repeat(65_536))).toEqual({ ok: true, value: undefined })
  })

  it('sends the same words again under the same key after an answer that never came, so Hermes keeps one message', async () => {
    let keys = 0
    const clock = manualClock()
    const script = scriptedDialer(room(), { clock })
    let lost: number | null = null
    const dial: Dialer = async request => {
      const socket = await script(request)
      return {
        reach: socket.reach,
        send: text => {
          const frame = JSON.parse(text) as { id: number; method: string }
          if (frame.method === 'groups.send' && lost === null) lost = frame.id
          socket.send(text)
        },
        close: () => socket.close(),
        get onText() { return socket.onText },
        set onText(listener) { socket.onText = listener && (text => (lost !== null && text.includes(`"id":${lost},`) ? undefined : listener(text))) },
        get onClose() { return socket.onClose },
        set onClose(listener) { socket.onClose = listener }
      } satisfies WireSocket
    }
    const hermes = openHermes({ dial, clock, client: CLIENT, mintId: () => `key-${++keys}` })
    await clock.advance(0)
    await hermes.run({ do: 'open', ref: { kind: 'group', group: PLAN } })
    await clock.advance(0)
    const first = hermes.run({ do: 'sendToGroup', group: PLAN, text: 'Ship it?' })
    await clock.advance(10_000)
    expect(await first).toEqual({ ok: false, refusal: { kind: 'offline', message: "Highwing isn't connected to Hermes right now." } })
    expect(readOf(hermes.groupChat.get())?.sending, 'the words stay in the box, not in the thread').toEqual([])
    expect(await hermes.run({ do: 'sendToGroup', group: PLAN, text: 'Ship it?' })).toEqual({ ok: true, value: undefined })
    await clock.advance(0)
    expect(await hermes.run({ do: 'sendToGroup', group: PLAN, text: 'And Friday?' })).toEqual({ ok: true, value: undefined })
    await clock.advance(0)
    const sends = callsIn(script.received).filter(call => call.method === 'groups.send').map(call => call.params?.event_id)
    expect(sends).toEqual([sends[0], sends[0], expect.not.stringMatching(String(sends[0]))])
    expect(thread(hermes.groupChat.get())?.filter(([kind]) => kind === 'said')).toEqual([['said', 'Ship it?'], ['said', 'And Friday?']])
  })

  it('shows a group it makes at once, over the chat it was made from', async () => {
    const opened = open(room({ rooms: [] }))
    await opened.clock.advance(0)
    const draft = { group: PLAN, name: 'Launch plan', bots: ['default', 'sam'] as BotId[] }
    expect(await opened.hermes.run({ do: 'createGroup', draft })).toEqual({ ok: true, value: undefined })
    expect(opened.hermes.open.get().shown).toEqual({ kind: 'group', group: PLAN, over: 'default' })
    await opened.clock.advance(0)
    expect(opened.hermes.groupChat.get()).toMatchObject({ group: PLAN, at: 'read', name: 'Launch plan', events: [] })
  })

  it('keeps the Chats column on the bot it was opened over, and shows no chat while a group is open', async () => {
    const opened = open(room())
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: 'sam' as BotId } })
    await opened.clock.advance(0)
    const lists = opened.sent().filter(call => call.method === 'session.list').length
    await opened.hermes.run({ do: 'open', ref: { kind: 'group', group: PLAN } })
    await opened.clock.advance(0)
    expect(opened.hermes.open.get().shown).toEqual({ kind: 'group', group: PLAN, over: 'sam' })
    expect(shownChat(opened.hermes.open.get())).toBeNull()
    expect(opened.hermes.sidebar.get().bot).toBe('sam')
    expect(opened.sent().filter(call => call.method === 'session.list'), 'no list of another bot\'s chats').toHaveLength(lists)
  })

  it('renames a group in its row and its top bar, lists it first, and keeps its thread', async () => {
    const opened = await shown(withGroups({ rooms: [STANDUP, { ...ROOM, log: [{ user: 'Ship it?' }, { member: 'sam', text: 'Yes.' }] }] }))
    expect(opened.hermes.groups.get()).toMatchObject({ rows: [{ id: 'standup' }, { id: PLAN }] })
    expect(await opened.hermes.run({ do: 'renameGroup', group: PLAN, name: 'Ship plan' })).toEqual({ ok: true, value: undefined })
    expect(opened.hermes.groups.get(), 'before the answer to the command').toMatchObject({ rows: [{ id: PLAN, name: 'Ship plan' }, { id: 'standup', name: 'Standup' }] })
    expect(readOf(opened.chat())?.name).toBe('Ship plan')
    await opened.clock.advance(0)
    expect(thread(opened.chat())).toEqual([['said', 'Ship it?'], ['sam', 'Yes.']])
    expect(opened.calls('groups.rename').map(call => call.params)).toEqual([{ room_id: PLAN, event_id: expect.any(String), name: 'Ship plan' }])
    const other = opened.client()
    await opened.clock.advance(0)
    expect(other.groups.get(), 'another window reads the new name from Hermes').toMatchObject({ rows: [{ id: PLAN, name: 'Ship plan' }, { id: 'standup' }] })
  })

  it('deletes a group: it leaves the list, the pane moves to the bot it was opened over, and a second delete is no error', async () => {
    const opened = await shown(withGroups({ rooms: [ROOM, STANDUP], turns: { default: [{ hold: true }] } }))
    await opened.say('Ship it?')
    await opened.clock.advance(0)
    expect(who(opened.chat())).toEqual([['default', 'thinking']])
    expect(await opened.hermes.run({ do: 'deleteGroup', group: PLAN })).toEqual({ ok: true, value: undefined })
    expect(opened.hermes.groups.get()).toMatchObject({ rows: [{ id: 'standup' }] })
    expect(opened.hermes.open.get().shown).toMatchObject({ kind: 'bot', bot: 'default' })
    expect(opened.hermes.groupChat.get()).toBeNull()
    const asks = () => opened.sent().filter(call => (call.method === 'groups.state' || call.method === 'groups.log') && call.params?.room_id === PLAN).length
    const before = asks()
    await opened.clock.advance(60_000)
    expect(opened.hermes.groups.get(), 'Hermes lists it no more').toMatchObject({ rows: [{ id: 'standup' }] })
    expect(asks(), 'and nothing asks about it').toBe(before)
    expect(await opened.hermes.run({ do: 'deleteGroup', group: PLAN })).toEqual({ ok: true, value: undefined })
    expect(opened.calls('groups.disband').map(call => call.params)).toEqual([{ room_id: PLAN }, { room_id: PLAN }])
  })

  it('leaves the pane alone when the deleted group is not the one shown', async () => {
    const opened = await shown(room({ rooms: [ROOM, STANDUP] }))
    expect(await opened.hermes.run({ do: 'deleteGroup', group: 'standup' as GroupId })).toEqual({ ok: true, value: undefined })
    expect(opened.hermes.open.get().shown).toEqual({ kind: 'group', group: PLAN, over: 'default' })
    expect(opened.hermes.groups.get()).toMatchObject({ rows: [{ id: PLAN }] })
  })

  it('refuses to rename a group another window deleted, says so, and takes it out of the list', async () => {
    const opened = await shown(room({ rooms: [ROOM, STANDUP] }))
    const other = opened.client()
    await opened.clock.advance(0)
    expect(await other.run({ do: 'deleteGroup', group: 'standup' as GroupId })).toEqual({ ok: true, value: undefined })
    expect(await opened.hermes.run({ do: 'renameGroup', group: 'standup' as GroupId, name: 'Daily' })).toEqual({ ok: false, refusal: { kind: 'stale', message: 'Hermes no longer has this group chat.' } })
    await opened.clock.advance(0)
    expect(opened.hermes.groups.get()).toMatchObject({ rows: [{ id: PLAN }] })
  })

  it('says a group Hermes does not have is missing, and refuses a message to it', async () => {
    const opened = open(room())
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'open', ref: { kind: 'group', group: 'disbanded' as GroupId } })
    await opened.clock.advance(0)
    expect(opened.hermes.groupChat.get()).toEqual({ group: 'disbanded', at: 'missing' })
    expect(await opened.hermes.run({ do: 'sendToGroup', group: 'disbanded' as GroupId, text: 'Anyone?' })).toEqual({ ok: false, refusal: { kind: 'stale', message: 'Hermes no longer has this group chat.' } })
  })
})

describe('reading messages to search', () => {
  const RESEARCH = 'research' as BotId
  const SEEDED = WITH_CHATS.header.chats ?? {}
  const more = Array.from({ length: 4 }, (_, at) => ({
    id: `local-03${at}`, title: `Older chat ${at}`, last_active: 1795000000 - at, rows: [{ role: 'user' as const, text: `Note ${at} about the quarterly audit.` }, { role: 'assistant' as const, text: 'Noted.' }]
  }))
  const MANY: Fixture = { ...WITH_CHATS, header: { ...WITH_CHATS.header, chats: { ...SEEDED, research: [...(SEEDED.research ?? []), ...more] } } }
  const read = async (fixture: Fixture, step: number) => {
    const opened = open(fixture)
    await opened.clock.advance(0)
    const outcome = await opened.hermes.run({ do: 'readMessages', step })
    return { opened, read: outcome.ok ? outcome.value : null }
  }

  it('reads the newest chats of every bot, each message landing on the message that opens its turn', async () => {
    const { opened, read: found } = await read(WITH_CHATS, 0)
    expect(found?.messages).toContainEqual({ sessionId: INVOICES, bot: RESEARCH, chat: 'Sort the invoices', rowId: 1, landing: 1, text: 'Sort the invoices in the inbox folder by due date.', at: 1795249000000 })
    expect(found?.messages).toContainEqual(expect.objectContaining({ sessionId: INVOICES, rowId: 2, landing: 1, text: 'Sorted fourteen invoices by due date; the oldest is due Friday.' }))
    expect(found?.messages, 'a Bot Chat is read too, and a reply before any message lands nowhere').toContainEqual(expect.objectContaining({ sessionId: 'local-0000', bot: 'dr-eggbot', landing: null }))
    expect(found?.reach).toBe('all')
    expect(found?.unread).toBe(0)
    const transcripts = opened.sent().filter(call => call.method === 'session.transcript' && call.params?.profile === 'research')
    expect(transcripts.map(call => call.params?.session_id).sort()).toEqual([REMINDER, INVOICES, DOWNLOADS].sort())
    expect(opened.sent().filter(call => call.method === 'session.resume'), 'reading attaches no chat').toEqual([])
  })

  it('reads five chats of each bot a step, and says when no bot has more', async () => {
    const first = await read(MANY, 0)
    expect(first.read?.reach).toBe('more')
    expect(first.read?.messages.some(message => message.text.includes('quarterly audit') && message.chat === 'Older chat 1')).toBe(true)
    expect(first.read?.messages.some(message => message.chat === 'Older chat 2')).toBe(false)
    const second = await read(MANY, 1)
    expect(second.read?.reach).toBe('all')
    expect([...new Set(second.read?.messages.map(message => message.chat))]).toEqual(['Older chat 2', 'Older chat 3'])
  })

  it('reads only its own profile on a socket that reaches no other bot', async () => {
    const { opened, read: found } = await read(BOUND, 0)
    expect(found).toEqual({ messages: [], reach: 'all', unread: 0 })
    const lists = opened.sent().filter(call => call.method === 'session.list' && call.params?.scope === 'stored')
    expect(lists.length).toBeGreaterThan(0)
    expect(lists.every(call => call.params?.profile === undefined)).toBe(true)
  })
})

describe('reading messages before the bots are listed', () => {
  it('waits for the list of bots on a socket that reaches them all, so no bot is left out', async () => {
    const opened = open(WITH_CHATS, { latencyMs: 100 })
    for (let waited = 0; waited < 1000 && !opened.sent().some(call => call.method === 'profiles.list'); waited += 10) await opened.clock.advance(10)
    const read = opened.hermes.run({ do: 'readMessages', step: 0 })
    await opened.clock.advance(1000)
    expect(await read).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'Highwing is still listing your bots.' } })
  })
})
