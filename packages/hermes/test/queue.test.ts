import { describe, expect, it } from 'vitest'
import { offeredBy, sendPlan, type Admission } from '../src/domain/queue'
import { emptyTracked, reduce, type SessionEvent, type SessionInput, type Snapshot, type Tracked } from '../src/domain/reduce'
import type { AdmissionId, Attachment, AttachmentId, BusyMode, Generation, InputId, PromptId, QueuedState, RequestId, Run, SessionId, TurnId } from '../src/domain/session'
import { parseBusy, parseCorrection, parseEvent, parseRows } from '../src/wire/parse'

const EPOCH = 'e1'
const QUEUED: QueuedState = { s: 'queued', can: ['sendNow', 'edit'] }

const row = (admissionId: string, inputId: string, text: string, state: Admission['state'] = QUEUED): Admission =>
  ({ admissionId: admissionId as AdmissionId, inputId: inputId as InputId, text, state })

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    id: 's1' as SessionId, title: '', cwd: null, model: null, tuning: { effort: null, fast: null, yolo: null }, running: false, generation: 1 as Generation, revision: 1, subscriptionId: 'sub-1',
    watermark: { epoch: EPOCH, seq: 0 }, queue: [], prompts: [], history: { turns: [], unfinished: null, older: null }, openRequests: [], plan: null, ...over
  }
}

const live = (over: Partial<Snapshot> = {}): Tracked =>
  [{ in: 'attach' } as const, { in: 'attached', attempt: 1, snapshot: snapshot(over), replay: null } as const].reduce<Tracked>(reduce, emptyTracked('s1' as SessionId))

let seq = 0
const event = (sessionEvent: SessionEvent, generation: number | null = 1): SessionInput =>
  ({ in: 'event', frame: { stamp: { epoch: EPOCH, seq: ++seq, generation: generation as Generation | null }, event: sessionEvent, seenAt: null } })
const list = (...queue: Admission[]): SessionInput => event({ type: 'meta', queue }, null)
const SHOT: Attachment = { id: 'f1' as AttachmentId, name: 'error.png', kind: 'image', size: 127 }
const send = (inputId: string, text: string, attachments: readonly Attachment[] = []): SessionInput =>
  ({ in: 'local', action: { did: 'send', inputId: inputId as InputId, text, attachments } })
const started = (admissionId: string | null): SessionEvent => ({ type: 'turn.started', turnId: null, admissionId, requestText: null })
const feed = (state: Tracked, ...inputs: SessionInput[]) => inputs.reduce(reduce, state)
const openTurn = (state: Tracked) => (state.content.run.state === 'running' ? state.content.run.turn : null)

