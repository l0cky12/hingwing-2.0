import { describe, expect, it } from 'vitest'
import type { Command } from '../src/domain/command'
import { activityOf, emptyTracked, reduce, sessionOf, type CardRequest, type LocalAction, type SessionEvent, type SessionInput, type Snapshot, type Tracked } from '../src/domain/reduce'
import { CLOSED_KEPT, UNDELIVERED, type CloseWhy } from '../src/domain/requests'
import type { Generation, HermesRequest, Item, PromptId, RecordedReply, RequestAsk, RequestEnd, RequestId, SessionId, TurnId } from '../src/domain/session'

const EPOCH = 'e1'
const SESSION = 's1' as SessionId
const SUDO_ASK: RequestAsk = { kind: 'secret', for: { is: 'sudo', command: 'sudo true' } }
const id = (text: string) => text as RequestId

const card = (requestId: string, ask: RequestAsk = SUDO_ASK, waitS: number | null = 120): CardRequest =>
  ({ kind: 'card', requestId: id(requestId), sessionId: SESSION, method: 'sudo', ask, waitS })
const asked = (requestId: string, seenAt = 1_000): SessionInput => ({ in: 'request', request: card(requestId), seenAt })
const event = (seq: number, sessionEvent: SessionEvent, generation: number | null = null): SessionInput =>
  ({ in: 'event', frame: { stamp: { epoch: EPOCH, seq, generation: generation as Generation | null }, event: sessionEvent, seenAt: null } })
const cancelled = (seq: number, requestId: string, why: CloseWhy = 'resolved') => event(seq, { type: 'request.cancelled', id: id(requestId), why })
const started = (seq: number, generation = 1) => event(seq, { type: 'turn.started', turnId: `t${generation}` as TurnId, admissionId: null, requestText: 'Install it' }, generation)
const ended = (seq: number) => event(seq, { type: 'turn.ended', outcome: { kind: 'complete' }, finalText: null, rows: [], userRow: null, usage: null }, 1)
const answer = (requestId: string, kind: 'withheld' | 'skip' = 'withheld'): SessionInput => ({ in: 'local', action: { did: 'answer', requestId: id(requestId), reply: { kind } } })

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    id: SESSION, title: '', cwd: null, model: null, yolo: null, running: false, generation: 1 as Generation, revision: 1, subscriptionId: 'sub-1',
    watermark: { epoch: EPOCH, seq: 0 }, queue: [], prompts: [], history: { turns: [], unfinished: null, older: null }, openRequests: [], ...over
  }
}

const feed = (state: Tracked, ...inputs: SessionInput[]): Tracked => inputs.reduce(reduce, state)
const live = (...inputs: SessionInput[]) => feed(emptyTracked(SESSION), { in: 'attach' }, { in: 'attached', attempt: 1, snapshot: snapshot(), replay: null }, ...inputs)
const waiting = (requestId: string, deadline: number | null = 121_000, error: string | null = null): HermesRequest =>
  ({ id: id(requestId), ask: SUDO_ASK, state: { s: 'waiting', error }, deadline })
const closedNotice = (requestId: string, end: RequestEnd): Item => ({ kind: 'notice', what: 'closed', requestId: id(requestId), asked: 'sudo', end })

/** Drops the link, attaches again and lands the attach with `listed` as the snapshot's open requests. `during` arrive while it is in flight. */
function reattached(state: Tracked, listed: readonly CardRequest[], during: readonly SessionInput[] = [], watermark = 0): Tracked {
  const attaching = feed(state, { in: 'link.lost' }, { in: 'attach' }, ...during)
  if (attaching.gate.at !== 'attaching') throw new Error('expected an attach in flight')
  return reduce(attaching, {
    in: 'attached', attempt: attaching.gate.attempt,
    snapshot: snapshot({ history: null, openRequests: listed, subscriptionId: 'sub-2', watermark: { epoch: EPOCH, seq: watermark } }),
    replay: { snapshotRequired: false, epoch: EPOCH, events: [] }
  })
}

