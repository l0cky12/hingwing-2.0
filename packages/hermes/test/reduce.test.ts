import { describe, expect, it } from 'vitest'
import {
  activityOf, emptyTracked, reduce, sessionOf, syncOf,
  type Gate, type SessionEvent, type SessionInput, type Snapshot, type StampedEvent, type Tracked
} from '../src/domain/reduce'
import type {
  Ask, Generation, InputId, Link, OpenTurn, Outcome, PromptId, SessionContent, SessionId, SettledTurn, ToolId, ToolResult, TurnId
} from '../src/domain/session'

const EPOCH = 'e1'
const ONLINE: Link = { state: 'online' }
const DROPPED: Link = { state: 'waiting', attempt: 1, retryAt: 0, why: 'dropped', message: 'The connection closed.' }
const APPROVAL: Ask = { kind: 'approval', command: 'rm notes.md', reason: null, choices: ['once', 'deny'] }
const OUTPUT: ToolResult = { kind: 'command', output: 'ok', exitCode: 0, clipped: 0 }
const COMPLETE: Outcome = { kind: 'complete' }

const generation = (n: number) => n as Generation
const toolId = (id: string) => id as ToolId
const promptId = (id: string) => id as PromptId
const turnId = (id: string) => id as TurnId
const inputId = (id: string) => id as InputId

function frame(seq: number, event: SessionEvent | null, gen: number | null = 1, epoch = EPOCH): StampedEvent {
  return { stamp: { epoch, seq, generation: gen === null ? null : generation(gen) }, event }
}
const event = (seq: number, sessionEvent: SessionEvent | null, gen: number | null = 1, epoch = EPOCH): SessionInput =>
  ({ in: 'event', frame: frame(seq, sessionEvent, gen, epoch) })

const started = (id: string, requestText: string | null = 'Tidy the notes'): SessionEvent =>
  ({ type: 'turn.started', turnId: turnId(id), admissionId: null, requestText })
const delta = (text: string): SessionEvent => ({ type: 'text.delta', text, at: null })
const toolStarted = (id: string): SessionEvent => ({ type: 'tool.started', id: toolId(id), name: 'terminal', args: { command: id } })
const toolFinished = (id: string): SessionEvent =>
  ({ type: 'tool.finished', id: toolId(id), name: 'terminal', args: null, durationS: 2, diffs: [], result: OUTPUT })
const promptOpened = (id: string, gen = 1): SessionEvent => ({ type: 'prompt.opened', id: promptId(id), generation: generation(gen), ask: APPROVAL })
const ended = (outcome: Outcome, finalText: string | null = null, rows: readonly number[] = []): SessionEvent =>
  ({ type: 'turn.ended', outcome, finalText, rows })

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    id: 's1' as SessionId,
    title: 'Errand',
    cwd: '/home/u',
    running: false,
    generation: generation(1),
    revision: 1,
    subscriptionId: 'sub-1',
    watermark: { epoch: EPOCH, seq: 0 },
    queue: [],
    prompts: [],
    history: { turns: [], unfinished: null, older: null },
    openRequests: [],
    ...over
  }
}

function storedTurn(id: string, rows: readonly number[]): SettledTurn {
  return { id: turnId(id), request: { text: `request ${id}`, inputId: null }, items: [{ kind: 'text', markdown: `answer ${id}`, sealed: true }], outcome: COMPLETE, rows }
}

const feed = (state: Tracked, ...inputs: SessionInput[]): Tracked => inputs.reduce(reduce, state)

/** Opened from an empty snapshot: live at seq 0, one attach attempt used. */
function live(): Tracked {
  return feed(emptyTracked('s1' as SessionId), { in: 'attach' }, { in: 'attached', attempt: 1, snapshot: snapshot(), replay: null })
}

/** A turn that wrote "Hello" (seq 1-2), then the socket dropped and a new one asked to attach (attempt 2). */
function reattaching(): Tracked {
  return feed(live(), event(1, started('t1')), event(2, delta('Hello')), { in: 'link.lost' }, { in: 'attach' })
}

function openItems(state: Tracked) {
  const { run } = state.content
  if (run.state !== 'running') throw new Error('expected an open run')
  return run.turn.items
}