describe('Hermes\'s queue', () => {
  it('is whatever the latest pending list says, and a list that changes nothing keeps the content', () => {
    const first = feed(live(), list(row('a1', 'i1', 'one'), row('a2', 'i2', 'two')))
    expect(first.content.queue.map(message => message.text)).toEqual(['one', 'two'])

    const again = feed(first, list(row('a1', 'i1', 'one'), row('a2', 'i2', 'two')))
    expect(again.content).toBe(first.content)

    const cancelled = feed(again, list(row('a2', 'i2', 'two')))
    expect(cancelled.content.queue).toEqual([{ admissionId: 'a2', inputId: 'i2', text: 'two', from: 'elsewhere', attachments: [], state: QUEUED }])
    expect(cancelled.content.queue[0], 'the row that did not change is the same object').toBe(first.content.queue[1])
    expect(feed(cancelled, list()).content.queue).toEqual([])
  })

  it('holds another client\'s row, which this client never sent', () => {
    const state = feed(live(), send('i1', 'mine'), list(row('a1', 'i1', 'mine'), row('a2', 'other-input', 'theirs', { s: 'queued', can: [] })))
    expect(state.content.queue).toEqual([
      { admissionId: 'a1', inputId: 'i1', text: 'mine', from: 'here', attachments: [], state: QUEUED },
      { admissionId: 'a2', inputId: 'other-input', text: 'theirs', from: 'elsewhere', attachments: [], state: { s: 'queued', can: [] } }
    ])
  })

  it('takes a message out of the outbox when a list names it, and keeps the row this client\'s for as long as it is listed', () => {
    const sent = feed(live(), send('i1', 'mine'), send('i2', 'not listed yet'))
    const listed = feed(sent, list(row('a1', 'i1', 'mine')))
    expect(listed.content.outbox).toEqual([{ inputId: 'i2', text: 'not listed yet', attachments: [], state: { s: 'sending' } }])
    expect(feed(listed, list(row('a1', 'i1', 'mine', { s: 'queued', can: [] }))).content.queue).toMatchObject([{ from: 'here', state: { s: 'queued', can: [] } }])
  })

  it('takes out a message whose list names another input id, by the admission its receipt gave', () => {
    const state = feed(
      live(),
      send('minted', 'mine'),
      { in: 'local', action: { did: 'send.admitted', inputId: 'minted' as InputId, admissionId: 'a1' } },
      list(row('a1', 'recorded', 'mine'))
    )
    expect(state.content.outbox).toEqual([])
    expect(state.content.queue).toMatchObject([{ inputId: 'recorded', from: 'here' }])
    expect(state.fence.sent).toEqual({})
  })

  it('keeps a message that failed and is not listed', () => {
    const failed = feed(live(), send('i1', 'mine'), { in: 'local', action: { did: 'send.failed', inputId: 'i1' as InputId, message: 'no' } }, list(row('a2', 'i2', 'theirs')))
    expect(failed.content.outbox).toEqual([{ inputId: 'i1', text: 'mine', attachments: [], state: { s: 'failed', message: 'no' } }])
  })

  it('starts a turn with the row its start names, whoever sent it', () => {
    const running = feed(live(), list(row('a1', 'i1', 'one'), row('a2', 'i2', 'two')), list(row('a1', 'i1', 'one', { s: 'started' }), row('a2', 'i2', 'two')), event(started('a1')))
    expect(openTurn(running)?.request).toEqual({ text: 'one', inputId: 'i1', rowId: null, attachments: [] })
    expect(running.content.queue.map(message => message.text)).toEqual(['two'])
  })

  it('takes the row a turn starts with out of the queue at once, before the list that says it started', () => {
    const running = feed(live(), list(row('a1', 'i1', 'one'), row('a2', 'i2', 'two')), event(started('a1')))
    expect(running.content.queue.map(message => message.text)).toEqual(['two'])
    expect(openTurn(running)?.request).toEqual({ text: 'one', inputId: 'i1', rowId: null, attachments: [] })
  })

  it('never takes a row on its way into the turn for the turn\'s request', () => {
    const steering = row('a2', 'i2', 'also check the tests', { s: 'steering' })
    const attachedMidTurn = live({ running: true, queue: [steering] })
    expect(openTurn(attachedMidTurn)?.request, 'a snapshot that lists only the row in transfer names no request').toBeNull()
    expect(attachedMidTurn.content.queue).toMatchObject([{ admissionId: 'a2', state: { s: 'steering' } }])

    const running = feed(live(), event({ type: 'turn.started', turnId: null, admissionId: null, requestText: null }), list(row('a2', 'i2', 'also check the tests')))
    const handed = feed(running, list(steering))
    expect(openTurn(handed)?.request).toBeNull()
    expect(handed.content.queue).toMatchObject([{ state: { s: 'steering' } }])
  })

  it('puts the words of a row handed to the turn into the turn once, and none for a row a snapshot lists', () => {
    const steering = row('a2', 'i2', 'also check the tests', { s: 'steering' })
    const running = feed(live(), event(started(null)), list(row('a2', 'i2', 'also check the tests')))
    const handed = feed(running, list(steering), list(steering))
    expect(openTurn(handed)?.items).toEqual([{ kind: 'steer', text: 'also check the tests' }])
    expect(openTurn(live({ running: true, queue: [steering] }))?.items, 'stored rows are what tell a rebuild').toEqual([])

    const back = feed(handed, list(row('a2', 'i2', 'also check the tests')))
    expect(back.content.queue, 'a row the turn never read is queued again').toMatchObject([{ state: QUEUED }])
  })

  it('carries this client\'s attachments from its outbox entry onto the row Hermes lists, then onto the request its turn starts with', () => {
    const queued = feed(live(), send('i1', 'what is this', [SHOT]), list(row('a1', 'i1', 'what is this', { s: 'queued', can: [] })))
    expect(queued.content.outbox).toEqual([])
    expect(queued.content.queue).toMatchObject([{ admissionId: 'a1', from: 'here', attachments: [SHOT] }])
    expect(feed(queued, list(row('a1', 'i1', 'what is this', { s: 'queued', can: [] }))).content, 'a list that changes nothing keeps them').toBe(queued.content)

    const running = feed(queued, event(started('a1')))
    expect(openTurn(running)?.request).toEqual({ text: 'what is this', inputId: 'i1', rowId: null, attachments: [SHOT] })
    expect(running.content.queue).toEqual([])
  })

  it('carries them by the admission a receipt gave when Hermes lists the message under another input id', () => {
    const admitted: SessionInput = { in: 'local', action: { did: 'send.admitted', inputId: 'minted' as InputId, admissionId: 'a1' } }
    const queued = feed(live(), send('minted', 'what is this', [SHOT]), admitted, list(row('a1', 'recorded', 'what is this')))
    expect(queued.content.queue).toMatchObject([{ inputId: 'recorded', attachments: [SHOT] }])
    expect(openTurn(feed(queued, event(started('a1'))))?.request?.attachments).toEqual([SHOT])
  })

  it('gives the request the outbox entry\'s attachments when a list first names the message as started', () => {
    const running = feed(live(), send('i1', 'what is this', [SHOT]), event(started(null)), list(row('a1', 'i1', 'what is this', { s: 'started' })))
    expect(openTurn(running)?.request).toEqual({ text: 'what is this', inputId: 'i1', rowId: null, attachments: [SHOT] })
  })

  it('names no attachments for another client\'s row, since Hermes\'s list does not say', () => {
    const state = feed(live(), send('i1', 'mine', [SHOT]), list(row('a2', 'theirs-input', 'theirs')), event(started('a2')))
    expect(openTurn(state)?.request).toEqual({ text: 'theirs', inputId: 'theirs-input', rowId: null, attachments: [] })
    expect(state.content.outbox).toMatchObject([{ inputId: 'i1', attachments: [SHOT] }])
  })

  it('holds a lost row with the generation its release needs', () => {
    const state = live({ queue: [row('a1', 'i1', 'ran when Hermes restarted', { s: 'lost', generation: 7 as Generation }), row('a2', 'i2', 'waits behind it')] })
    expect(state.content.queue.map(message => message.state)).toEqual([{ s: 'lost', generation: 7 }, QUEUED])
    expect(state.content.run, 'a lost row is not a running turn').toEqual({ state: 'idle' })
  })

  it('offers by state: a queued row what Hermes allows and always cancel, a row in transfer nothing, a lost row only its release', () => {
    expect(offeredBy(QUEUED)).toEqual(['cancel', 'sendNow', 'edit'])
    expect(offeredBy({ s: 'queued', can: [] })).toEqual(['cancel'])
    expect(offeredBy({ s: 'steering' })).toEqual([])
    expect(offeredBy({ s: 'lost', generation: 7 as Generation })).toEqual(['release'])
  })

  it('files words Hermes handed to the running turn, and not once that turn is over', () => {
    const running = feed(live(), event(started(null)))
    const steered: SessionInput = { in: 'local', action: { did: 'steered', text: 'use trash-put', during: 1 as Generation } }
    expect(openTurn(feed(running, steered))?.items).toEqual([{ kind: 'steer', text: 'use trash-put' }])
    const next = feed(running, event({ type: 'turn.ended', outcome: { kind: 'complete' }, finalText: null, rows: [], userRow: null, replyRow: null, usage: null }), event(started(null), 2))
    expect(feed(next, steered).content).toBe(next.content)
  })
})