describe('a request off the live socket', () => {
  it('waits in the session with a deadline counted from when it arrived, and opens no turn', () => {
    const state = live(asked('r1'))
    expect(state.content.requests).toEqual([waiting('r1')])
    expect(state.content.run).toEqual({ state: 'idle' })
    expect(state.content.interlude).toEqual([])
  })

  it('has no deadline when Hermes does not say how long it waits', () => {
    const batch: RequestAsk = { kind: 'questions', questions: [{ id: 'q0', text: 'Which?', choices: ['a', 'b'], multi: false }], answers: {} }
    expect(live({ in: 'request', request: card('r1', batch, null), seenAt: 1_000 }).content.requests[0]?.deadline).toBeNull()
  })

  it('is held once however often its frame arrives', () => {
    const once = live(asked('r1'))
    expect(reduce(once, asked('r1', 9_000)).content).toBe(once.content)
  })

  it('is dropped while detached', () => {
    expect(reduce(emptyTracked(SESSION), asked('r1')).content.requests).toEqual([])
  })
})

describe('a request that arrives during an attach', () => {
  it('is parked, then held with no deadline once the attach lands', () => {
    const attaching = feed(emptyTracked(SESSION), { in: 'attach' }, asked('r1'))
    expect(attaching.content.requests).toEqual([])
    const landed = reduce(attaching, { in: 'attached', attempt: 1, snapshot: snapshot(), replay: null })
    expect(landed.content.requests).toEqual([waiting('r1', null)])
  })

  it('is never opened when its own cancel arrived during the same attach', () => {
    const landed = reattached(live(), [], [asked('r1'), cancelled(1, 'r1')], 1)
    expect(landed.content.requests).toEqual([])
    expect(landed.content.interlude).toEqual([])
    expect(reduce(landed, asked('r1')).content.requests, 'and a later copy of it stays closed').toEqual([])
  })

  it('survives an attach that turns into a rebuild', () => {
    const attaching = feed(live(), { in: 'link.lost' }, { in: 'attach' }, asked('r1'))
    const rebuilding = reduce(attaching, {
      in: 'attached', attempt: 2, snapshot: snapshot({ history: null }), replay: { snapshotRequired: true, epoch: EPOCH, events: [] }
    })
    expect(rebuilding.gate).toMatchObject({ at: 'attaching', plan: { mode: 'rebuild' }, asked: [card('r1')] })
  })
})

describe('reconciling with a snapshot', () => {
  it('opens a request the snapshot lists', () => {
    expect(reattached(live(), [card('r1')]).content.requests).toEqual([waiting('r1', null)])
  })

  it('keeps a held request the snapshot still lists, deadline included', () => {
    const before = live(asked('r1'))
    expect(reattached(before, [card('r1')]).content.requests).toBe(before.content.requests)
  })

  it('closes a held request the snapshot does not list as answered elsewhere, leaving a notice in the interlude', () => {
    const after = reattached(live(asked('r1')), [])
    expect(after.content.requests).toEqual([])
    expect(after.content.interlude).toEqual([closedNotice('r1', 'elsewhere')])
  })

  it('reopens a request this client answered that the snapshot still lists, saying Hermes did not get the answer', () => {
    const after = reattached(live(asked('r1'), answer('r1')), [card('r1')])
    expect(after.content.requests).toEqual([waiting('r1', 121_000, UNDELIVERED)])
    expect(after.content.interlude).toEqual([])
  })

  it('closes a request this client answered that the snapshot no longer lists as answered', () => {
    expect(reattached(live(asked('r1'), answer('r1')), []).content.interlude).toEqual([closedNotice('r1', 'answered')])
  })

  it('reopens a closed request the snapshot lists: the snapshot is what Hermes holds', () => {
    const closed = live(asked('r1'), cancelled(1, 'r1'))
    expect(reattached(closed, [card('r1')], [], 1).content.requests).toEqual([waiting('r1', null)])
  })

  it('keeps the requests through a rebuild from stored rows', () => {
    const rebuilt = feed(live(asked('r1'), asked('r2')), { in: 'gap' }, { in: 'attached', attempt: 2, snapshot: snapshot({ openRequests: [card('r2')] }), replay: null })
    expect(rebuilt.content.requests).toEqual([waiting('r2')])
    expect(rebuilt.content.interlude).toEqual([closedNotice('r1', 'elsewhere')])
  })
})