describe('the seq gate', () => {
  it('drops a frame it has already applied and keeps the content reference', () => {
    const once = feed(live(), event(1, started('t1')), event(2, delta('Hel')))
    const twice = reduce(once, event(2, delta('Hel')))
    expect(openItems(twice)).toEqual([{ kind: 'text', markdown: 'Hel', sealed: false }])
    expect(twice.content).toBe(once.content)
  })

  it('moves the cursor for a frame with nothing to show, and leaves the content alone', () => {
    const before = feed(live(), event(1, started('t1')))
    const after = reduce(before, event(2, null))
    expect(after.gate).toEqual({ at: 'live', cursor: { epoch: EPOCH, seq: 2 }, subscriptionId: 'sub-1' })
    expect(after.content).toBe(before.content)
  })

  it('does not fold a frame stamped with an older generation than the open run', () => {
    const before = feed(live(), event(1, started('t2'), 2))
    const after = reduce(before, event(2, delta('late text of the turn before'), 1))
    expect(after.content).toBe(before.content)
    expect(after.gate).toMatchObject({ cursor: { seq: 2 } })
  })

  it('treats a frame of another epoch as a gap', () => {
    const after = reduce(live(), event(1, started('t1'), 1, 'e2'))
    expect(after.gate).toEqual({ at: 'attaching', attempt: 2, plan: { mode: 'rebuild' }, parked: [] })
  })
})