describe('sendPlan', () => {
  const running = (stop: 'none' | 'requested' = 'none', items: Extract<Run, { state: 'running' }>['turn']['items'] = []): Run =>
    ({ state: 'running', generation: 4 as Generation, stop, turn: { id: 't1' as TurnId, request: null, began: null, items, announced: null } })
  const plan = (run: Run, busy: BusyMode | null, requests = 0, attachments: readonly Attachment[] = []) =>
    sendPlan({
      run, tuning: { reasoning: null, busy, effort: null, fast: null, yolo: null, approvals: null },
      requests: Array.from({ length: requests }, (_, index) => ({ id: `r${index}` as RequestId, ask: { kind: 'secret', for: { is: 'sudo', command: 'x' } }, state: { s: 'waiting', error: null }, deadline: null }))
    }, attachments)
  const asking = running('none', [{
    kind: 'prompt', id: 'p1' as PromptId, generation: 4 as Generation, ask: { kind: 'approval', command: 'rm', reason: null, choices: ['once', 'deny'] }, state: { s: 'waiting', error: null }, deadline: null
  }])

  it.each<[string, Run, BusyMode | null, number, ReturnType<typeof sendPlan>]>([
    ['no turn runs', { state: 'idle' }, 'steer', 0, { by: 'submit' }],
    ['the mode is unknown', running(), null, 0, { by: 'submit' }],
    ['the mode is queue', running(), 'queue', 0, { by: 'submit' }],
    ['the mode is steer', running(), 'steer', 0, { by: 'steer', during: 4 as Generation }],
    ['the mode is interrupt', running(), 'interrupt', 0, { by: 'redirect', during: 4 as Generation }],
    ['the turn is stopping', running('requested'), 'steer', 0, { by: 'submit' }],
    ['the turn waits on an approval', asking, 'interrupt', 0, { by: 'submit' }],
    ['Hermes waits on a request', running(), 'steer', 1, { by: 'submit' }]
  ])('when %s', (_, run, busy, requests, want) => {
    expect(plan(run, busy, requests)).toEqual(want)
  })

  it.each<BusyMode>(['steer', 'interrupt'])('queues a message with attachments whole in %s mode, since a steer or redirect carries only words', busy => {
    expect(plan(running(), busy, 0, [SHOT])).toEqual({ by: 'submit' })
  })
})