describe('request.cancel', () => {
  it.each<[CloseWhy, RequestEnd]>([
    ['resolved', 'elsewhere'], ['timeout', 'timeout'], ['interrupted', 'interrupted'], ['withdrawn', 'withdrawn'], ['done', 'done']
  ])('closes a waiting request for %s as %s', (why, end) => {
    const after = live(asked('r1'), cancelled(1, 'r1', why))
    expect(after.content.requests).toEqual([])
    expect(after.content.interlude).toEqual([closedNotice('r1', end)])
  })

  it.each<['withheld' | 'skip', RequestEnd]>([['withheld', 'answered'], ['skip', 'skipped']])('closes a request this client sent %s for as %s', (kind, end) => {
    expect(live(asked('r1'), answer('r1', kind), cancelled(1, 'r1')).content.interlude).toEqual([closedNotice('r1', end)])
  })

  it('leaves the notice in the open turn when one runs', () => {
    const after = live(started(1), asked('r1'), cancelled(2, 'r1', 'timeout'))
    expect(after.content.run).toMatchObject({ state: 'running', turn: { items: [closedNotice('r1', 'timeout')] } })
    expect(after.content.interlude).toEqual([])
  })

  it('keeps a late copy of a closed request closed', () => {
    const closed = live(asked('r1'), cancelled(1, 'r1'))
    expect(reduce(closed, asked('r1')).content).toBe(closed.content)
  })

  it('remembers the cancel of a request it never held, so the frame cannot open it afterwards', () => {
    expect(live(cancelled(1, 'r1'), asked('r1')).content.requests).toEqual([])
  })

  it('changes nothing when it comes twice', () => {
    const once = live(asked('r1'), cancelled(1, 'r1'))
    expect(reduce(once, cancelled(2, 'r1', 'timeout')).content).toBe(once.content)
  })

  it(`remembers the last ${CLOSED_KEPT} closed ids`, () => {
    const many = Array.from({ length: CLOSED_KEPT + 1 }, (_, index) => cancelled(index + 1, `r${index}`))
    const state = live(...many)
    expect(state.fence.closed).toHaveLength(CLOSED_KEPT)
    expect(state.fence.closed).not.toContain('r0')
  })
})

describe('a request and the turn', () => {
  it('is left alone when a turn starts, settles, or is lost', () => {
    const idle = live(asked('r1'))
    const running = reduce(idle, started(1))
    const settled = reduce(running, ended(2))
    expect(running.content.requests).toBe(idle.content.requests)
    expect(settled.content.requests).toBe(idle.content.requests)
    expect(settled.content.history).toHaveLength(1)
    const lost = reattached(reduce(settled, started(3, 2)), [card('r1')], [], 3)
    expect(lost.content.history.at(-1)?.outcome).toEqual({ kind: 'lost' })
    expect(lost.content.requests).toBe(idle.content.requests)
  })

  it('is what the chat is doing while no turn runs, and gives way to stopping and to a question of the turn', () => {
    const idle = live(asked('r1'))
    expect(activityOf(idle.content)).toEqual({ kind: 'answering', request: 'r1' })
    const running = reduce(idle, started(1))
    expect(activityOf(running.content)).toEqual({ kind: 'answering', request: 'r1' })
    expect(activityOf(reduce(running, { in: 'local', action: { did: 'stop' } }).content)).toEqual({ kind: 'stopping' })
    const prompted = reduce(running, event(2, { type: 'prompt.opened', id: 'p1' as never, generation: 1 as Generation, ask: { kind: 'approval', command: 'rm x', reason: null, choices: ['once'] }, timeoutS: null }, 1))
    expect(activityOf(prompted.content)).toEqual({ kind: 'asking', item: 0 })
  })
})