describe('the fold', () => {
  it('keeps two running tools apart when they finish in the other order', () => {
    const both = feed(live(), event(1, started('t1')), event(2, toolStarted('a')), event(3, toolStarted('b')))
    expect(activityOf(both.content)).toEqual({ kind: 'working', item: 1 })

    const bDone = reduce(both, event(4, toolFinished('b')))
    expect(openItems(bDone)).toEqual([
      { kind: 'tool', id: 'a', name: 'terminal', args: { command: 'a' }, status: { s: 'running', note: null } },
      { kind: 'tool', id: 'b', name: 'terminal', args: { command: 'b' }, status: { s: 'done', durationS: 2, diffs: [], result: OUTPUT } }
    ])
    expect(openItems(bDone)[0]).toBe(openItems(both)[0])
    expect(activityOf(bDone.content)).toEqual({ kind: 'working', item: 0 })

    const allDone = reduce(bDone, event(5, toolFinished('a')))
    expect(openItems(allDone).map(item => item.kind === 'tool' && item.status.s)).toEqual(['done', 'done'])
    expect(activityOf(allDone.content)).toEqual({ kind: 'thinking' })
  })

  it('puts text before a tool above it and text after it below', () => {
    const state = feed(live(), event(1, started('t1')), event(2, delta('Look')), event(3, delta('ing.')), event(4, toolStarted('a')), event(5, delta('Found it.')))
    expect(openItems(state)).toEqual([
      { kind: 'text', markdown: 'Looking.', sealed: true },
      { kind: 'tool', id: 'a', name: 'terminal', args: { command: 'a' }, status: { s: 'running', note: null } },
      { kind: 'text', markdown: 'Found it.', sealed: false }
    ])
  })

  it('drops a delta that is not after the last one applied', () => {
    const at = (offset: number, text: string): SessionEvent => ({ type: 'text.delta', text, at: { segment: 0, offset } })
    const state = feed(live(), event(1, started('t1')), event(2, at(3, 'Hel')), event(3, at(3, 'Hel')), event(4, at(5, 'lo')))
    expect(openItems(state)).toEqual([{ kind: 'text', markdown: 'Hello', sealed: false }])
  })

  it('settles a turn that ends with a running tool and a waiting prompt', () => {
    const failed: Outcome = { kind: 'failed', message: 'No provider is configured.', code: 'auth_permanent', retryable: false }
    const state = feed(live(), event(1, started('t1')), event(2, toolStarted('a')), event(3, promptOpened('p1')), event(4, ended(failed, null, [11, 12])))
    expect(state.content.run).toEqual({ state: 'idle' })
    expect(state.content.history).toEqual([{
      id: 't1',
      request: { text: 'Tidy the notes', inputId: null },
      items: [
        { kind: 'tool', id: 'a', name: 'terminal', args: { command: 'a' }, status: { s: 'cut' } },
        { kind: 'prompt', id: 'p1', generation: 1, ask: APPROVAL, state: { s: 'withdrawn' } }
      ],
      outcome: failed,
      rows: [11, 12]
    }])
    expect(activityOf(state.content)).toEqual({ kind: 'idle' })
  })

  it('replaces the text after the last tool with the final text', () => {
    const state = feed(live(), event(1, started('t1')), event(2, delta('Intro')), event(3, toolStarted('a')), event(4, toolFinished('a')), event(5, delta('Do')), event(6, ended(COMPLETE, 'Done.')))
    expect(state.content.history[0]?.items.map(item => item.kind === 'text' ? item.markdown : item.kind)).toEqual(['Intro', 'tool', 'Done.'])
  })

  it('does not end the open turn on an end frame that names no generation', () => {
    const before = feed(live(), event(1, started('t1')))
    const after = reduce(before, event(2, ended(COMPLETE), null))
    expect(after.content).toBe(before.content)
  })

  it('settles the open turn as lost when a newer generation starts', () => {
    const state = feed(live(), event(1, started('t1')), event(2, toolStarted('a')), event(3, started('t2', 'Next errand'), 2))
    expect(state.content.history).toMatchObject([{ id: 't1', outcome: { kind: 'lost' }, items: [{ kind: 'tool', status: { s: 'cut' } }] }])
    expect(state.content.run).toEqual({
      state: 'running',
      generation: 2,
      stop: 'none',
      turn: { id: 't2', request: { text: 'Next errand', inputId: null }, items: [], announced: null }
    })
  })

  it('opens a run for an item that arrives with no turn open', () => {
    const state = reduce(live(), event(1, toolStarted('a'), 4))
    expect(state.content.run).toMatchObject({ state: 'running', generation: 4, turn: { request: null, items: [{ kind: 'tool', id: 'a' }] } })
  })

  it('hands a starting turn the message this client sent', () => {
    const send: SessionInput = { in: 'local', action: { did: 'send', inputId: inputId('i1'), text: 'Tidy the notes' } }
    const sent = feed(live(), send, send)
    expect(sent.content.outbox).toEqual([{ inputId: 'i1', text: 'Tidy the notes', state: { s: 'sending' } }])

    const running = reduce(sent, event(1, { type: 'turn.started', turnId: turnId('t1'), admissionId: 'adm-1', requestText: null }))
    expect(running.content.outbox).toEqual([])
    expect(running.content.run).toMatchObject({ turn: { request: { text: 'Tidy the notes', inputId: 'i1' } } })
  })

  it('claims a queued message through its admission, not the one still sending', () => {
    const state = feed(
      live(),
      { in: 'local', action: { did: 'send', inputId: inputId('i1'), text: 'first' } },
      { in: 'local', action: { did: 'send.admitted', inputId: inputId('i1'), admissionId: 'adm-1', status: 'queued' } },
      { in: 'local', action: { did: 'send', inputId: inputId('i2'), text: 'second' } },
      event(1, { type: 'turn.started', turnId: turnId('t1'), admissionId: 'adm-1', requestText: 'first' })
    )
    expect(state.content.outbox).toEqual([{ inputId: 'i2', text: 'second', state: { s: 'sending' } }])
    expect(state.content.run).toMatchObject({ turn: { request: { text: 'first', inputId: 'i1' } } })
  })

  it('files a declined request once per request id', () => {
    const declined: SessionInput = { in: 'declined', request: { requestId: 'r1', method: 'sudo.request', sessionId: 's1' as SessionId } }
    const once = feed(live(), event(1, started('t1')), declined)
    expect(openItems(once)).toEqual([{ kind: 'notice', what: 'declined', requestId: 'r1', method: 'sudo.request' }])
    expect(reduce(once, declined).content).toBe(once.content)
  })

  it('follows an answer from waiting to sending to answered', () => {
    const reply = { kind: 'choice', value: 'once' } as const
    const asked = feed(live(), event(1, started('t1')), event(2, promptOpened('p1')))
    const sending = reduce(asked, { in: 'local', action: { did: 'answer', promptId: promptId('p1'), reply } })
    expect(openItems(sending)).toMatchObject([{ state: { s: 'sending', reply } }])
    const answered = reduce(sending, { in: 'local', action: { did: 'answer.resolved', promptId: promptId('p1'), byUs: true } })
    expect(openItems(answered)).toMatchObject([{ state: { s: 'answered', reply } }])
    expect(activityOf(answered.content)).toEqual({ kind: 'thinking' })
  })

  it('prepends an earlier page without the turns it already holds', () => {
    const seeded = feed(emptyTracked('s1' as SessionId), { in: 'attach' }, {
      in: 'attached', attempt: 1, replay: null,
      snapshot: snapshot({ history: { turns: [storedTurn('h2', [3, 4])], unfinished: null, older: { cursor: 'c1' } } })
    })
    const page: SessionInput = { in: 'earlier', page: { turns: [storedTurn('h1', [1, 2]), storedTurn('h2-again', [3, 4])], unfinished: null, older: null } }
    const once = reduce(seeded, page)
    expect(once.content.history.map(turn => turn.id)).toEqual(['h1', 'h2'])
    expect(once.content.earlier).toBe('none')
    expect(reduce(once, page).content).toBe(once.content)
  })
})