describe('stored rows', () => {
  it('reads words steered into a turn as an item of that turn, not as a new turn', () => {
    const { turns, unfinished } = parseRows([
      { role: 'user', text: 'Tidy the notes', row_id: 1 },
      { role: 'tool', name: 'terminal', args: { command: 'ls' }, tool_call_id: 'c1' },
      { role: 'user', text: 'also check the tests', display_kind: 'steer', row_id: 3 },
      { role: 'assistant', text: 'Both done.', row_id: 4 },
      { role: 'user', text: 'Thanks', row_id: 5 },
      { role: 'assistant', text: 'Any time.', row_id: 6 }
    ])
    expect(unfinished).toBeNull()
    expect(turns.map(turn => [turn.request?.text, turn.rows])).toEqual([['Tidy the notes', [1, 3, 4]], ['Thanks', [5, 6]]])
    expect(turns[0]?.items.map(item => item.kind)).toEqual(['tool', 'steer', 'text'])
    expect(turns[0]?.items[1]).toEqual({ kind: 'steer', text: 'also check the tests' })
  })
})

describe('a pending row off the wire', () => {
  const pending = (rows: readonly Record<string, unknown>[]) => {
    const parsed = parseEvent({ type: 'session.info', session_id: 's1', replay_epoch: EPOCH, seq: 1, payload: { pending: rows } })
    return parsed.scope === 'session' && parsed.event?.type === 'meta' ? parsed.event.queue : undefined
  }
  const wire = (more: Record<string, unknown>) => ({ admission_id: 'a1', input_id: 'i1', text: 'hello', status: 'queued', outcome: null, execution_generation: null, ...more })

  it('reads what a queued row allows from its controls, and nothing on a Hermes that lists none', () => {
    expect(pending([wire({ controls: ['steer', 'replace'] }), wire({ admission_id: 'a2', controls: ['replace', 'reorder'] }), wire({ admission_id: 'a3' })])?.map(row => row.state)).toEqual([
      { s: 'queued', can: ['sendNow', 'edit'] }, { s: 'queued', can: ['edit'] }, { s: 'queued', can: [] }
    ])
  })

  it('reads a started row with `steering` as in transfer, and an unknown row as lost with its own generation', () => {
    expect(pending([
      wire({ status: 'started', execution_generation: 3 }),
      wire({ admission_id: 'a2', status: 'started', steering: true, execution_generation: 3 }),
      wire({ admission_id: 'a3', status: 'unknown', execution_generation: 2 })
    ])?.map(row => row.state)).toEqual([{ s: 'started' }, { s: 'steering' }, { s: 'lost', generation: 2 }])
  })

  it('cannot use a list with a lost row that names no generation', () => {
    expect(pending([wire({ status: 'unknown' })])).toBeUndefined()
  })
})

describe('what Hermes answers', () => {
  it('names the busy mode, and anything else is unknown', () => {
    expect(['queue', 'steer', 'interrupt', 'later', 1].map(value => parseBusy({ value }))).toEqual(['queue', 'steer', 'interrupt', null, null])
  })

  it('says whether the turn took the words', () => {
    const ack = { text: 'x', execution_generation: 1, authority_epoch: 1 }
    expect(parseCorrection({ ...ack, status: 'queued' })).toBe('taken')
    expect(parseCorrection({ ...ack, status: 'redirected' })).toBe('taken')
    expect(parseCorrection({ ...ack, status: 'rejected', delivered: false })).toBe('unread')
    expect(parseCorrection({ ...ack, status: 'rejected' })).toBe('unsure')
    expect(parseCorrection({ voice_stopped: true })).toBe('unread')
  })
})
