import { describe, expect, it } from 'vitest'
import { SessionActor } from '../src/actor'
import type { Admission } from '../src/domain/queue'
import type { SessionEvent } from '../src/domain/reduce'
import type { AdmissionId, BusyMode, Generation, InputId, Link, PromptId, QueuedAction, Session, SessionId } from '../src/domain/session'
import { runSessionCommand, type Hub, type SessionCommand } from '../src/session-commands'
import { manualClock, settle } from '../src/testing/clock'
import { Offline, RpcRefusal, type Calls } from '../src/wire/link'

const ID = 's1' as SessionId
const EPOCH = 'e1'
const ADMISSION = 'a1' as AdmissionId

interface Call { readonly method: string; readonly params: Record<string, unknown>; resolve(result: unknown): void; reject(error: Error): void }

const refusal = (reason: string) => new RpcRefusal(4001, reason, reason, null)
const row = (state: Admission['state'], admissionId = ADMISSION): Admission => ({ admissionId, inputId: `in-${admissionId}` as InputId, text: 'tidy the notes', state })
const started: SessionEvent = { type: 'turn.started', turnId: null, admissionId: null, requestText: null }
const asked: SessionEvent = { type: 'prompt.opened', id: 'p1' as PromptId, generation: 1 as Generation, ask: { kind: 'approval', command: 'rm -rf x', reason: null, choices: ['once', 'deny'] }, timeoutS: null }
const ack = (status: string, more: Record<string, unknown> = {}) => ({ status, text: 'x', execution_generation: 1, authority_epoch: 1, ...more })
const SNAPSHOT = {
  session_id: ID, stored_session_id: ID, messages: [], display_messages: [], message_count: 0, running: false, authority_epoch: 1, replay_epoch: EPOCH,
  last_sequence: 0, subscription_id: 'sub-1', revision: 3, execution_generation: 0, pending: [], prompts: [], info: {}, open_requests: []
}

async function stage({ watched = false }: { readonly watched?: boolean } = {}) {
  const calls: Call[] = []
  const state: { link: Link } = { link: { state: 'online' } }
  let ids = 0
  let seq = 0
  const conn: Calls = {
    get link() { return state.link },
    clarifyBatch: false,
    call: (method: string, params: unknown) => new Promise<never>((resolve, reject) => {
      calls.push({ method, params: params as Record<string, unknown>, resolve: resolve as (result: unknown) => void, reject })
    }),
    respond: () => {}
  }
  const actor = new SessionActor(ID, { conn, clock: manualClock(), publish: () => {}, bridge: () => {}, mintId: () => `id-${++ids}`, watched: () => watched })
  const hub: Hub = {
    settledCatalog: async () => [], retitle: () => {}, drop: () => {}, refreshSoon: () => {},
    settledRelay: async () => {}, mentioned: () => [], relay: () => {}, branchPins: new Map(), branched: () => {},
    uploads: { read: async () => null }
  }
  const answer = async (method: string, result: unknown) => {
    const call = calls.find(held => held.method === method)
    if (call === undefined) throw new Error(`no ${method} call is waiting. Waiting: ${calls.map(held => held.method).join(', ') || 'none'}`)
    calls.splice(calls.indexOf(call), 1)
    if (result instanceof Error) call.reject(result)
    else call.resolve(result)
    await settle()
    return call
  }
  const event = (sessionEvent: SessionEvent, generation: number | null = 1) =>
    actor.feed({ in: 'event', frame: { stamp: { epoch: EPOCH, seq: ++seq, generation: generation as Generation | null }, event: sessionEvent, seenAt: null } })
  actor.attach()
  await answer('session.resume', SNAPSHOT)
  return {
    actor, calls, answer, event,
    /**
     * The socket drops with every call unanswered. Hermes then answers the attach on the next socket with `held`.
     * `replay: 'lost'` is a Hermes that no longer has the missed frames, so the chat is read again whole.
     */
    redial: async (held: Record<string, unknown> = {}, replay: 'kept' | 'lost' = 'kept') => {
      state.link = { state: 'waiting', attempt: 1, retryAt: 1_000, why: 'dropped', message: 'Reconnecting to Hermes.' }
      actor.linkChanged()
      for (const call of calls.splice(0)) call.reject(new Offline('socket closed'))
      state.link = { state: 'online' }
      actor.linkChanged()
      const lost = replay === 'lost'
      await answer('session.events.since', { events: [], latest_seq: seq, last_sequence: seq, epoch: EPOCH, replay_epoch: EPOCH, truncated: lost, snapshot_required: lost, count: 0 })
      await answer('session.resume', { ...SNAPSHOT, display_messages: undefined, messages_omitted: true, subscription_id: 'sub-2', last_sequence: seq, ...held })
      if (lost) await answer('session.resume', { ...SNAPSHOT, subscription_id: 'sub-2', last_sequence: seq, ...held })
    },
    command: (command: SessionCommand) => runSessionCommand(actor.port, command, hub),
    list: (...queue: Admission[]) => event({ type: 'meta', queue }, null),
    tune: (busy: BusyMode) => actor.port.act({ did: 'tuned', tuning: { busy } }),
    sent: () => calls.filter(call => call.method !== 'session.stats').map(call => [call.method, call.params] as const),
    items: () => (actor.session.run.state === 'running' ? actor.session.run.turn.items : [])
  }
}