describe('attached', () => {
  it('A: applies replay, then a parked catch-up frame that ends the turn, before it trusts the snapshot', () => {
    const state = feed(
      reattaching(),
      event(4, ended(COMPLETE, null, [7])),
      {
        in: 'attached', attempt: 2,
        replay: { snapshotRequired: false, epoch: EPOCH, events: [frame(3, delta(' world'))] },
        snapshot: snapshot({ history: null, subscriptionId: 'sub-2', watermark: { epoch: EPOCH, seq: 4 }, revision: 3 })
      }
    )
    expect(state.gate).toEqual({ at: 'live', cursor: { epoch: EPOCH, seq: 4 }, subscriptionId: 'sub-2' })
    expect(state.content.run).toEqual({ state: 'idle' })
    expect(state.content.history).toEqual([{
      id: 't1',
      request: { text: 'Tidy the notes', inputId: null },
      items: [{ kind: 'text', markdown: 'Hello world', sealed: true }],
      outcome: COMPLETE,
      rows: [7]
    }])
  })

  it('A: applies parked frames above the watermark after the snapshot', () => {
    const state = feed(
      reattaching(),
      event(3, { type: 'meta', title: 'Renamed' }, null),
      {
        in: 'attached', attempt: 2,
        replay: { snapshotRequired: false, epoch: EPOCH, events: [] },
        snapshot: snapshot({ history: null, running: true, title: 'Errand', watermark: { epoch: EPOCH, seq: 2 } })
      }
    )
    expect(state.gate).toMatchObject({ at: 'live', cursor: { seq: 3 } })
    expect(state.content.title).toBe('Renamed')
    expect(openItems(state)).toEqual([{ kind: 'text', markdown: 'Hello', sealed: false }])
  })

  it('A: reconciles prompts and a run the snapshot no longer has', () => {
    const asking = feed(live(), event(1, started('t1')), event(2, promptOpened('p1')), { in: 'link.lost' }, { in: 'attach' })
    const replay = { snapshotRequired: false, epoch: EPOCH, events: [] }
    const at = { history: null, watermark: { epoch: EPOCH, seq: 2 } }

    const elsewhere = reduce(asking, {
      in: 'attached', attempt: 2, replay,
      snapshot: snapshot({ ...at, running: true, prompts: [{ id: promptId('p2'), generation: generation(1), ask: APPROVAL }] })
    })
    expect(openItems(elsewhere)).toMatchObject([
      { id: 'p1', state: { s: 'answered', reply: null } },
      { id: 'p2', state: { s: 'waiting', error: null } }
    ])

    const gone = reduce(asking, { in: 'attached', attempt: 2, replay, snapshot: snapshot({ ...at, running: false }) })
    expect(gone.content.run).toEqual({ state: 'idle' })
    expect(gone.content.history).toMatchObject([{ id: 't1', outcome: { kind: 'lost' }, items: [{ id: 'p1', state: { s: 'withdrawn' } }] }])
  })

  it('B: seeds a first open from the snapshot and its history', () => {
    const opening = reduce(emptyTracked('s1' as SessionId), { in: 'attach' })
    expect(opening.gate).toEqual({ at: 'attaching', attempt: 1, plan: { mode: 'open' }, parked: [] })

    const turns = [storedTurn('h1', [1, 2]), storedTurn('h2', [3, 4])]
    const state = reduce(opening, {
      in: 'attached', attempt: 1, replay: null,
      snapshot: snapshot({ watermark: { epoch: EPOCH, seq: 9 }, history: { turns, unfinished: null, older: { cursor: 'c1' } } })
    })
    expect(state.gate).toEqual({ at: 'live', cursor: { epoch: EPOCH, seq: 9 }, subscriptionId: 'sub-1' })
    expect(state.content).toEqual({ id: 's1', title: 'Errand', cwd: '/home/u', history: turns, earlier: 'more', run: { state: 'idle' }, outbox: [] })
  })

  it('B: opens the unfinished turn of a running snapshot with its waiting prompts, then the parked frames above the watermark', () => {
    const tool = { kind: 'tool', id: toolId('a'), name: 'terminal', args: {}, status: { s: 'done', durationS: null, diffs: [], result: OUTPUT } } as const
    const state = feed(
      emptyTracked('s1' as SessionId),
      { in: 'attach' },
      event(5, delta('already in the snapshot'), 3),
      event(6, delta('Next,'), 3),
      {
        in: 'attached', attempt: 1, replay: null,
        snapshot: snapshot({
          running: true,
          generation: generation(3),
          watermark: { epoch: EPOCH, seq: 5 },
          prompts: [{ id: promptId('p1'), generation: generation(3), ask: APPROVAL }],
          history: { turns: [storedTurn('h1', [1, 2])], unfinished: { request: 'Fix the build', items: [tool] }, older: null }
        })
      }
    )
    expect(state.content.history).toEqual([storedTurn('h1', [1, 2])])
    expect(state.content.run).toMatchObject({ state: 'running', generation: 3, stop: 'none', turn: { request: { text: 'Fix the build', inputId: null } } })
    expect(openItems(state)).toEqual([
      tool,
      { kind: 'prompt', id: 'p1', generation: 3, ask: APPROVAL, state: { s: 'waiting', error: null } },
      { kind: 'text', markdown: 'Next,', sealed: false }
    ])
    expect(activityOf(state.content)).toEqual({ kind: 'asking', item: 1 })
    expect(state.gate).toMatchObject({ at: 'live', cursor: { seq: 6 } })
  })

  it('B: an unfinished turn in a snapshot that is not running is lost', () => {
    const state = feed(emptyTracked('s1' as SessionId), { in: 'attach' }, {
      in: 'attached', attempt: 1, replay: null,
      snapshot: snapshot({
        prompts: [{ id: promptId('p1'), generation: generation(1), ask: APPROVAL }],
        history: { turns: [storedTurn('h1', [1])], unfinished: { request: 'Fix the build', items: [] }, older: null }
      })
    })
    expect(state.content.run).toEqual({ state: 'idle' })
    expect(state.content.history).toMatchObject([
      { id: 'h1', outcome: COMPLETE },
      { request: { text: 'Fix the build', inputId: null }, items: [], outcome: { kind: 'lost' } }
    ])
  })

  const cannotReplay: Record<string, Pick<Extract<SessionInput, { in: 'attached' }>, 'replay' | 'snapshot'>> = {
    'snapshot_required': {
      replay: { snapshotRequired: true, epoch: EPOCH, events: [] },
      snapshot: snapshot({ history: null, watermark: { epoch: EPOCH, seq: 2 } })
    },
    'a changed epoch': {
      replay: { snapshotRequired: false, epoch: 'e2', events: [] },
      snapshot: snapshot({ history: null, watermark: { epoch: 'e2', seq: 2 } })
    },
    'a hole below the watermark': {
      replay: { snapshotRequired: false, epoch: EPOCH, events: [frame(3, delta(' world'))] },
      snapshot: snapshot({ history: null, watermark: { epoch: EPOCH, seq: 5 } })
    }
  }
  it.each(Object.entries(cannotReplay))('C: %s starts a rebuild attempt and keeps what is on screen', (_, reply) => {
    const parked = frame(6, delta('!'))
    const before = reduce(reattaching(), { in: 'event', frame: parked })
    const after = reduce(before, { in: 'attached', attempt: 2, ...reply })
    expect(after.gate).toEqual({ at: 'attaching', attempt: 3, plan: { mode: 'rebuild' }, parked: [parked] })
    expect(after.content).toBe(before.content)
  })

  it('a rebuild replaces the content, and the turn whose end was missed reads as lost', () => {
    const rebuilding = feed(reattaching(), { in: 'attached', attempt: 2, ...cannotReplay['snapshot_required']! })
    const state = reduce(rebuilding, {
      in: 'attached', attempt: 3, replay: null,
      snapshot: snapshot({ watermark: { epoch: 'e2', seq: 40 }, history: { turns: [storedTurn('h1', [1, 2]), storedTurn('h2', [3, 4])], unfinished: null, older: null } })
    })
    expect(state.gate).toEqual({ at: 'live', cursor: { epoch: 'e2', seq: 40 }, subscriptionId: 'sub-1' })
    expect(state.content.run).toEqual({ state: 'idle' })
    expect(state.content.history.map(turn => [turn.id, turn.outcome.kind])).toEqual([['h1', 'complete'], ['h2', 'lost']])
  })

  it('ignores the reply of an older attempt', () => {
    const state = reattaching()
    expect(reduce(state, { in: 'attached', attempt: 1, snapshot: snapshot(), replay: null })).toBe(state)
    expect(reduce(state, { in: 'attach.failed', attempt: 1, refused: 'No such session.' })).toBe(state)
  })

  it('ignores attach while attaching or live', () => {
    const attaching = reattaching()
    expect(reduce(attaching, { in: 'attach' })).toBe(attaching)
    const attachedState = live()
    expect(reduce(attachedState, { in: 'attach' })).toBe(attachedState)
  })

  it('goes back to detached with the gateway\'s words when the attach is refused', () => {
    const state = reduce(reattaching(), { in: 'attach.failed', attempt: 2, refused: 'This chat was archived.' })
    expect(state.gate).toEqual({ at: 'detached', why: { refused: 'This chat was archived.' }, cursor: { epoch: EPOCH, seq: 2 } })
  })
})