describe('this client\'s answer', () => {
  const BATCH: RequestAsk = {
    kind: 'questions', answers: {},
    questions: [{ id: 'q0', text: 'Which?', choices: ['a', 'b'], multi: false }, { id: 'q1', text: 'And?', choices: ['x', 'y'], multi: true }]
  }
  const batch = (): Tracked => live({ in: 'request', request: card('r1', BATCH, null), seenAt: 0 })
  const lock = (question: string, picks: readonly string[] | null): SessionInput =>
    ({ in: 'local', action: { did: 'answer', requestId: id('r1'), reply: { kind: 'lock', question, answer: picks } } })
  const accepted = (then: 'waits' | 'settles'): SessionInput => ({ in: 'local', action: { did: 'answer.accepted', requestId: id('r1'), then } })

  it('reads sending until Hermes closes the request', () => {
    const sending = live(asked('r1'), answer('r1'))
    expect(sending.content.requests[0]?.state).toEqual({ s: 'sending', reply: { kind: 'withheld' } })
    expect(reduce(sending, answer('r1', 'skip')).content, 'a second answer while one is on its way changes nothing').toBe(sending.content)
  })

  it('goes back to waiting with the reason when the answer could not be sent', () => {
    const failed = live(asked('r1'), answer('r1'), { in: 'local', action: { did: 'answer.failed', requestId: id('r1'), message: 'offline' } })
    expect(failed.content.requests[0]?.state).toEqual({ s: 'waiting', error: 'offline' })
  })

  it('joins a lock Hermes took to the batch and waits for the next', () => {
    const locked = feed(batch(), lock('q0', ['a']), accepted('waits'))
    expect(locked.content.requests[0]).toMatchObject({ ask: { answers: { q0: ['a'] } }, state: { s: 'waiting', error: null } })
  })

  it('keeps sending after the last lock, until Hermes closes the batch', () => {
    const last = feed(batch(), lock('q0', ['a']), accepted('waits'), lock('q1', null), accepted('settles'))
    expect(last.content.requests[0]).toMatchObject({ ask: { answers: { q0: ['a'], q1: null } }, state: { s: 'sending' } })
    expect(reduce(last, cancelled(1, 'r1')).content.interlude).toEqual([{ kind: 'notice', what: 'closed', requestId: 'r1', asked: 'questions', end: 'answered' }])
  })

  it('takes the locks a snapshot lists over its own', () => {
    const listed = card('r1', { ...BATCH, answers: { q0: ['b'] } }, null)
    expect(reattached(batch(), [listed]).content.requests[0]).toMatchObject({ ask: { answers: { q0: ['b'] } } })
  })
})

describe('a connector card', () => {
  const target = (state: 'pending' | 'skipped') =>
    ({ name: 'github', kind: 'connector', action: 'connect', state, resolved: state === 'skipped', detail: null, instructions: null, url: null, fields: [] }) as const
  const connect = (rev: number, state: 'pending' | 'skipped' = 'pending'): CardRequest =>
    ({ kind: 'card', requestId: id('op1'), sessionId: SESSION, method: 'connection.request', waitS: null, ask: { kind: 'connect', rev, targets: [target(state)], suggested: [] } })
  const shown = (seq: number, card: CardRequest, settled: CloseWhy | null = null) => event(seq, { type: 'connect', card, settled }, 1)

  it('opens with its event, changes with a newer one, ignores an older one and closes when it settles', () => {
    const open = live(started(1), shown(2, connect(1)))
    expect(open.content.requests).toMatchObject([{ id: 'op1', ask: { rev: 1 }, state: { s: 'waiting' } }])
    const changed = reduce(open, shown(3, connect(3, 'skipped')))
    expect(changed.content.requests).toMatchObject([{ ask: { rev: 3, targets: [{ state: 'skipped' }] } }])
    expect(reduce(changed, shown(4, connect(2))).content).toBe(changed.content)
    const settled = reduce(changed, shown(5, connect(4, 'skipped'), 'done'))
    expect(settled.content.requests).toEqual([])
    expect(settled.content.run).toMatchObject({ turn: { items: [{ kind: 'notice', what: 'closed', requestId: 'op1', asked: 'connect', end: 'done' }] } })
    expect(reduce(settled, shown(6, connect(4, 'skipped'))).content.requests, 'a frame after the settlement opens nothing').toEqual([])
  })
})

describe('what a window is sent', () => {
  it('has no place for a typed value in the session', () => {
    const published = sessionOf(live(asked('r1'), answer('r1')), { state: 'online' }, null)
    expect(Object.keys(published.requests[0]?.state ?? {})).toEqual(['s', 'reply'])
    expect(published.requests[0]?.state).toEqual({ s: 'sending', reply: { kind: 'withheld' } })
  })
})

describe('what the types refuse', () => {
  it('a typed value in the session, a request that holds its answer, and a reply of the other kind', () => {
    // @ts-expect-error a recorded reply has no member that carries a value
    const kept: RecordedReply = { kind: 'secret', value: 'hunter2' }
    // @ts-expect-error so the reducer's one door for an answer cannot take one
    const leaked: LocalAction = { did: 'answer', requestId: id('r1'), reply: { kind: 'secret', value: 'hunter2' } }
    // @ts-expect-error a request is waiting or sending, never answered
    const answered: HermesRequest['state'] = { s: 'answered', reply: { kind: 'withheld' } }
    // @ts-expect-error a question of the turn does not take a request's reply
    const crossed: Command = { do: 'answer', sessionId: SESSION, promptId: 'p1' as PromptId, reply: { kind: 'skip' } }
    expect([kept, leaked, answered, crossed]).toHaveLength(4)
  })
})
