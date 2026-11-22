import { describe, expect, it } from 'vitest'
import { SessionActor } from '../src/actor'
import type { ServerRequest, SessionEvent } from '../src/domain/reduce'
import type { Generation, InputId, Link, PromptId, Session, SessionId } from '../src/domain/session'
import { manualClock, settle } from '../src/testing/clock'
import { Offline, RpcRefusal, type Connection } from '../src/wire/link'

const ID = 's1' as SessionId
const EPOCH = 'e1'

interface Call {
  readonly method: string
  readonly params: Record<string, unknown>
  resolve(result: unknown): void
  reject(error: Error): void
}

/** A resume reply as the gateway sends it. */
const snapshot = (more: Record<string, unknown> = {}) => ({
  session_id: ID, stored_session_id: ID, messages: [], display_messages: [], message_count: 0, running: false, authority_epoch: 1,
  replay_epoch: EPOCH, last_sequence: 0, subscription_id: 'sub-1', revision: 3, execution_generation: 0, pending: [], prompts: [], info: {}, open_requests: [],
  ...more
})
const reconnectSnapshot = (more: Record<string, unknown> = {}) => snapshot({ display_messages: undefined, messages_omitted: true, subscription_id: 'sub-2', ...more })
const replay = (more: Record<string, unknown> = {}) => ({ events: [], latest_seq: 0, last_sequence: 0, epoch: EPOCH, replay_epoch: EPOCH, truncated: false, snapshot_required: false, count: 0, ...more })
const approval = { kind: 'approval', prompt_id: 'p1', execution_generation: 1, command: 'rm -rf x', description: '', choices: ['once', 'deny'] }

function stage() {
  const clock = manualClock()
  const calls: Call[] = []
  const published: Session[] = []
  const refusedRequests: ServerRequest[] = []
  const state: { link: Link; ids: number } = { link: { state: 'online' }, ids: 0 }
  const conn: Connection = {
    get link() { return state.link },
    creation: null,
    call: (method: string, params: unknown) => new Promise<never>((resolve, reject) => {
      calls.push({ method, params: params as Record<string, unknown>, resolve: resolve as (result: unknown) => void, reject })
    }),
    decline: () => {},
    retryNow: () => {},
    close: () => {}
  }
  const actor = new SessionActor(ID, { conn, clock, publish: session => published.push(session), refuse: request => refusedRequests.push(request), mintId: () => `id-${++state.ids}` })
  let seq = 0
  const answer = async (method: string, result: unknown) => {
    const call = calls.find(held => held.method === method)
    if (call === undefined) throw new Error(`no ${method} call is waiting. Waiting: ${calls.map(held => held.method).join(', ') || 'none'}`)
    calls.splice(calls.indexOf(call), 1)
    if (result instanceof Error) call.reject(result)
    else call.resolve(result)
    await settle()
    return call
  }
  return {
    clock, calls, published, refusedRequests, actor, answer,
    sync: () => actor.session.sync,
    methods: () => calls.map(call => call.method),
    event: (event: SessionEvent | null, generation: number | null = 1) =>
      actor.feed({ in: 'event', frame: { stamp: { epoch: EPOCH, seq: ++seq, generation: generation as Generation | null }, event } }),
    seq: () => seq,
    link: (link: Link) => {
      state.link = link
      actor.linkChanged()
    },
    /** Open the session and bring it live with an empty snapshot. */
    open: async (more: Record<string, unknown> = {}) => {
      actor.attach()
      await answer('session.resume', snapshot(more))
    },
    dropAndRedial: () => {
      state.link = { state: 'waiting', attempt: 1, retryAt: 1_000, why: 'dropped', message: 'Reconnecting to Hermes.' }
      actor.linkChanged()
      for (const call of calls.splice(0)) call.reject(new Offline('socket closed'))
      state.link = { state: 'online' }
      actor.linkChanged()
    }
  }
}

const refusal = (reason: string, revision: number | null = null) => new RpcRefusal(4001, reason, reason, revision)
const started: SessionEvent = { type: 'turn.started', turnId: null, admissionId: null, requestText: null }
const asked: SessionEvent = { type: 'prompt.opened', id: 'p1' as PromptId, generation: 1 as Generation, ask: { kind: 'approval', command: 'rm -rf x', reason: null, choices: ['once', 'deny'] } }