describe('a lost link and a gap', () => {
  it('keeps the content and the cursor when the link is lost, and replays from there', () => {
    const before = feed(live(), event(1, started('t1')), event(2, delta('Hello')))
    const lost = reduce(before, { in: 'link.lost' })
    expect(lost.gate).toEqual({ at: 'detached', why: 'link-lost', cursor: { epoch: EPOCH, seq: 2 } })
    expect(lost.content).toBe(before.content)
    expect(reduce(lost, { in: 'attach' }).gate).toEqual({ at: 'attaching', attempt: 2, plan: { mode: 'replay', from: { epoch: EPOCH, seq: 2 } }, parked: [] })
  })

  it('drops frames while detached', () => {
    const lost = feed(live(), event(1, started('t1')), { in: 'link.lost' })
    expect(reduce(lost, event(2, delta('straggler')))).toBe(lost)
  })

  it('parks frames while attaching and discards them when the link is lost again', () => {
    const parked = reduce(reattaching(), event(3, delta(' world')))
    expect(parked.gate).toMatchObject({ at: 'attaching', parked: [frame(3, delta(' world'))] })
    expect(reduce(parked, { in: 'link.lost' }).gate).toEqual({ at: 'detached', why: 'link-lost', cursor: { epoch: EPOCH, seq: 2 } })
  })

  it('rebuilds on a gap, whether live, attaching or detached', () => {
    const before = feed(live(), event(1, started('t1')))
    const fromLive = reduce(before, { in: 'gap' })
    expect(fromLive.gate).toEqual({ at: 'attaching', attempt: 2, plan: { mode: 'rebuild' }, parked: [] })
    expect(fromLive.content).toBe(before.content)

    const fromAttaching = feed(reattaching(), event(3, delta('!')), { in: 'gap' })
    expect(fromAttaching.gate).toEqual({ at: 'attaching', attempt: 3, plan: { mode: 'rebuild' }, parked: [] })

    const detached = feed(before, { in: 'link.lost' }, { in: 'gap' })
    expect(detached.gate).toEqual({ at: 'detached', why: 'link-lost', cursor: null })
    expect(reduce(detached, { in: 'attach' }).gate).toMatchObject({ at: 'attaching', plan: { mode: 'rebuild' } })
  })
})