const promptState = (session: Session) => (session.run.state === 'running' ? session.run.turn.items.find(item => item.kind === 'prompt')?.state : undefined)

describe('queued', () => {
  const act = (action: Exclude<QueuedAction, 'edit'>): SessionCommand => ({ do: 'queued', sessionId: ID, admissionId: ADMISSION, action })
  const edit: SessionCommand = { do: 'queued', sessionId: ID, admissionId: ADMISSION, action: 'edit', text: 'tidy the notes and the todo list' }
  const QUEUED = row({ s: 'queued', can: ['sendNow', 'edit'] })

  it.each([
    ['cancel', act('cancel'), 'prompt.cancel', { session_id: ID, admission_id: ADMISSION }],
    ['sendNow', act('sendNow'), 'prompt.steer_queued', { session_id: ID, admission_id: ADMISSION }]
  ] as const)('%s names the row, and leaves the queue to Hermes\'s next list', async (_, command, method, params) => {
    const { actor, command: run, list, sent, answer } = await stage()
    list(QUEUED)
    const done = run(command)
    expect(sent()).toEqual([[method, params]])
    await answer(method, { admission_id: ADMISSION, status: 'terminal' })
    expect(await done).toEqual({ ok: true, value: undefined })
    expect(actor.session.queue, 'only a list changes the queue').toHaveLength(1)
  })

  it('edit replaces the row with a new message, which waits in the outbox until Hermes lists it', async () => {
    const { actor, command, list, sent, answer } = await stage()
    list(QUEUED)
    const done = command(edit)
    expect(sent()).toEqual([['prompt.replace_queued', { session_id: ID, admission_id: ADMISSION, submission_id: 'id-1', text: 'tidy the notes and the todo list' }]])
    expect(actor.session.outbox).toEqual([{ inputId: 'id-1', text: 'tidy the notes and the todo list', attachments: [], replaces: ADMISSION, state: { s: 'sending' } }])
    await answer('prompt.replace_queued', { admission_id: 'a2', status: 'queued' })
    expect(await done).toEqual({ ok: true, value: undefined })
    list({ admissionId: 'a2' as AdmissionId, inputId: 'id-1' as InputId, text: 'tidy the notes and the todo list', state: QUEUED.state })
    expect(actor.session.outbox).toEqual([])
    expect(actor.session.queue).toMatchObject([{ admissionId: 'a2', from: 'here', text: 'tidy the notes and the todo list' }])
  })

  it('edit that Hermes refuses leaves the row as it was and nothing in the outbox', async () => {
    const { actor, command, list, answer } = await stage()
    list(QUEUED)
    const done = command(edit)
    await answer('prompt.replace_queued', refusal('admission_started'))
    expect(await done).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(actor.session.outbox).toEqual([])
    expect(actor.session.queue).toHaveLength(1)
  })

  describe('edit whose reply the socket lost', () => {
    const REPLACE = ['prompt.replace_queued', { session_id: ID, admission_id: ADMISSION, submission_id: 'id-1', text: 'tidy the notes and the todo list' }] as const
    const STILL_QUEUED = { pending: [{ admission_id: ADMISSION, input_id: `in-${ADMISSION}`, text: 'tidy the notes', status: 'queued', controls: ['steer', 'replace'] }] }
    const interrupted = async () => {
      const held = await stage()
      held.list(QUEUED)
      const done = held.command(edit)
      await held.redial(STILL_QUEUED)
      expect(await done).toMatchObject({ ok: false, refusal: { kind: 'offline' } })
      return held
    }

    it('is sent again as the same replacement of the same row, never as a new message', async () => {
      const { actor, list, sent, answer } = await interrupted()
      expect(sent(), 'a submit here would queue the edit beside the message it replaces').toEqual([REPLACE])
      await answer('prompt.replace_queued', { admission_id: 'a2', status: 'queued' })
      list({ admissionId: 'a2' as AdmissionId, inputId: 'id-1' as InputId, text: 'tidy the notes and the todo list', state: QUEUED.state })
      expect(actor.session.outbox).toEqual([])
      expect(actor.session.queue).toMatchObject([{ admissionId: 'a2', from: 'here', text: 'tidy the notes and the todo list' }])
    })

    it.each([
      ['the edit already ran, which no list will name', { admission_id: 'a2', status: 'terminal' }],
      ['the row started before the edit reached Hermes', refusal('admission_started')]
    ])('leaves the outbox when Hermes answers that %s', async (_, reply) => {
      const { actor, sent, answer } = await interrupted()
      await answer('prompt.replace_queued', reply)
      expect(actor.session.outbox).toEqual([])
      expect(sent()).toEqual([])
    })
  })

  it('release answers for a lost row with the generation that row ran as', async () => {
    const { command, list, sent, answer } = await stage()
    list(row({ s: 'lost', generation: 7 as Generation }))
    const done = command(act('release'))
    expect(sent()).toEqual([['prompt.resolve_unknown', { session_id: ID, admission_id: ADMISSION, execution_generation: 7 }]])
    await answer('prompt.resolve_unknown', { admission_id: ADMISSION, status: 'terminal' })
    expect(await done).toEqual({ ok: true, value: undefined })
  })

  it.each<[string, Admission['state'], SessionCommand]>([
    ['cancel of a row on its way into the turn', { s: 'steering' }, act('cancel')],
    ['send-now of a row on its way into the turn', { s: 'steering' }, act('sendNow')],
    ['send-now of a row Hermes offers none for', { s: 'queued', can: ['edit'] }, act('sendNow')],
    ['edit of a row Hermes offers none for', { s: 'queued', can: [] }, edit],
    ['release of a row that is not lost', { s: 'queued', can: ['sendNow', 'edit'] }, act('release')],
    ['cancel of a lost row', { s: 'lost', generation: 7 as Generation }, act('cancel')]
  ])('refuses %s, and sends nothing', async (_, state, command) => {
    const { actor, command: run, list, sent } = await stage()
    list(row(state))
    expect(await run(command)).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes doesn't offer that for this message." } })
    expect(sent()).toEqual([])
    expect(actor.session.outbox).toEqual([])
  })

  it('refuses a row that is no longer listed, and sends nothing', async () => {
    const { command, sent } = await stage()
    expect(await command(act('cancel'))).toMatchObject({ ok: false, refusal: { kind: 'stale' } })
    expect(sent()).toEqual([])
  })
})