describe('attach', () => {
  it('opens a session it has never seen with one resume that asks for history', async () => {
    const { actor, calls, sync, answer } = stage()
    expect(sync()).toEqual({ state: 'opening' })
    actor.attach()
    actor.attach()
    expect(calls.map(call => [call.method, call.params])).toEqual([['session.resume', { session_id: ID, display_projection: true }]])
    await answer('session.resume', snapshot())
    expect(sync()).toEqual({ state: 'live' })
  })

  it('does nothing while the link is not online', () => {
    const { actor, calls, link, sync } = stage()
    link({ state: 'connecting', attempt: 1 })
    actor.attach()
    expect(calls).toEqual([])
    expect(sync()).toEqual({ state: 'offline' })
  })

  it('writes events.since and resume back to back on a new socket, before either is answered', async () => {
    const { calls, open, event, dropAndRedial, sync, answer, actor } = stage()
    await open()
    event(started)
    event({ type: 'text.delta', text: 'Hel', at: null })
    dropAndRedial()
    expect(calls.map(call => [call.method, call.params]), 'both calls are on the socket in the same step').toEqual([
      ['session.events.since', { session_id: ID, last_seen: 2, replay_epoch: EPOCH }],
      ['session.resume', { session_id: ID, omit_messages: true, defer_history: true }]
    ])
    expect(sync()).toEqual({ state: 'catching-up' })

    const frame = { type: 'message.delta', session_id: ID, payload: { text: 'lo' }, replay_epoch: EPOCH, seq: 3, execution_generation: 1 }
    await answer('session.resume', reconnectSnapshot({ running: true, execution_generation: 1, last_sequence: 3 }))
    expect(sync(), 'the resume alone does not settle the attach').toEqual({ state: 'catching-up' })
    await answer('session.events.since', replay({ events: [frame], latest_seq: 3, last_sequence: 3, count: 1 }))
    expect(sync()).toEqual({ state: 'live' })
    expect(actor.session.run).toMatchObject({ state: 'running', turn: { items: [{ kind: 'text', markdown: 'Hello' }] } })
  })

  it('pays a second resume, with history, when replay answers snapshot_required', async () => {
    const { calls, open, event, dropAndRedial, sync, answer, methods } = stage()
    await open()
    event(started)
    dropAndRedial()
    await answer('session.events.since', replay({ snapshot_required: true, truncated: true }))
    await answer('session.resume', reconnectSnapshot({ last_sequence: 40 }))
    expect(sync()).toEqual({ state: 'rebuilding' })
    expect(methods()).toEqual(['session.resume'])
    expect(calls[0]?.params).toEqual({ session_id: ID, display_projection: true })
    await answer('session.resume', snapshot({ last_sequence: 40, subscription_id: 'sub-2' }))
    expect(sync()).toEqual({ state: 'live' })
  })

  it('says so when the gateway refuses the attach, and tries again when asked', async () => {
    const { actor, sync, answer, methods } = stage()
    actor.attach()
    await answer('session.resume', refusal('not_found'))
    expect(sync()).toEqual({ state: 'unavailable', message: 'Hermes no longer has this chat.' })
    actor.attach()
    expect(methods()).toEqual(['session.resume'])
  })

  it('stops a session that restarts its attach a fourth time inside 60 s, and lets a retry through later', async () => {
    const { actor, clock, open, sync, answer, methods } = stage()
    await open()
    for (let restart = 1; restart <= 3; restart++) {
      await clock.advance(1_000)
      actor.feed({ in: 'gap' })
      expect(sync(), `restart ${restart}`).toEqual({ state: 'rebuilding' })
      await answer('session.resume', snapshot())
      expect(sync()).toEqual({ state: 'live' })
    }
    actor.feed({ in: 'gap' })
    expect(sync()).toEqual({ state: 'unavailable', message: 'Hermes keeps restarting this chat.' })
    expect(methods(), 'no call for the fourth restart').toEqual([])

    await clock.advance(60_000)
    actor.attach()
    await answer('session.resume', snapshot())
    expect(sync()).toEqual({ state: 'live' })
  })

  it('refuses every request the snapshot lists as still open, once the gate is live', async () => {
    const { open, refusedRequests } = stage()
    await open({ open_requests: [{ id: 'srq-1', method: 'sudo', params: { session_id: ID, command: 'sudo ls' } }] })
    expect(refusedRequests).toEqual([{ requestId: 'srq-1', method: 'sudo', sessionId: ID }])
  })

  it('detaches with the subscription the attach gave it', async () => {
    const { actor, open, calls } = stage()
    await open()
    void actor.detach()
    expect(calls.map(call => [call.method, call.params])).toEqual([['session.detach', { session_id: ID, subscription_id: 'sub-1' }]])
  })
})