describe('syncOf', () => {
  const cursor = { epoch: EPOCH, seq: 1 }
  const attaching = (plan: Extract<Gate, { at: 'attaching' }>['plan']): Gate => ({ at: 'attaching', attempt: 1, plan, parked: [] })
  it.each<[string, Gate, Link, ReturnType<typeof syncOf>]>([
    ['attaching to open', attaching({ mode: 'open' }), ONLINE, { state: 'opening' }],
    ['attaching to replay', attaching({ mode: 'replay', from: cursor }), ONLINE, { state: 'catching-up' }],
    ['attaching to rebuild', attaching({ mode: 'rebuild' }), ONLINE, { state: 'rebuilding' }],
    ['live', { at: 'live', cursor, subscriptionId: 'sub-1' }, ONLINE, { state: 'live' }],
    ['refused', { at: 'detached', why: { refused: 'This chat was archived.' }, cursor: null }, ONLINE, { state: 'unavailable', message: 'This chat was archived.' }],
    ['link lost', { at: 'detached', why: 'link-lost', cursor }, DROPPED, { state: 'offline' }],
    ['link lost, socket back, not yet attaching', { at: 'detached', why: 'link-lost', cursor }, ONLINE, { state: 'offline' }],
    ['new with the link online', { at: 'detached', why: 'new', cursor: null }, ONLINE, { state: 'opening' }],
    ['new with the link down', { at: 'detached', why: 'new', cursor: null }, DROPPED, { state: 'offline' }]
  ])('%s', (_, gate, link, sync) => {
    expect(syncOf(gate, link)).toEqual(sync)
  })
})