describe('send while a turn runs', () => {
  const sending = async (busy: BusyMode) => {
    const held = await stage()
    held.event(started)
    held.tune(busy)
    return { ...held, done: held.command({ do: 'send', sessionId: ID, text: 'use the staging db' }) }
  }

  it('queues it as a new message while the busy mode is queue', async () => {
    const { sent } = await sending('queue')
    await settle()
    expect(sent()).toEqual([['prompt.submit', { session_id: ID, text: 'use the staging db', input_id: 'id-1' }]])
  })

  it.each([['steer', 'session.steer', 'queued'], ['interrupt', 'session.redirect', 'redirected']] as const)(
    'hands it to the turn in %s mode, and files it in the turn once Hermes took it', async (busy, method, status) => {
      const { actor, done, sent, answer, items } = await sending(busy)
      await settle()
      expect(sent()).toEqual([[method, { session_id: ID, text: 'use the staging db', execution_generation: 1 }]])
      expect(items()).toEqual([])
      await answer(method, ack(status))
      expect(await done).toEqual({ ok: true, value: null })
      expect(items()).toEqual([{ kind: 'steer', text: 'use the staging db' }])
      expect(actor.session.outbox).toEqual([])
    })

  it('submits it as the next message when no agent saw the steer', async () => {
    const { actor, done, sent, answer, items } = await sending('steer')
    await settle()
    await answer('session.steer', ack('rejected', { delivered: false }))
    expect(sent()).toEqual([['prompt.submit', { session_id: ID, text: 'use the staging db', input_id: 'id-1' }]])
    await answer('prompt.submit', { admission_id: 'a9', status: 'queued' })
    expect(await done).toEqual({ ok: true, value: null })
    expect(items()).toEqual([])
    expect(actor.session.outbox).toMatchObject([{ text: 'use the staging db', state: { s: 'sending' } }])
  })

  it('submits it when the turn it was meant for has ended', async () => {
    const { done, sent, answer } = await sending('steer')
    await settle()
    await answer('session.steer', refusal('stale_generation'))
    expect(sent().map(([method]) => method)).toEqual(['prompt.submit'])
    await answer('prompt.submit', { admission_id: 'a9', status: 'queued' })
    expect(await done).toEqual({ ok: true, value: null })
  })

  it('refuses, and never sends it again, when Hermes rejects a steer it may have read', async () => {
    const { actor, done, sent, answer, items } = await sending('steer')
    await settle()
    await answer('session.steer', ack('rejected'))
    expect(await done).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes didn't confirm it took that. It may have read it, so Highwing hasn't sent it again." } })
    expect(sent()).toEqual([])
    expect(items()).toEqual([])
    expect(actor.session.outbox).toEqual([])
  })

  it('answers Hermes\'s own refusal of a steer, and sends nothing more', async () => {
    const { done, sent, answer } = await sending('steer')
    await settle()
    await answer('session.steer', refusal('unsupported_control'))
    expect(await done).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(sent()).toEqual([])
  })
})