describe('send', () => {
  it('shows the message as sending, then as the gateway admitted it', async () => {
    const { actor, open, calls, answer } = stage()
    await open()
    const sent = actor.send('hello')
    expect(actor.session.outbox).toEqual([{ inputId: 'id-1', text: 'hello', state: { s: 'sending' } }])
    expect(calls[0]).toMatchObject({ method: 'prompt.submit', params: { session_id: ID, text: 'hello', input_id: 'id-1' } })
    await answer('prompt.submit', { admission_id: 'a1', status: 'queued' })
    expect(await sent).toEqual({ ok: true, value: undefined })
    expect(actor.session.outbox[0]?.state).toEqual({ s: 'queued' })
  })

  it('refuses while the session is not live, and files nothing', async () => {
    const { actor } = stage()
    expect(await actor.send('hello')).toMatchObject({ ok: false, refusal: { kind: 'offline' } })
    expect(actor.session.outbox).toEqual([])
  })

  it('marks the message failed with the gateway\'s reason in plain words', async () => {
    const { actor, open, answer } = stage()
    await open()
    const sent = actor.send('hello')
    await answer('prompt.submit', refusal('session_busy'))
    expect(await sent).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'Hermes is busy with this chat. Try again in a moment.' } })
    expect(actor.session.outbox[0]?.state).toEqual({ s: 'failed', message: 'Hermes is busy with this chat. Try again in a moment.' })
    expect(actor.discard('id-1' as InputId)).toEqual({ ok: true, value: undefined })
    expect(actor.session.outbox).toEqual([])
  })

  it('sends a message again with its original id when the socket dropped before the receipt', async () => {
    const { actor, open, dropAndRedial, answer, calls } = stage()
    await open()
    const sent = actor.send('hello')
    dropAndRedial()
    expect(await sent, 'the message is kept, not refused').toEqual({ ok: true, value: undefined })
    expect(actor.session.outbox[0]?.state).toEqual({ s: 'sending' })
    await answer('session.events.since', replay())
    await answer('session.resume', reconnectSnapshot())
    expect(calls.map(call => [call.method, call.params])).toEqual([['prompt.submit', { session_id: ID, text: 'hello', input_id: 'id-1' }]])
    await answer('prompt.submit', { admission_id: 'a1', status: 'queued' })
    expect(actor.session.outbox).toEqual([{ inputId: 'id-1', text: 'hello', state: { s: 'queued' } }])
  })
})

describe('answer and stop', () => {
  const asking = async () => {
    const held = stage()
    await held.open()
    held.event(started)
    held.event(asked)
    return held
  }
  const promptState = (session: Session) => (session.run.state === 'running' ? session.run.turn.items.find(item => item.kind === 'prompt')?.state : undefined)

  it('answers with the generation the prompt carries', async () => {
    const { actor, calls, answer } = await asking()
    const answered = actor.answer('p1' as PromptId, { kind: 'choice', value: 'once' })
    expect(calls[0]).toMatchObject({ method: 'approval.respond', params: { session_id: ID, execution_generation: 1, prompt_id: 'p1', choice: 'once' } })
    expect(promptState(actor.session)).toEqual({ s: 'sending', reply: { kind: 'choice', value: 'once' } })
    await answer('approval.respond', { status: 'resolved', prompt_id: 'p1' })
    expect(await answered).toEqual({ ok: true, value: undefined })
    expect(promptState(actor.session)).toEqual({ s: 'answered', reply: { kind: 'choice', value: 'once' } })
  })

  it('reads already_resolved as answered from somewhere else', async () => {
    const { actor, answer } = await asking()
    void actor.answer('p1' as PromptId, { kind: 'choice', value: 'once' })
    await answer('approval.respond', { status: 'already_resolved', prompt_id: 'p1' })
    expect(promptState(actor.session)).toEqual({ s: 'answered', reply: null })
  })

  it('puts the card back with the reason when the gateway refuses, or the socket drops first', async () => {
    const refusedOnce = await asking()
    const first = refusedOnce.actor.answer('p1' as PromptId, { kind: 'choice', value: 'once' })
    await refusedOnce.answer('approval.respond', refusal('stale_generation'))
    expect(await first).toMatchObject({ ok: false, refusal: { kind: 'stale' } })
    expect(promptState(refusedOnce.actor.session)).toEqual({ s: 'waiting', error: 'That turn has already ended.' })

    const dropped = await asking()
    const second = dropped.actor.answer('p1' as PromptId, { kind: 'choice', value: 'once' })
    dropped.dropAndRedial()
    expect(await second).toMatchObject({ ok: false, refusal: { kind: 'offline' } })
    await dropped.answer('session.events.since', replay({ latest_seq: 2, last_sequence: 2 }))
    await dropped.answer('session.resume', reconnectSnapshot({ running: true, execution_generation: 1, last_sequence: 2, prompts: [approval] }))
    expect(promptState(dropped.actor.session), 'answerable again').toEqual({ s: 'waiting', error: 'The connection dropped before Hermes confirmed your answer.' })
  })

  it('refuses an answer to a prompt that is not waiting', async () => {
    const { actor, calls } = await asking()
    expect(await actor.answer('other' as PromptId, { kind: 'choice', value: 'once' })).toMatchObject({ ok: false, refusal: { kind: 'stale' } })
    expect(calls).toEqual([])
  })

  it('stops the running generation, and takes stale_generation as already stopped', async () => {
    const { actor, calls, answer } = await asking()
    const stopped = actor.stop()
    expect(calls[0]).toMatchObject({ method: 'session.interrupt', params: { session_id: ID, execution_generation: 1 } })
    expect(actor.session.run).toMatchObject({ stop: 'requested' })
    await answer('session.interrupt', refusal('stale_generation'))
    expect(await stopped).toEqual({ ok: true, value: undefined })
  })
})