describe('sessionOf', () => {
  it('returns the previous value until the content or the sync changes', () => {
    const state = feed(live(), event(1, started('t1')))
    const first = sessionOf(state, ONLINE, null)
    expect(first).toEqual({ ...state.content, sync: { state: 'live' } })

    const unshown = reduce(state, event(2, null))
    expect(sessionOf(unshown, ONLINE, first)).toBe(first)

    const offline = sessionOf(reduce(unshown, { in: 'link.lost' }), DROPPED, first)
    expect(offline).toEqual({ ...state.content, sync: { state: 'offline' } })

    const written = reduce(unshown, event(3, delta('Hi')))
    expect(sessionOf(written, ONLINE, first).run).toBe(written.content.run)
  })
})

describe('activityOf', () => {
  it('ranks stopping, asking, working, writing, preparing, thinking', () => {
    const tool = { kind: 'tool', id: toolId('a'), name: 'terminal', args: {}, status: { s: 'running', note: null } } as const
    const prompt = { kind: 'prompt', id: promptId('p1'), generation: generation(1), ask: APPROVAL, state: { s: 'waiting', error: null } } as const
    const text = { kind: 'text', markdown: 'Wri', sealed: false } as const
    const session = (items: OpenTurn['items'], announced: string | null, stop: 'none' | 'requested'): SessionContent => ({
      ...live().content,
      run: { state: 'running', generation: generation(1), stop, turn: { id: turnId('t1'), request: null, items, announced } }
    })
    expect(activityOf(session([tool, prompt, text], 'write_file', 'requested'))).toEqual({ kind: 'stopping' })
    expect(activityOf(session([tool, prompt, text], 'write_file', 'none'))).toEqual({ kind: 'asking', item: 1 })
    expect(activityOf(session([tool, text], 'write_file', 'none'))).toEqual({ kind: 'working', item: 0 })
    expect(activityOf(session([text], 'write_file', 'none'))).toEqual({ kind: 'writing' })
    expect(activityOf(session([], 'write_file', 'none'))).toEqual({ kind: 'preparing', tool: 'write_file' })
    expect(activityOf(session([], null, 'none'))).toEqual({ kind: 'thinking' })
    expect(activityOf(live().content)).toEqual({ kind: 'idle' })
  })

  it('reports the oldest prompt still open, counting one whose answer is on its way', () => {
    const state = feed(
      live(), event(1, started('t1')), event(2, promptOpened('p1')), event(3, promptOpened('p2')),
      { in: 'local', action: { did: 'answer', promptId: promptId('p1'), reply: { kind: 'choice', value: 'once' } } }
    )
    expect(activityOf(state.content)).toEqual({ kind: 'asking', item: 0 })
  })
})