describe('deny and tell', () => {
  const deny = (tell = 'use trash-put instead'): SessionCommand => ({ do: 'answer', sessionId: ID, promptId: 'p1' as PromptId, reply: { kind: 'deny', tell } })
  const denying = async () => {
    const held = await stage()
    held.event(started)
    held.event(asked)
    return { ...held, done: held.command(deny()) }
  }
  const STEER = ['session.steer', { session_id: ID, text: 'use trash-put instead', execution_generation: 1 }] as const
  const DENY = ['approval.respond', { session_id: ID, execution_generation: 1, prompt_id: 'p1', choice: 'deny' }] as const

  it('steers the words into the held turn first, then denies', async () => {
    const { actor, done, sent, answer, items } = await denying()
    expect(sent()).toEqual([STEER])
    expect(promptState(actor.session)).toEqual({ s: 'sending', reply: { kind: 'deny', tell: 'use trash-put instead' } })
    await answer('session.steer', ack('queued'))
    expect(sent()).toEqual([DENY])
    await answer('approval.respond', { status: 'resolved', prompt_id: 'p1' })
    expect(await done).toEqual({ ok: true, value: 'turn' })
    expect(items().map(item => item.kind)).toEqual(['prompt', 'steer'])
    expect(promptState(actor.session)).toEqual({ s: 'answered', reply: { kind: 'deny', tell: 'use trash-put instead' } })
  })

  it('denies, then sends the words as the next message, when the turn could not take them', async () => {
    const { done, sent, answer, items } = await denying()
    await answer('session.steer', ack('rejected', { delivered: false }))
    expect(sent(), 'the denial goes before the message').toEqual([DENY])
    await answer('approval.respond', { status: 'resolved', prompt_id: 'p1' })
    expect(sent()).toEqual([['prompt.submit', { session_id: ID, text: 'use trash-put instead', input_id: 'id-1' }]])
    await answer('prompt.submit', { admission_id: 'a9', status: 'queued' })
    expect(await done).toEqual({ ok: true, value: 'next' })
    expect(items().map(item => item.kind)).toEqual(['prompt'])
  })

  it('denies and says it is unsure when Hermes rejects words it may have read', async () => {
    const { done, sent, answer } = await denying()
    await answer('session.steer', ack('rejected'))
    await answer('approval.respond', { status: 'resolved', prompt_id: 'p1' })
    expect(await done).toEqual({ ok: true, value: 'unsure' })
    expect(sent()).toEqual([])
  })

  it('puts the card back when the steer is refused, and denies nothing', async () => {
    const { actor, done, sent, answer } = await denying()
    await answer('session.steer', refusal('unsupported_control'))
    expect(await done).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(sent()).toEqual([])
    expect(promptState(actor.session)).toMatchObject({ s: 'waiting' })
  })

  describe('tried again after the socket dropped', () => {
    const STILL_ASKING = { running: true, execution_generation: 1, prompts: [{ kind: 'approval', prompt_id: 'p1', execution_generation: 1, command: 'rm -rf x', description: '', choices: ['once', 'deny'] }] }
    const steers = (items: ReturnType<Awaited<ReturnType<typeof stage>>['items']>) => items.filter(item => item.kind === 'steer')

    it.each([
      ['the turn took', ack('queued'), 'kept', 'turn'],
      ['the turn took, in a chat read again whole', ack('queued'), 'lost', 'turn'],
      ['Hermes may have read', ack('rejected'), 'kept', 'unsure']
    ] as const)('only denies, and never sends again the words %s', async (_, verdict, replay, told) => {
      const { actor, done, command, sent, answer, redial } = await denying()
      await answer('session.steer', verdict)
      await redial(STILL_ASKING, replay)
      expect(await done, 'the denial got no answer').toMatchObject({ ok: false, refusal: { kind: 'offline' } })
      expect(promptState(actor.session)).toMatchObject({ s: 'waiting' })
      const again = command(deny())
      await settle()
      expect(sent(), 'the words are not steered twice').toEqual([DENY])
      await answer('approval.respond', { status: 'resolved', prompt_id: 'p1' })
      expect(await again).toEqual({ ok: true, value: told })
    })

    it('only denies, and says it is unsure, when the socket dropped before Hermes said what it did with the words', async () => {
      const { done, command, sent, answer, redial, items } = await denying()
      await redial(STILL_ASKING)
      expect(await done).toMatchObject({ ok: false, refusal: { kind: 'offline' } })
      const again = command(deny())
      await settle()
      expect(sent()).toEqual([DENY])
      await answer('approval.respond', { status: 'resolved', prompt_id: 'p1' })
      expect(await again).toEqual({ ok: true, value: 'unsure' })
      expect(steers(items())).toEqual([])
    })

    it('steers again words that no agent saw, and words the first try did not carry', async () => {
      const unseen = await denying()
      await unseen.answer('session.steer', ack('rejected', { delivered: false }))
      await unseen.redial(STILL_ASKING)
      void unseen.command(deny())
      await settle()
      expect(unseen.sent()).toEqual([STEER])

      const reworded = await denying()
      await reworded.answer('session.steer', ack('queued'))
      await reworded.redial(STILL_ASKING)
      void reworded.command(deny('move it to the trash'))
      await settle()
      expect(reworded.sent()).toEqual([['session.steer', { session_id: ID, text: 'move it to the trash', execution_generation: 1 }]])
    })
  })

  it('refuses words for a clarify question and blank words, with no call', async () => {
    const held = await stage()
    held.event(started)
    held.event(asked)
    expect(await held.command({ do: 'answer', sessionId: ID, promptId: 'p1' as PromptId, reply: { kind: 'deny', tell: '  ' } })).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(held.sent()).toEqual([])
  })
})