describe('mutate and loadEarlier', () => {
  it('renames with the revision it holds', async () => {
    const { actor, open, calls, answer } = stage()
    await open()
    const renamed = actor.mutate({ title: 'Notes' })
    expect(calls[0]).toMatchObject({ method: 'session.mutate', params: { session_id: ID, request_id: 'id-1', expected_revision: 3, operation: 'rename', payload: { title: 'Notes' } } })
    await answer('session.mutate', { session_id: ID, operation: 'rename', revision: 4, title: 'Notes' })
    expect(await renamed).toEqual({ ok: true, value: undefined })
  })

  it('retries a revision conflict once, with the same request id and the revision the refusal carries', async () => {
    const { actor, open, calls, answer } = stage()
    await open()
    const archived = actor.mutate({ archived: true })
    await answer('session.mutate', refusal('revision_conflict', 9))
    expect(calls[0]).toMatchObject({ params: { request_id: 'id-1', expected_revision: 9, operation: 'archive', payload: { archived: true } } })
    await answer('session.mutate', refusal('revision_conflict', 10))
    expect(await archived).toMatchObject({ ok: false, refusal: { kind: 'conflict' } })
    expect(calls).toEqual([])
  })

  it('reads earlier pages until one begins at a user row, and puts the turns above the ones it holds', async () => {
    const { actor, calls, answer } = stage()
    actor.attach()
    await answer('session.resume', snapshot({ messages: [{ archived_truncated: true }], display_messages: [{ role: 'user', text: 'third', row_id: 7 }, { role: 'assistant', text: 'ok', row_id: 8 }] }))
    expect(actor.session.earlier).toBe('more')

    const loaded = actor.loadEarlier()
    expect(actor.session.earlier).toBe('loading')
    expect(calls[0]).toMatchObject({ method: 'session.transcript', params: { session_id: ID, order: 'latest', limit: 200 } })
    await answer('session.transcript', { session_id: ID, rows: [{ role: 'assistant', text: 'second answer', row_id: 6 }], next_cursor: 'c1', reset: false })
    expect(calls[0]?.params).toMatchObject({ cursor: 'c1' })
    await answer('session.transcript', { session_id: ID, rows: [{ role: 'user', text: 'second', row_id: 5 }], next_cursor: null, reset: false })
    expect(await loaded).toEqual({ ok: true, value: undefined })
    expect(actor.session.history.map(turn => turn.request?.text)).toEqual(['second', 'third'])
    expect(actor.session.earlier).toBe('none')
  })

  it('goes back to "more" when the read fails', async () => {
    const { actor, answer } = stage()
    actor.attach()
    await answer('session.resume', snapshot({ messages: [{ archived_truncated: true }] }))
    const loaded = actor.loadEarlier()
    await answer('session.transcript', refusal('session_busy'))
    expect(await loaded).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(actor.session.earlier).toBe('more')
  })
})