describe('the busy mode', () => {
  it('is read with the reasoning switch once the chat is live and watched', async () => {
    const { actor, sent, answer } = await stage({ watched: true })
    expect(sent()).toEqual([['config.get', { session_id: ID, key: 'show_reasoning' }], ['config.get', { session_id: ID, key: 'busy' }]])
    await answer('config.get', { key: 'show_reasoning', value: '0', scope: 'session' })
    await answer('config.get', { key: 'busy', value: 'steer', scope: 'session' })
    expect(actor.session.tuning).toEqual({ reasoning: false, busy: 'steer' })
  })

  it('stays unknown on a Hermes that refuses the read, so a message sent during a turn queues', async () => {
    const { actor, answer, event, command, sent } = await stage({ watched: true })
    await answer('config.get', { key: 'show_reasoning', value: '1', scope: 'session' })
    await answer('config.get', refusal('invalid_params'))
    expect(actor.session.tuning).toEqual({ reasoning: true, busy: null })
    event(started)
    void command({ do: 'send', sessionId: ID, text: 'hello' })
    await settle()
    expect(sent().map(([method]) => method)).toEqual(['prompt.submit'])
  })

  it('is set for every client of the chat, and takes the value Hermes answers', async () => {
    const { actor, command, sent, answer } = await stage()
    const set = command({ do: 'tune', sessionId: ID, set: 'busy', to: 'interrupt' })
    expect(sent()).toEqual([['config.set', { session_id: ID, key: 'busy', value: 'interrupt' }]])
    await answer('config.set', { key: 'busy', value: 'interrupt', scope: 'session' })
    expect(await set).toEqual({ ok: true, value: undefined })
    expect(actor.session.tuning.busy).toBe('interrupt')
  })
})
