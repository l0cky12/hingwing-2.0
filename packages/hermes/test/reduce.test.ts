import { describe, expect, it } from 'vitest'
import {
  activityOf, emptyTracked, reduce, sessionOf, shareOf, syncOf,
  type Gate, type HelperUpdate, type MoaStep, type SessionEvent, type SessionInput, type Snapshot, type StampedEvent, type Tracked
} from '../src/domain/reduce'
import type { ModelMenu } from '../src/domain/command'
import { modelViewOf, sameModel } from '../src/domain/model'
import type {
  AdmissionId, Ask, ContextFill, Generation, HelperId, HelperItem, InputId, Item, Link, ModelId, ModelRef, OpenTurn, Outcome, PromptId, RequestId, SessionContent, SessionId,
  SessionUsage, SettledTurn, SideId, SideTask, StatusAbout, Tokens, ToolId, ToolResult, TurnId
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

function frame(seq: number, event: SessionEvent | null, gen: number | null = 1, epoch = EPOCH, seenAt: number | null = null): StampedEvent {
  return { stamp: { epoch, seq, generation: gen === null ? null : generation(gen) }, event, seenAt }
}
const event = (seq: number, sessionEvent: SessionEvent | null, gen: number | null = 1, epoch = EPOCH, seenAt: number | null = null): SessionInput =>
  ({ in: 'event', frame: frame(seq, sessionEvent, gen, epoch, seenAt) })

const started = (id: string, requestText: string | null = 'Tidy the notes'): SessionEvent =>
  ({ type: 'turn.started', turnId: turnId(id), admissionId: null, requestText })
const delta = (text: string): SessionEvent => ({ type: 'text.delta', text, at: null })
const toolStarted = (id: string): SessionEvent => ({ type: 'tool.started', id: toolId(id), name: 'terminal', args: { command: id } })
const toolFinished = (id: string): SessionEvent =>
  ({ type: 'tool.finished', id: toolId(id), name: 'terminal', args: null, durationS: 2, diffs: [], result: OUTPUT, image: null })
const promptOpened = (id: string, gen = 1): SessionEvent => ({ type: 'prompt.opened', id: promptId(id), generation: generation(gen), ask: APPROVAL, timeoutS: null })
const ended = (
  outcome: Outcome, finalText: string | null = null, rows: readonly number[] = [], userRow: number | null = null, usage: SessionUsage | null = null
): SessionEvent => ({ type: 'turn.ended', outcome, finalText, rows, userRow, replyRow: null, usage })

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    id: 's1' as SessionId,
    title: 'Errand',
    cwd: '/home/u',
    model: null,
    tuning: { effort: null, fast: null, yolo: null },
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
  return {
    id: turnId(id), request: { text: `request ${id}`, inputId: null, rowId: rows[0] ?? null, attachments: [] }, items: [{ kind: 'text', markdown: `answer ${id}`, sealed: true }],
    began: null, outcome: COMPLETE, rows, tokens: null, reply: null
  }
}

const feed = (state: Tracked, ...inputs: SessionInput[]): Tracked => inputs.reduce(reduce, state)
const UNHEARD = { control: 0, processes: 0 }

function live(): Tracked {
  return feed(emptyTracked('s1' as SessionId), { in: 'attach' }, { in: 'attached', attempt: 1, snapshot: snapshot(), replay: null })
}

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
    expect(after.gate).toEqual({ at: 'attaching', attempt: 2, plan: { mode: 'rebuild' }, parked: [], asked: [] })
  })
})

describe('the fold', () => {
  it('keeps two running tools apart when they finish in the other order', () => {
    const both = feed(live(), event(1, started('t1')), event(2, toolStarted('a')), event(3, toolStarted('b')))
    expect(activityOf(both.content)).toEqual({ kind: 'working', item: 1 })

    const bDone = reduce(both, event(4, toolFinished('b')))
    expect(openItems(bDone)).toEqual([
      { kind: 'tool', id: 'a', name: 'terminal', args: { command: 'a' }, status: { s: 'running', note: null } },
      { kind: 'tool', id: 'b', name: 'terminal', args: { command: 'b' }, status: { s: 'done', durationS: 2, diffs: [], result: OUTPUT, image: null } }
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
      request: { text: 'Tidy the notes', inputId: null, rowId: null, attachments: [] },
      began: null,
      items: [
        { kind: 'tool', id: 'a', name: 'terminal', args: { command: 'a' }, status: { s: 'cut' } },
        { kind: 'prompt', id: 'p1', generation: 1, ask: APPROVAL, state: { s: 'withdrawn' }, deadline: null }
      ],
      outcome: failed,
      rows: [11, 12],
      tokens: null,
      reply: null
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
      turn: { id: 't2', request: { text: 'Next errand', inputId: null, rowId: null, attachments: [] }, began: null, items: [], announced: null }
    })
  })

  it('opens a run for an item that arrives with no turn open', () => {
    const state = reduce(live(), event(1, toolStarted('a'), 4))
    expect(state.content.run).toMatchObject({ state: 'running', generation: 4, turn: { request: null, items: [{ kind: 'tool', id: 'a' }] } })
  })

  it('hands a starting turn the message this client sent', () => {
    const send: SessionInput = { in: 'local', action: { did: 'send', inputId: inputId('i1'), text: 'Tidy the notes', attachments: [] } }
    const sent = feed(live(), send, send)
    expect(sent.content.outbox).toEqual([{ inputId: 'i1', text: 'Tidy the notes', attachments: [], state: { s: 'sending' } }])

    const running = reduce(sent, event(1, { type: 'turn.started', turnId: turnId('t1'), admissionId: 'adm-1', requestText: null }))
    expect(running.content.outbox).toEqual([])
    expect(running.content.run).toMatchObject({ turn: { request: { text: 'Tidy the notes', inputId: 'i1' } } })
  })

  it('claims a queued message through its admission, not the one still sending', () => {
    const state = feed(
      live(),
      { in: 'local', action: { did: 'send', inputId: inputId('i1'), text: 'first', attachments: [] } },
      event(1, { type: 'meta', queue: [{ admissionId: 'adm-1' as AdmissionId, inputId: inputId('i1'), text: 'first', state: { s: 'queued', can: [] } }] }, null),
      { in: 'local', action: { did: 'send', inputId: inputId('i2'), text: 'second', attachments: [] } },
      event(2, { type: 'turn.started', turnId: turnId('t1'), admissionId: 'adm-1', requestText: 'first' })
    )
    expect(state.content.outbox).toEqual([{ inputId: 'i2', text: 'second', attachments: [], state: { s: 'sending' } }])
    expect(state.content.run).toMatchObject({ turn: { request: { text: 'first', inputId: 'i1' } } })
  })

  it('files a declined request once per request id', () => {
    const declined: SessionInput = { in: 'declined', request: { kind: 'bridge', requestId: 'r1' as RequestId, method: 'theme.pick', sessionId: 's1' as SessionId } }
    const once = feed(live(), event(1, started('t1')), declined)
    expect(openItems(once)).toEqual([{ kind: 'notice', what: 'declined', requestId: 'r1', method: 'theme.pick' }])
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
      request: { text: 'Tidy the notes', inputId: null, rowId: null, attachments: [] },
      began: null,
      items: [{ kind: 'text', markdown: 'Hello world', sealed: true }],
      outcome: COMPLETE,
      rows: [7],
      tokens: null,
      reply: null
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
    expect(opening.gate).toEqual({ at: 'attaching', attempt: 1, plan: { mode: 'open' }, parked: [], asked: [] })

    const turns = [storedTurn('h1', [1, 2]), storedTurn('h2', [3, 4])]
    const state = reduce(opening, {
      in: 'attached', attempt: 1, replay: null,
      snapshot: snapshot({ watermark: { epoch: EPOCH, seq: 9 }, history: { turns, unfinished: null, older: { cursor: 'c1' } } })
    })
    expect(state.gate).toEqual({ at: 'live', cursor: { epoch: EPOCH, seq: 9 }, subscriptionId: 'sub-1' })
    expect(state.content).toEqual({ id: 's1', title: 'Errand', cwd: '/home/u', history: turns, earlier: 'more', run: { state: 'idle' }, interlude: [], requests: [], queue: [], outbox: [], model: { current: null, next: null, ask: null }, usage: { totals: null, context: null }, tuning: { reasoning: null, busy: null, effort: null, fast: null, yolo: null }, sides: [], processes: null, control: null })
  })

  it('B: opens the unfinished turn of a running snapshot with its waiting prompts, then the parked frames above the watermark', () => {
    const tool = { kind: 'tool', id: toolId('a'), name: 'terminal', args: {}, status: { s: 'done', durationS: null, diffs: [], result: OUTPUT, image: null } } as const
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
          history: { turns: [storedTurn('h1', [1, 2])], unfinished: { request: 'Fix the build', began: null, items: [tool] }, older: null }
        })
      }
    )
    expect(state.content.history).toEqual([storedTurn('h1', [1, 2])])
    expect(state.content.run).toMatchObject({ state: 'running', generation: 3, stop: 'none', turn: { request: { text: 'Fix the build', inputId: null, rowId: null } } })
    expect(openItems(state)).toEqual([
      tool,
      { kind: 'prompt', id: 'p1', generation: 3, ask: APPROVAL, state: { s: 'waiting', error: null }, deadline: null },
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
        history: { turns: [storedTurn('h1', [1])], unfinished: { request: 'Fix the build', began: null, items: [] }, older: null }
      })
    })
    expect(state.content.run).toEqual({ state: 'idle' })
    expect(state.content.history).toMatchObject([
      { id: 'h1', outcome: COMPLETE },
      { request: { text: 'Fix the build', inputId: null, rowId: null }, items: [], outcome: { kind: 'lost' } }
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
    expect(after.gate).toEqual({ at: 'attaching', attempt: 3, plan: { mode: 'rebuild' }, parked: [parked], asked: [] })
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
    expect(reduce(lost, { in: 'attach' }).gate).toEqual({ at: 'attaching', attempt: 2, plan: { mode: 'replay', from: { epoch: EPOCH, seq: 2 } }, parked: [], asked: [] })
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
    expect(fromLive.gate).toEqual({ at: 'attaching', attempt: 2, plan: { mode: 'rebuild' }, parked: [], asked: [] })
    expect(fromLive.content).toBe(before.content)

    const fromAttaching = feed(reattaching(), event(3, delta('!')), { in: 'gap' })
    expect(fromAttaching.gate).toEqual({ at: 'attaching', attempt: 3, plan: { mode: 'rebuild' }, parked: [], asked: [] })

    const detached = feed(before, { in: 'link.lost' }, { in: 'gap' })
    expect(detached.gate).toEqual({ at: 'detached', why: 'link-lost', cursor: null })
    expect(reduce(detached, { in: 'attach' }).gate).toMatchObject({ at: 'attaching', plan: { mode: 'rebuild' } })
  })
})

describe('syncOf', () => {
  const cursor = { epoch: EPOCH, seq: 1 }
  const attaching = (plan: Extract<Gate, { at: 'attaching' }>['plan']): Gate => ({ at: 'attaching', attempt: 1, plan, parked: [], asked: [] })
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
    const prompt = { kind: 'prompt', id: promptId('p1'), generation: generation(1), ask: APPROVAL, state: { s: 'waiting', error: null }, deadline: null } as const
    const text = { kind: 'text', markdown: 'Wri', sealed: false } as const
    const session = (items: OpenTurn['items'], announced: string | null, stop: 'none' | 'requested'): SessionContent => ({
      ...live().content,
      run: { state: 'running', generation: generation(1), stop, turn: { id: turnId('t1'), request: null, began: null, items, announced } }
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

describe('when a turn began', () => {
  const beganOf = (state: Tracked) => {
    const { run } = state.content
    if (run.state !== 'running') throw new Error('expected an open run')
    return run.turn.began
  }
  const hermesAt = (at: number) => ({ at, clock: 'hermes' as const })
  const clientAt = (at: number) => ({ at, clock: 'client' as const })
  const dropped = () => feed(live(), { in: 'link.lost' }, { in: 'attach' })
  const catchUp = (state: Tracked, watermark: number, running: boolean, ...parked: SessionInput[]) =>
    feed(state, ...parked, {
      in: 'attached', attempt: 2,
      replay: { snapshotRequired: false, epoch: EPOCH, events: [] },
      snapshot: snapshot({ history: null, running, watermark: { epoch: EPOCH, seq: watermark } })
    })

  it('stamps a live turn.started with the client clock', () => {
    expect(beganOf(feed(live(), event(1, started('t1'), 1, EPOCH, 9_000)))).toEqual(clientAt(9_000))
  })

  it('stamps a turn whose first frame to arrive is not its start', () => {
    expect(beganOf(feed(live(), event(1, delta('Hello'), 1, EPOCH, 9_000)))).toEqual(clientAt(9_000))
  })

  it('leaves a turn started by a frame with no known arrival time unstamped', () => {
    expect(beganOf(feed(live(), event(1, started('t1'))))).toBeNull()
  })

  it('does not move a turn\'s start when later frames arrive', () => {
    expect(beganOf(feed(live(), event(1, started('t1'), 1, EPOCH, 9_000), event(2, delta('Hello'), 1, EPOCH, 12_000), event(3, toolStarted('a'), 1, EPOCH, 15_000)))).toEqual(clientAt(9_000))
  })

  it('leaves a turn opened by a replayed frame unstamped', () => {
    const state = feed(dropped(), {
      in: 'attached', attempt: 2,
      replay: { snapshotRequired: false, epoch: EPOCH, events: [frame(1, started('t1'))] },
      snapshot: snapshot({ history: null, running: true, watermark: { epoch: EPOCH, seq: 1 } })
    })
    expect(beganOf(state)).toBeNull()
  })

  it('leaves a turn opened by a catch-up frame parked at the watermark unstamped', () => {
    expect(beganOf(catchUp(dropped(), 1, true, event(1, started('t1'), 1, EPOCH, 9_000)))).toBeNull()
  })

  it('keeps the stamp of a frame parked past the watermark', () => {
    expect(beganOf(catchUp(dropped(), 1, true, event(1, delta('Hello')), event(2, started('t2', 'Next'), 2, EPOCH, 9_500)))).toEqual(clientAt(9_500))
  })

  it('carries the start over when the turn settles', () => {
    const state = feed(live(), event(1, started('t1'), 1, EPOCH, 9_000), event(2, ended(COMPLETE, 'Done.')))
    expect(state.content.history.map(turn => turn.began)).toEqual([clientAt(9_000)])
  })

  it('opens a turn from a snapshot that shows a running errand with the stored request row\'s time', () => {
    const state = feed(emptyTracked('s1' as SessionId), { in: 'attach' }, {
      in: 'attached', attempt: 1, replay: null,
      snapshot: snapshot({
        running: true,
        history: { turns: [{ ...storedTurn('h1', [1, 2]), began: hermesAt(1_000) }], unfinished: { request: 'Fix the build', began: hermesAt(5_000), items: [] }, older: null }
      })
    })
    expect(beganOf(state)).toEqual(hermesAt(5_000))
    expect(state.content.history.map(turn => turn.began)).toEqual([hermesAt(1_000)])
  })

  it('gives a snapshot\'s running turn no start when there is no stored request row and no earlier start', () => {
    const state = feed(emptyTracked('s1' as SessionId), { in: 'attach' }, { in: 'attached', attempt: 1, replay: null, snapshot: snapshot({ running: true }) })
    expect(beganOf(state)).toBeNull()
  })

  it('keeps the start of the same run through a rebuild that finds no stored request row', () => {
    const rebuilt = feed(live(), event(1, started('t1'), 1, EPOCH, 9_000), { in: 'gap' }, {
      in: 'attached', attempt: 2, replay: null,
      snapshot: snapshot({ running: true, watermark: { epoch: EPOCH, seq: 1 } })
    })
    expect(beganOf(rebuilt)).toEqual(clientAt(9_000))
  })

  it('prefers the stored request row\'s time to the stamp of the same run', () => {
    const rebuilt = feed(live(), event(1, started('t1'), 1, EPOCH, 9_000), { in: 'gap' }, {
      in: 'attached', attempt: 2, replay: null,
      snapshot: snapshot({
        running: true, watermark: { epoch: EPOCH, seq: 1 },
        history: { turns: [], unfinished: { request: 'Tidy the notes', began: hermesAt(8_000), items: [] }, older: null }
      })
    })
    expect(beganOf(rebuilt)).toEqual(hermesAt(8_000))
  })

  it('never lends one run\'s start to another', () => {
    const rebuilt = feed(live(), event(1, started('t1'), 1, EPOCH, 9_000), { in: 'gap' }, {
      in: 'attached', attempt: 2, replay: null,
      snapshot: snapshot({ running: true, generation: generation(2), watermark: { epoch: EPOCH, seq: 1 } })
    })
    expect(beganOf(rebuilt)).toBeNull()
  })

  it('gives a turn left unfinished in a snapshot that is not running the start its stored request has', () => {
    const state = feed(emptyTracked('s1' as SessionId), { in: 'attach' }, {
      in: 'attached', attempt: 1, replay: null,
      snapshot: snapshot({ history: { turns: [], unfinished: { request: 'Fix the build', began: hermesAt(5_000), items: [] }, older: null } })
    })
    expect(state.content.history.map(turn => turn.began)).toEqual([hermesAt(5_000)])
  })
})

describe('the switches Hermes says: effort, fast and YOLO', () => {
  it('starts unknown and takes what a snapshot, a session.info and the user\'s own switch say', () => {
    expect(emptyTracked('s1' as SessionId).content.tuning.yolo).toBeNull()
    const seeded = feed(emptyTracked('s1' as SessionId), { in: 'attach' }, { in: 'attached', attempt: 1, snapshot: snapshot({ tuning: { effort: null, fast: null, yolo: false } }), replay: null })
    expect(seeded.content.tuning.yolo).toBe(false)
    const elsewhere = reduce(seeded, event(1, { type: 'meta', tuning: { yolo: true } }, null))
    expect(elsewhere.content.tuning.yolo).toBe(true)
    expect(reduce(elsewhere, event(2, { type: 'meta', title: 'Renamed' }, null)).content.tuning.yolo).toBe(true)
    const off = reduce(elsewhere, { in: 'local', action: { did: 'tuned', tuning: { yolo: false } } })
    expect(off.content.tuning.yolo).toBe(false)
    expect(reduce(off, { in: 'local', action: { did: 'tuned', tuning: { yolo: false } } })).toBe(off)
  })

  it('takes the effort, fast and folder a session.info pushes, and keeps the switches it does not name', () => {
    const seeded = feed(emptyTracked('s1' as SessionId), { in: 'attach' }, { in: 'attached', attempt: 1, snapshot: snapshot({ tuning: { effort: 'default', fast: false, yolo: false } }), replay: null })
    const moved = reduce(seeded, event(1, { type: 'meta', cwd: '/home/u/docs', tuning: { effort: 'high' } }, null))
    expect(moved.content.cwd).toBe('/home/u/docs')
    expect(moved.content.tuning).toMatchObject({ effort: 'high', fast: false, yolo: false })
    expect(reduce(moved, event(2, { type: 'meta', tuning: { fast: true } }, null)).content.tuning).toMatchObject({ effort: 'high', fast: true })
  })

  it('lets a reattach snapshot overwrite what the chat held', () => {
    const on = reduce(live(), { in: 'local', action: { did: 'tuned', tuning: { yolo: true } } })
    const after = feed(on, { in: 'link.lost' }, { in: 'attach' }, { in: 'attached', attempt: 2, snapshot: snapshot({ tuning: { effort: null, fast: null, yolo: false } }), replay: null })
    expect(after.content.tuning.yolo).toBe(false)
  })
})

describe('the session model', () => {
  const fast: ModelRef = { id: 'fast-small' as ModelId, provider: 'acme' }
  const careful: ModelRef = { id: 'careful-large' as ModelId, provider: 'acme' }
  const deferred = (model: ModelRef, gen: number): SessionInput =>
    ({ in: 'local', action: { did: 'model.deferred', model, during: generation(gen) } })

  it('a model event updates the session model and leaves history and run untouched', () => {
    const before = feed(live(), event(1, started('t1')), event(2, delta('Hello')))
    const after = reduce(before, event(3, { type: 'meta', model: careful }, null))
    expect(after.content.model).toEqual({ current: careful, next: null, ask: null })
    expect(after.content.history).toBe(before.content.history)
    expect(after.content.run).toBe(before.content.run)
  })

  it('takes the model a snapshot names and keeps it when a later snapshot names none', () => {
    const named = feed(emptyTracked('s1' as SessionId), { in: 'attach' }, { in: 'attached', attempt: 1, snapshot: snapshot({ model: fast }), replay: null })
    expect(named.content.model.current).toEqual(fast)
    const rebuilt = feed(named, { in: 'gap' }, { in: 'attached', attempt: 2, snapshot: snapshot({ model: null }), replay: null })
    expect(rebuilt.content.model.current).toEqual(fast)
  })

  it('holds a deferred pick until Hermes names the model, without touching the turn', () => {
    const running = feed(live(), event(1, started('t1')))
    const waiting = reduce(running, deferred(careful, 1))
    expect(waiting.content.model).toEqual({ current: null, next: { model: careful, during: generation(1) }, ask: null })
    expect(waiting.content.run).toBe(running.content.run)
    expect(reduce(waiting, deferred(careful, 1)).content).toBe(waiting.content)
    const landed = feed(
      waiting,
      event(2, ended(COMPLETE)),
      event(3, { type: 'meta', model: careful, revision: 2 }, null),
      event(4, { type: 'meta', model: careful, revision: 2, pick: { is: 'settled' }, generation: generation(2) }, null)
    )
    expect(landed.content.model).toEqual({ current: careful, next: null, ask: null })
    expect(landed.fence.generation).toBe(2)
  })

  it('keeps a held pick when Hermes repeats the model the turn still runs on', () => {
    const waiting = feed(live(), event(1, { type: 'meta', model: fast }, null), event(2, started('t1')), deferred(careful, 1))
    const repeated = reduce(waiting, event(3, { type: 'meta', model: fast, title: 'Tidy notes' }, null))
    expect(repeated.content.model.next).toEqual({ model: careful, during: generation(1) })
  })

  it('asks for a held pick Hermes wants confirmed, and forgets the ask once the pick settles', () => {
    const ask = { model: careful, token: 'tok', message: 'This model costs more.' }
    const asking = feed(live(), event(1, { type: 'meta', model: fast, pick: { is: 'asking', ask } }, null))
    expect(asking.content.model).toEqual({ current: fast, next: null, ask })
    expect(reduce(asking, event(2, { type: 'meta', pick: { is: 'asking', ask } }, null)).content).toBe(asking.content)
    const settled = reduce(asking, event(2, { type: 'meta', model: careful, pick: { is: 'settled' } }, null))
    expect(settled.content.model).toEqual({ current: careful, next: null, ask: null })
  })

  it('drops an ask when a newer pick is held in its place', () => {
    const ask = { model: careful, token: 'tok', message: 'This model costs more.' }
    const local: ModelRef = { id: 'local-7b' as ModelId, provider: 'local' }
    const replaced = feed(live(), event(1, { type: 'meta', model: fast, pick: { is: 'asking', ask } }, null), event(2, started('t2'), 2), deferred(local, 2))
    expect(replaced.content.model).toEqual({ current: fast, next: { model: local, during: generation(2) }, ask: null })
  })

  it('ignores a held pick whose run has already ended', () => {
    const over = feed(live(), event(1, started('t1')), event(2, ended(COMPLETE)))
    expect(reduce(over, deferred(careful, 1)).content).toBe(over.content)
  })

  it('forgets a held pick and an ask when the session is rebuilt, since Hermes asks a new viewer again', () => {
    const ask = { model: careful, token: 'tok', message: 'This model costs more.' }
    const asking = feed(live(), event(1, { type: 'meta', model: fast, pick: { is: 'asking', ask } }, null))
    const rebuilt = feed(asking, { in: 'gap' }, { in: 'attached', attempt: 2, snapshot: snapshot({ model: fast }), replay: null })
    expect(rebuilt.content.model).toEqual({ current: fast, next: null, ask: null })
  })

  it('moves the generation fence to the one session.info names', () => {
    expect(reduce(live(), event(1, { type: 'meta', generation: generation(4) }, null)).fence.generation).toBe(4)
  })

  it('keeps the same content when Hermes repeats the model it already named', () => {
    const named = reduce(live(), event(1, { type: 'meta', model: fast }, null))
    expect(reduce(named, event(2, { type: 'meta', model: { ...fast } }, null)).content).toBe(named.content)
  })
})

describe('token usage', () => {
  const tokens = (input: number, output: number, reasoning = 0): Tokens => ({ input, output, reasoning })
  const fill = (percent: number, estimated = false): ContextFill => ({ used: percent * 2000, max: 200_000, percent, estimated })
  const read = (state: Tracked, usage: SessionUsage): SessionInput => ({ in: 'usage', usage, asked: state.fence.totalsEpoch })
  const turn = (seq: number, gen: number, usage: SessionUsage | null): SessionInput[] =>
    [event(seq, started(`t${gen}`), gen), event(seq + 1, ended(COMPLETE, 'Done.', [], null, usage), gen)]
  const idle = () => {
    const opened = live()
    return reduce(opened, read(opened, { totals: tokens(0, 0), context: fill(3) }))
  }

  it('starts with nothing known', () => {
    expect(live().content.usage).toEqual({ totals: null, context: null })
  })

  it('gives the first turn the counts its end names when the totals before it were read as zero', () => {
    const after = feed(idle(), ...turn(1, 1, { totals: tokens(1204, 380, 412), context: fill(34, true) }))
    expect(after.content.history.at(-1)?.tokens).toEqual(tokens(1204, 380, 412))
    expect(after.content.usage).toEqual({ totals: tokens(1204, 380, 412), context: fill(34, true) })
  })

  it('gives a later turn only what it added to the session totals', () => {
    const after = feed(idle(), ...turn(1, 1, { totals: tokens(1204, 380, 412), context: fill(34) }), ...turn(3, 2, { totals: tokens(2000, 500, 412), context: fill(40) }))
    expect(after.content.history.map(settled => settled.tokens)).toEqual([tokens(1204, 380, 412), tokens(796, 120, 0)])
  })

  it('holds no counts for a turn whose end names no usage, and none for the turn after it', () => {
    const silent = feed(idle(), ...turn(1, 1, null))
    expect(silent.content.history.at(-1)?.tokens).toBeNull()
    expect(silent.content.usage).toEqual({ totals: null, context: fill(3) })
    const next = feed(silent, ...turn(3, 2, { totals: tokens(900, 90), context: null }))
    expect(next.content.history.at(-1)?.tokens).toBeNull()
    expect(next.content.usage).toEqual({ totals: tokens(900, 90), context: fill(3) })
  })

  it('holds no counts for a turn that began before the totals were known', () => {
    const after = feed(live(), ...turn(1, 1, { totals: tokens(1204, 380), context: fill(34) }))
    expect(after.content.history.at(-1)?.tokens).toBeNull()
  })

  it('takes the new totals as the turn\'s own when Hermes started counting again', () => {
    expect(shareOf(tokens(300, 40, 0), tokens(1204, 380, 412))).toEqual(tokens(300, 40, 0))
  })

  it('moves the context fill on a mid-turn tick and leaves the totals the turn is measured from', () => {
    const running = feed(idle(), event(1, started('t1')), event(2, { type: 'usage', context: fill(20) }))
    expect(running.content.usage).toEqual({ totals: tokens(0, 0), context: fill(20) })
    const after = reduce(running, event(3, ended(COMPLETE, 'Done.', [], null, { totals: tokens(700, 70), context: fill(21) })))
    expect(after.content.history.at(-1)?.tokens).toEqual(tokens(700, 70))
  })

  it('takes only the context fill from a read answered while a turn runs', () => {
    const running = feed(idle(), event(1, started('t1')))
    const after = reduce(running, read(running, { totals: tokens(500, 50), context: fill(12) }))
    expect(after.content.usage).toEqual({ totals: tokens(0, 0), context: fill(12) })
  })

  it('does not let a read sent before a turn ended replace the totals or the fill that end set', () => {
    const before = idle()
    const early = read(before, { totals: tokens(0, 0), context: fill(3) })
    const after = reduce(feed(before, ...turn(1, 1, { totals: tokens(1204, 380), context: fill(34) })), early)
    expect(after.content.usage).toEqual({ totals: tokens(1204, 380), context: fill(34) })
  })

  it('measures the turn after a committed model switch from zero, even one queued before the switch', () => {
    const fast = { id: 'fast-small' as ModelId, provider: 'acme' }
    const careful = { id: 'careful-large' as ModelId, provider: 'acme' }
    const before = feed(idle(), event(1, { type: 'meta', model: fast }, null), ...turn(2, 1, { totals: tokens(100, 10), context: fill(5) }))
    const early = read(before, { totals: tokens(100, 10), context: fill(5) })
    const switched = reduce(before, event(4, { type: 'meta', model: careful, pick: { is: 'settled' }, countsRestart: true }, null))
    expect(switched.content.usage.totals).toEqual(tokens(0, 0))
    expect(reduce(switched, early).content.usage.totals).toEqual(tokens(0, 0))
    const after = feed(switched, ...turn(5, 2, { totals: tokens(2000, 100), context: fill(6) }))
    expect(after.content.history.at(-1)?.tokens).toEqual(tokens(2000, 100))
  })

  it('keeps the totals when session.info names another model without a committed switch', () => {
    const before = feed(idle(), ...turn(1, 1, { totals: tokens(100, 10), context: fill(5) }))
    const named = reduce(before, event(3, { type: 'meta', model: { id: 'fallback' as ModelId, provider: null } }, null))
    expect(named.content.usage.totals).toEqual(tokens(100, 10))
  })

  it('forgets the totals when the content is replaced from a snapshot, and keeps the last fill', () => {
    const held = feed(idle(), ...turn(1, 1, { totals: tokens(1204, 380), context: fill(34) }))
    const early = read(held, { totals: tokens(1204, 380), context: fill(34) })
    const rebuilt = feed(held, { in: 'gap' }, { in: 'attached', attempt: 2, snapshot: snapshot({ watermark: { epoch: EPOCH, seq: 9 } }), replay: null })
    expect(rebuilt.content.usage).toEqual({ totals: null, context: fill(34) })
    expect(reduce(rebuilt, early).content.usage.totals).toBeNull()
  })

  it('keeps the same content when a read or a tick repeats what is held', () => {
    const before = idle()
    expect(reduce(before, read(before, { totals: tokens(0, 0), context: fill(3) })).content).toBe(before.content)
    const running = feed(before, event(1, started('t1')))
    expect(reduce(running, event(2, { type: 'usage', context: fill(3) })).content).toBe(running.content)
    expect(reduce(running, event(3, { type: 'usage', context: null })).content).toBe(running.content)
  })
})

describe('modelViewOf', () => {
  const fast = { id: 'fast-small' as ModelId, provider: 'acme', providerName: 'Acme' }
  const careful = { id: 'careful-large' as ModelId, provider: 'acme', providerName: 'Acme' }
  const menu: ModelMenu = { options: [fast, careful], fallback: { id: fast.id, provider: 'acme' } }

  it('hides the control until Hermes lists its models', () => {
    expect(modelViewOf(null, live().content)).toEqual({ show: 'hidden' })
    expect(modelViewOf(menu, undefined)).toEqual({ show: 'hidden' })
  })

  it('says nothing is set up when the list is empty', () => {
    expect(modelViewOf({ options: [], fallback: null }, live().content)).toEqual({ show: 'none' })
  })

  it('falls back to the model Hermes names for the chat until the session names one', () => {
    expect(modelViewOf(menu, live().content)).toMatchObject({ show: 'list', current: menu.fallback, next: null, deferring: false })
  })

  it('shows a deferred pick only while the run it waits on is running', () => {
    const pick: SessionInput = { in: 'local', action: { did: 'model.deferred', model: { id: careful.id, provider: 'acme' }, during: generation(1) } }
    const waiting = feed(live(), event(1, started('t1')), pick)
    expect(modelViewOf(menu, waiting.content)).toMatchObject({ next: { id: careful.id }, deferring: true })
    const over = reduce(waiting, event(2, ended(COMPLETE)))
    expect(modelViewOf(menu, over.content)).toMatchObject({ next: null, deferring: false })
  })

  it('takes the provider from model.options when the session names the same model without one', () => {
    const named = reduce(live(), event(1, { type: 'meta', model: { id: fast.id, provider: null } }, null))
    expect(modelViewOf(menu, named.content)).toMatchObject({ current: { id: fast.id, provider: 'acme' } })
  })

  it('matches a model with no provider to an option of any provider', () => {
    expect(sameModel({ id: fast.id, provider: null }, fast)).toBe(true)
    expect(sameModel({ id: fast.id, provider: 'other' }, fast)).toBe(false)
  })
})

describe('rewinding', () => {
  const held = () => feed(
    emptyTracked('s1' as SessionId), { in: 'attach' },
    { in: 'attached', attempt: 1, snapshot: snapshot({ history: { turns: [storedTurn('a', [1, 2]), storedTurn('b', [3, 4]), storedTurn('c', [5, 6])], unfinished: null, older: null } }), replay: null }
  )
  const rewound = (state: Tracked, rowId: number) => reduce(state, { in: 'local', action: { did: 'rewound', rowId } })

  it('keeps only the turns before the one whose request sits at the row', () => {
    expect(rewound(held(), 3).content.history.map(turn => turn.id)).toEqual(['a'])
    expect(rewound(held(), 1).content.history).toEqual([])
    expect(rewound(held(), 5).content.history.map(turn => turn.id)).toEqual(['a', 'b'])
  })

  it('cuts on a rewind receipt from the stream, so a cut made elsewhere or replayed after a drop shows too', () => {
    const cut = reduce(held(), event(9, { type: 'meta', revision: 2, cutBefore: 3 }, null))
    expect(cut.content.history.map(turn => turn.id)).toEqual(['a'])
    expect(cut.fence.revision).toBe(2)
    expect(reduce(cut, event(10, { type: 'meta', cutBefore: 3 }, null)).content).toBe(cut.content)
  })

  it('does nothing for a row no turn opens', () => {
    const before = held()
    expect(rewound(before, 4)).toBe(before)
    expect(rewound(before, 99)).toBe(before)
  })

  it('learns the row of a request that settled live from the completion receipt', () => {
    const state = feed(live(), event(1, started('t1')), event(2, ended(COMPLETE, 'Done', [7, 8], 7)))
    expect(state.content.history[0]?.request?.rowId).toBe(7)
    expect(rewound(state, 7).content.history).toEqual([])
  })

  it('leaves the row unknown when the receipt names none', () => {
    const state = feed(live(), event(1, started('t1')), event(2, ended(COMPLETE, 'Done', [7, 8])))
    expect(state.content.history[0]?.request?.rowId).toBeNull()
  })
})

describe('reasoning, the plan and helpers', () => {
  const thought = (text: string, whole = false): SessionEvent => ({ type: 'reasoning', text, whole })
  const plan = (revision: number, ...done: string[]): SessionEvent => ({
    type: 'plan', revision, entries: ['1', '2'].map(id => ({ id, text: `step ${id}`, status: done.includes(id) ? 'completed' : 'pending', parentId: null }))
  })
  const helper = (id: string, update: HelperUpdate, over: { parentId?: string; toolCount?: number } = {}): SessionEvent => ({
    type: 'helper', id: id as HelperId, parentId: (over.parentId ?? null) as HelperId | null, depth: over.parentId === undefined ? 0 : 1,
    goal: `goal of ${id}`, toolCount: over.toolCount ?? null, update
  })
  const TOOL: HelperUpdate = { is: 'tool', name: 'terminal', preview: 'du -sh' }
  const DONE: HelperUpdate = { is: 'ended', status: 'completed', durationS: 3, summary: 'Plenty of room.' }
  const at = (seq: number, sessionEvent: SessionEvent, seenAt: number | null, gen = 1) => event(seq, sessionEvent, gen, EPOCH, seenAt)
  const helperIn = (items: readonly Item<'open' | 'settled'>[], id: string) => items.find(item => item.kind === 'helper' && item.id === id)

  describe('reasoning', () => {
    it('streams a block from its first delta, and seals it when the agent moves on to a tool', () => {
      const streaming = feed(live(), event(1, started('t1')), at(2, thought('Disk '), 100), at(3, thought('full?'), 150))
      expect(openItems(streaming)).toEqual([{ kind: 'reasoning', text: 'Disk full?', sealed: false, startedAt: 100, endedAt: null }])
      expect(openItems(reduce(streaming, at(4, toolStarted('ls'), 900)))[0]).toEqual({ kind: 'reasoning', text: 'Disk full?', sealed: true, startedAt: 100, endedAt: 900 })
    })

    it.each<[string, SessionEvent]>([
      ['text', delta('So.')], ['a sealed segment', { type: 'text.sealed', text: null }], ['a tool announced', { type: 'tool.announced', name: 'ls' }],
      ['a tool finished', toolFinished('ls')], ['a prompt', promptOpened('p1')], ['a notice', { type: 'notice', tone: 'info', text: 'Hi' }], ['the plan', plan(1)]
    ])('seals the block on %s', (_, next) => {
      const sealed = feed(live(), event(1, started('t1')), at(2, thought('Hmm'), 100), at(3, next, 200))
      expect(openItems(sealed)[0]).toMatchObject({ kind: 'reasoning', sealed: true, endedAt: 200 })
    })

    it('keeps one block through a helper\'s frames and the spinner, and appends past the helper they pushed', () => {
      const state = feed(
        live(), event(1, started('t1')), event(2, thought('Log says ')), event(3, helper('sa-1', { is: 'queued' })), event(4, { type: 'thinking' }),
        event(5, helper('sa-1', { is: 'working', doing: 'thinking' })), event(6, thought('disk full.'))
      )
      expect(openItems(state).map(item => item.kind)).toEqual(['reasoning', 'helper'])
      expect(openItems(state)[0]).toMatchObject({ text: 'Log says disk full.', sealed: false })
    })

    it('shows a block once when Hermes sends it whole after its deltas, sealed or still open', () => {
      const deltas = feed(live(), event(1, started('t1')), at(2, thought('Plan: '), 100), at(3, thought('check disk'), 110))
      const wholeWhileOpen = reduce(deltas, at(4, thought('Plan: check disk', true), 120))
      expect(openItems(wholeWhileOpen)).toEqual([{ kind: 'reasoning', text: 'Plan: check disk', sealed: true, startedAt: 100, endedAt: 120 }])
      const sealedFirst = feed(deltas, at(4, toolStarted('ls'), 130), at(5, thought('Plan: check disk', true), 140))
      expect(openItems(sealedFirst).filter(item => item.kind === 'reasoning')).toHaveLength(1)
      expect(sealedFirst.content.run).toEqual(reduce(deltas, at(4, toolStarted('ls'), 130)).content.run)
    })

    it('keeps a long streamed block whole when Hermes sends only its first 500 characters', () => {
      const long = `${'disk '.repeat(150)}full.`
      const deltas = feed(live(), event(1, started('t1')), at(2, thought(long), 100))
      const whileOpen = reduce(deltas, at(3, thought(long.slice(0, 500), true), 120))
      expect(openItems(whileOpen)).toEqual([{ kind: 'reasoning', text: long, sealed: true, startedAt: 100, endedAt: 120 }])
      const sealedFirst = feed(deltas, at(3, toolStarted('ls'), 130), at(4, thought(long.slice(0, 500), true), 140))
      expect(openItems(sealedFirst).filter(item => item.kind === 'reasoning')).toEqual([{ kind: 'reasoning', text: long, sealed: true, startedAt: 100, endedAt: 130 }])
    })

    it('pushes a whole block it has not seen as sealed, with no times', () => {
      const state = feed(live(), event(1, started('t1')), at(2, thought('All at once.', true), 100))
      expect(openItems(state)).toEqual([{ kind: 'reasoning', text: 'All at once.', sealed: true, startedAt: null, endedAt: null }])
    })

    it('opens a run for reasoning that arrives first, and ignores an empty delta', () => {
      const state = reduce(live(), event(1, thought('First.')))
      expect(state.content.run).toMatchObject({ state: 'running', generation: 1 })
      expect(reduce(state, event(2, thought(''))).content).toBe(state.content)
    })

    it('seals a block left open when the turn ends, with no end time', () => {
      const state = feed(live(), event(1, started('t1')), at(2, thought('Hmm'), 100), event(3, ended(COMPLETE)))
      expect(state.content.history[0]?.items).toEqual([{ kind: 'reasoning', text: 'Hmm', sealed: true, startedAt: 100, endedAt: null }])
    })
  })

  describe('the plan', () => {
    it('keeps one plan per turn, replaced in place by a newer revision only', () => {
      const first = feed(live(), event(1, started('t1')), event(2, plan(1)), event(3, toolStarted('ls')))
      const newer = reduce(first, event(4, plan(2, '1')))
      expect(openItems(newer).map(item => item.kind)).toEqual(['plan', 'tool'])
      expect(openItems(newer)[0]).toMatchObject({ revision: 2, entries: [{ status: 'completed' }, { status: 'pending' }] })
      expect(openItems(newer)[1]).toBe(openItems(first)[1])
      expect(reduce(newer, event(5, plan(2))).content).toBe(newer.content)
      expect(reduce(newer, event(5, plan(1, '1', '2'))).content).toBe(newer.content)
    })

    it('starts a new plan in the next turn', () => {
      const state = feed(live(), event(1, started('t1')), event(2, plan(1)), event(3, ended(COMPLETE)), event(4, started('t2'), 2), event(5, plan(3), 2))
      expect(state.content.history[0]?.items).toMatchObject([{ kind: 'plan', revision: 1 }])
      expect(openItems(state)).toMatchObject([{ kind: 'plan', revision: 3 }])
    })
  })

  describe('helpers', () => {
    it('puts a helper that starts while the agent writes above the streaming text, and leaves the text open', () => {
      const writing = feed(live(), event(1, started('t1')), event(2, delta('I will check ')))
      const nested = feed(writing, event(3, helper('sa-2', TOOL, { parentId: 'sa-1' })), event(4, delta('the logs.')))
      expect(openItems(nested).map(item => item.kind)).toEqual(['helper', 'text'])
      expect(openItems(nested)[1]).toEqual({ kind: 'text', markdown: 'I will check the logs.', sealed: false })
      const interim = feed(writing, event(3, helper('sa-2', TOOL, { parentId: 'sa-1' })), event(4, { type: 'text.sealed', text: 'I will check the logs.' }))
      expect(openItems(interim).filter(item => item.kind === 'text')).toEqual([{ kind: 'text', markdown: 'I will check the logs.', sealed: true }])
    })

    it('follows a helper from queued to working, through its tools, to its end, keeping the larger tool count', () => {
      const queued = feed(live(), event(1, started('t1')), event(2, helper('sa-1', { is: 'queued' }, { toolCount: 0 })))
      expect(helperIn(openItems(queued), 'sa-1')).toEqual({
        kind: 'helper', id: 'sa-1', parentId: null, depth: 0, goal: 'goal of sa-1', state: { s: 'queued' }, toolCount: 0, steps: []
      })
      const progressed = reduce(queued, event(3, helper('sa-1', { is: 'progress' })))
      expect(helperIn(openItems(progressed), 'sa-1')).toMatchObject({ state: { s: 'working', doing: null } })
      const tooled = feed(progressed, event(4, helper('sa-1', TOOL, { toolCount: 2 })), event(5, helper('sa-1', { is: 'progress' }, { toolCount: 1 })))
      expect(helperIn(openItems(tooled), 'sa-1')).toMatchObject({ state: { s: 'working', doing: 'tool' }, toolCount: 2, steps: [{ kind: 'tool', name: 'terminal', preview: 'du -sh' }] })
      const done = feed(tooled, event(6, helper('sa-1', DONE)), event(7, helper('sa-1', { is: 'working', doing: 'thinking' })), event(8, helper('sa-1', TOOL)))
      expect(helperIn(openItems(done), 'sa-1')).toMatchObject({ state: { s: 'ended', status: 'completed', durationS: 3, summary: 'Plenty of room.' }, steps: [{ kind: 'tool' }] })
    })

    it('starts a helper first heard of mid-tool with that tool as its first step', () => {
      const state = feed(live(), event(1, started('t1')), event(2, helper('sa-1', TOOL)))
      expect(helperIn(openItems(state), 'sa-1')).toMatchObject({ state: { s: 'working', doing: 'tool' }, steps: [{ kind: 'tool', name: 'terminal' }] })
    })

    it('updates a helper in the settled turn that started it, and keeps every other turn\'s identity', () => {
      const settled = feed(
        live(), event(1, started('t1')), event(2, ended(COMPLETE)),
        event(3, started('t2'), 2), event(4, helper('sa-1', { is: 'working', doing: null }), 2), event(5, ended(COMPLETE), 2),
        event(6, started('t3'), 3), event(7, ended(COMPLETE), 3)
      )
      const after = reduce(settled, event(8, helper('sa-1', DONE), null))
      const [before1, before2, before3] = settled.content.history
      const [after1, after2, after3] = after.content.history
      expect(after1).toBe(before1)
      expect(after3).toBe(before3)
      expect(after2).not.toBe(before2)
      expect(helperIn(after2?.items ?? [], 'sa-1')).toMatchObject({ state: { s: 'ended', status: 'completed' } })
      expect(after.content.run).toBe(settled.content.run)
      expect(reduce(after, event(9, helper('sa-1', { is: 'progress' }), null)).content).toBe(after.content)
    })

    it('lands a helper frame of an older generation while a newer run is open', () => {
      const state = feed(
        live(), event(1, started('t1')), event(2, helper('sa-1', { is: 'working', doing: null })), event(3, ended(COMPLETE)), event(4, started('t2'), 2)
      )
      const after = reduce(state, event(5, helper('sa-1', DONE), 1))
      expect(helperIn(after.content.history[0]?.items ?? [], 'sa-1')).toMatchObject({ state: { s: 'ended' } })
      expect(openItems(after)).toEqual([])
    })

    it('drops a frame for a helper it never saw when no run of its generation is open', () => {
      const idle = feed(live(), event(1, started('t1')), event(2, ended(COMPLETE)))
      const unknown = reduce(idle, event(3, helper('sa-9', DONE)))
      expect(unknown.content).toBe(idle.content)
      const newer = feed(idle, event(3, started('t2'), 2))
      expect(reduce(newer, event(4, helper('sa-9', { is: 'queued' }), 1)).content).toBe(newer.content)
      expect(openItems(reduce(newer, event(4, helper('sa-9', { is: 'queued' }), null))).map(item => item.kind)).toEqual(['helper'])
    })

    it('lists a helper\'s own helper as its step once, and keeps it in its parent\'s turn after that turn settled', () => {
      const parent = feed(live(), event(1, started('t1')), event(2, helper('sa-1', { is: 'working', doing: null })))
      const child = feed(parent, event(3, helper('sa-2', { is: 'queued' }, { parentId: 'sa-1' })), event(4, helper('sa-2', { is: 'progress' }, { parentId: 'sa-1' })))
      expect(helperIn(openItems(child), 'sa-1')).toMatchObject({ steps: [{ kind: 'helper', id: 'sa-2' }] })
      expect(helperIn(openItems(child), 'sa-2')).toMatchObject({ parentId: 'sa-1', depth: 1, state: { s: 'working' } })

      const later = feed(parent, event(3, ended(COMPLETE)), event(4, started('t2'), 2), event(5, helper('sa-2', TOOL, { parentId: 'sa-1' }), 2))
      expect(openItems(later)).toEqual([])
      expect(later.content.history[0]?.items.map(item => item.kind === 'helper' ? `${item.id}:${item.steps.map(step => step.kind).join(',')}` : item.kind))
        .toEqual(['sa-1:helper', 'sa-2:tool'])
    })

    it('settles a turn with a working helper as it is: Hermes runs helpers in the background', () => {
      const state = feed(live(), event(1, started('t1')), event(2, helper('sa-1', { is: 'working', doing: null })), event(3, ended(COMPLETE)))
      expect(helperIn(state.content.history[0]?.items ?? [], 'sa-1')).toMatchObject({ state: { s: 'working' } })
    })

    it('does not repeat the answer when a helper joins the turn while the answer streams', () => {
      const state = feed(
        live(), event(1, started('t1')), event(2, helper('sa-1', { is: 'working', doing: null })), event(3, delta('All ')),
        event(4, helper('sa-2', { is: 'queued' }, { parentId: 'sa-1' })), event(5, delta('done.')), event(6, ended(COMPLETE, 'All done.'))
      )
      expect(state.content.history[0]?.items.map(item => item.kind === 'text' ? item.markdown : item.kind)).toEqual(['helper', 'helper', 'All done.'])
    })
  })

  describe('activityOf', () => {
    const tool = { kind: 'tool', id: toolId('a'), name: 'terminal', args: {}, status: { s: 'running', note: null } } as const
    const text = { kind: 'text', markdown: 'Wri', sealed: false } as const
    const reasoning = { kind: 'reasoning', text: 'Hmm', sealed: false, startedAt: null, endedAt: null } as const
    const helping = (id: string, state: HelperItem['state'], parentId: string | null = null): HelperItem =>
      ({ kind: 'helper', id: id as HelperId, parentId: parentId as HelperId | null, depth: parentId === null ? 0 : 1, goal: id, state, toolCount: null, steps: [] })
    const WORKS: HelperItem['state'] = { s: 'working', doing: null }
    const session = (items: OpenTurn['items'], announced: string | null = null): SessionContent => ({
      ...live().content,
      run: { state: 'running', generation: generation(1), stop: 'none', turn: { id: turnId('t1'), request: null, began: null, items, announced } }
    })

    it('ranks working and writing above reasoning, reasoning above helping, and helping above preparing', () => {
      const helper = helping('sa-1', WORKS)
      expect(activityOf(session([reasoning, helper, tool]))).toEqual({ kind: 'working', item: 2 })
      expect(activityOf(session([reasoning, helper, text]))).toEqual({ kind: 'writing' })
      expect(activityOf(session([reasoning, helper]))).toEqual({ kind: 'reasoning', item: 0 })
      expect(activityOf(session([helper], 'read_file'))).toEqual({ kind: 'helping', item: 0 })
      expect(activityOf(session([{ ...reasoning, sealed: true }], 'read_file'))).toEqual({ kind: 'preparing', tool: 'read_file' })
    })

    it('points helping at the newest helper the agent started that has not ended', () => {
      const items = [helping('sa-1', WORKS), helping('sa-2', { s: 'queued' }), helping('sa-3', WORKS, 'sa-1'), helping('sa-4', { s: 'ended', status: 'failed', durationS: null, summary: null })]
      expect(activityOf(session(items))).toEqual({ kind: 'helping', item: 1 })
    })

    it('is idle with a helper still working in a settled turn', () => {
      const state = feed(live(), event(1, started('t1')), event(2, helper('sa-1', { is: 'working', doing: null })), event(3, ended(COMPLETE)))
      expect(activityOf(state.content)).toEqual({ kind: 'idle' })
    })
  })

  it.each<[string, SessionEvent]>([
    ['a reasoning delta', thought('Hmm')], ['a whole reasoning block', thought('Hmm', true)], ['the plan', plan(1)],
    ['a helper queued', helper('sa-1', { is: 'queued' })], ['a helper tool', helper('sa-1', TOOL)], ['a helper end', helper('sa-1', DONE)]
  ])('changes nothing when %s arrives a second time', (_, sessionEvent) => {
    const once = feed(live(), event(1, started('t1')), event(2, helper('sa-1', { is: 'working', doing: null })), at(3, sessionEvent, 100))
    expect(reduce(once, at(3, sessionEvent, 100)).content).toBe(once.content)
  })
})

describe('what Hermes says', () => {
  const status = (text: string, about: StatusAbout = 'goal'): SessionEvent => ({ type: 'status', about, text })
  const shown = (key: string, ttlMs: number | null = null): SessionEvent =>
    ({ type: 'notice.shown', notice: { key, level: 'warn', text: `notice ${key}`, detail: null, ttlMs } })
  const moa = (step: MoaStep): SessionEvent => ({ type: 'moa', step })
  const declined: SessionInput = { in: 'declined', request: { kind: 'bridge', requestId: 'r1' as RequestId, method: 'theme.pick', sessionId: 's1' as SessionId } }
  const verdict = { kind: 'status', what: 'line', about: 'goal', text: 'Goal met.' } as const

  it('keeps a line said while no turn runs in the interlude, and never opens a turn for it', () => {
    const idle = feed(live(), event(1, started('t1')), event(2, ended(COMPLETE)), event(3, status('Goal met.'), null))
    expect(idle.content.run).toEqual({ state: 'idle' })
    expect(idle.content.interlude).toEqual([verdict])
    expect(idle.content.history).toHaveLength(1)
  })

  it('files a request declined while idle in the interlude, once, and leaves the run idle', () => {
    const once = feed(live(), declined)
    expect(once.content.run).toEqual({ state: 'idle' })
    expect(once.content.interlude).toEqual([{ kind: 'notice', what: 'declined', requestId: 'r1', method: 'theme.pick' }])
    expect(reduce(once, declined).content).toBe(once.content)
  })

  it('seals the interlude into the history as one entry when the next turn starts', () => {
    const said = feed(live(), event(1, status('Goal met.'), null), declined)
    const next = reduce(said, event(2, started('t2'), 2))
    expect(next.content.interlude).toEqual([])
    expect(next.content.history).toEqual([{
      id: 'interlude:2', request: null, began: null, rows: [], outcome: { kind: 'interlude' }, tokens: null, reply: null,
      items: [verdict, { kind: 'notice', what: 'declined', requestId: 'r1', method: 'theme.pick' }]
    }])
    expect(openItems(next)).toEqual([])
  })

  it('puts a line said during a turn into that turn, and the turn\'s settle leaves the interlude alone', () => {
    const running = feed(live(), event(1, started('t1')), event(2, status('Compacting…', 'compacting')))
    expect(openItems(running)).toEqual([{ kind: 'status', what: 'line', about: 'compacting', text: 'Compacting…' }])
    const settled = reduce(running, event(3, ended(COMPLETE)))
    expect(settled.content.interlude).toEqual([])
    expect(settled.content.history[0]?.items).toEqual([{ kind: 'status', what: 'line', about: 'compacting', text: 'Compacting…' }])
  })

  it('keeps one line per compaction, from progress to done', () => {
    const state = feed(live(), event(1, started('t1')),
      event(2, status('Compacting…', 'compacting')), event(3, status('Still compacting…', 'compacting')), event(4, status('Compacted.', 'compacted')),
      event(5, status('Compacted.', 'compacted')))
    expect(openItems(state)).toEqual([
      { kind: 'status', what: 'line', about: 'compacted', text: 'Compacted.' },
      { kind: 'status', what: 'line', about: 'compacted', text: 'Compacted.' }
    ])
  })

  it('keeps the text it is streaming whole when a line is said between deltas, so an interim replaces all of it', () => {
    const interim: SessionEvent = { type: 'text.sealed', text: 'Reading the notes now.' }
    const state = feed(live(), event(1, started('t1')), event(2, delta('Reading ')), event(3, status('Compacting…', 'compacting')),
      event(4, shown('credits')), event(5, delta('the notes')), event(6, interim))
    expect(openItems(state)).toEqual([
      { kind: 'status', what: 'line', about: 'compacting', text: 'Compacting…' },
      { kind: 'status', what: 'notice', key: 'credits', level: 'warn', text: 'notice credits', detail: null, ttlMs: null, seenAt: null, state: 'shown' },
      { kind: 'text', markdown: 'Reading the notes now.', sealed: true }
    ])
  })

  it('keeps the reasoning block it is streaming whole when a line is said inside it, and the text after the line', () => {
    const thought = (text: string): SessionEvent => ({ type: 'reasoning', text, whole: false })
    const state = feed(live(), event(1, started('t1')), event(2, thought('Look at '), 1, EPOCH, 100), event(3, status('Compacting…', 'compacting')),
      event(4, thought('the notes.'), 1, EPOCH, 200), event(5, delta('Reading '), 1, EPOCH, 300), event(6, shown('credits')), event(7, delta('them.')))
    expect(openItems(state)).toEqual([
      { kind: 'reasoning', text: 'Look at the notes.', sealed: true, startedAt: 100, endedAt: 300 },
      { kind: 'status', what: 'line', about: 'compacting', text: 'Compacting…' },
      { kind: 'status', what: 'notice', key: 'credits', level: 'warn', text: 'notice credits', detail: null, ttlMs: null, seenAt: null, state: 'shown' },
      { kind: 'text', markdown: 'Reading them.', sealed: false }
    ])
  })

  it('drops the interlude on a rebuild, since Hermes stores none of it', () => {
    const said = feed(live(), event(1, status('Goal met.'), null))
    const rebuilt = feed(said, { in: 'gap' }, { in: 'attached', attempt: 2, snapshot: snapshot({ watermark: { epoch: EPOCH, seq: 1 } }), replay: null })
    expect(rebuilt.content.interlude).toEqual([])
  })

  it('folds a MoA round into one item until it aggregates, and starts the next round as a new item', () => {
    const state = feed(live(), event(1, started('t1')),
      event(2, moa({ is: 'progress', done: 1, total: 2 })), event(3, moa({ is: 'progress', done: 2, total: 2 })),
      event(4, moa({ is: 'reference', label: 'a', text: 'Use rm.' })), event(5, moa({ is: 'reference', label: 'b', text: 'Use trash.' })),
      event(6, moa({ is: 'aggregating', by: 'judge' })), event(7, moa({ is: 'aggregating', by: 'judge' })),
      event(8, moa({ is: 'progress', done: 0, total: 2 })))
    expect(openItems(state)).toEqual([
      { kind: 'moa', progress: { done: 2, total: 2 }, references: [{ label: 'a', text: 'Use rm.' }, { label: 'b', text: 'Use trash.' }], phase: { is: 'aggregating', by: 'judge' } },
      { kind: 'moa', progress: { done: 0, total: 2 }, references: [], phase: { is: 'advising' } }
    ])
    expect(reduce(state, event(7, moa({ is: 'aggregating', by: 'judge' }))).content).toBe(state.content)
  })

  it('replaces a keyed notice wherever it sits and marks it cleared on notification.clear', () => {
    const first = feed(live(), event(1, started('t1')), event(2, shown('credits'), 1, EPOCH, 1_000), event(3, ended(COMPLETE)))
    const again = reduce(first, event(4, shown('credits'), null, EPOCH, 2_000))
    expect(again.content.history[0]?.items).toEqual([
      { kind: 'status', what: 'notice', key: 'credits', level: 'warn', text: 'notice credits', detail: null, ttlMs: null, seenAt: 1_000, state: 'cleared' }
    ])
    expect(again.content.interlude).toEqual([
      { kind: 'status', what: 'notice', key: 'credits', level: 'warn', text: 'notice credits', detail: null, ttlMs: null, seenAt: 2_000, state: 'shown' }
    ])
    const cleared = reduce(again, event(5, { type: 'notice.cleared', key: 'credits' }, null))
    expect(cleared.content.interlude).toMatchObject([{ key: 'credits', state: 'cleared' }])
    expect(cleared.content.history[0]).toBe(again.content.history[0])
    expect(reduce(cleared, event(6, { type: 'notice.cleared', key: 'credits' }, null)).content).toBe(cleared.content)
  })

  it('clears an older notice of the same key when its replacement, heard through replay, has outlived its time', () => {
    const sticky = reduce(live(), event(1, shown('credits'), null, EPOCH, 1_000))
    const replaced = reduce(sticky, event(2, shown('credits', 5_000), null))
    expect(replaced.content.interlude).toMatchObject([{ key: 'credits', ttlMs: null, state: 'cleared' }])
  })

  it('drops a notice with a time to live that was heard through replay, and keeps one that stays until cleared', () => {
    expect(reduce(live(), event(1, shown('slow', 5_000), null)).content.interlude).toEqual([])
    expect(reduce(live(), event(1, shown('slow', 5_000), null, EPOCH, 10)).content.interlude).toMatchObject([{ key: 'slow', ttlMs: 5_000, seenAt: 10 }])
    expect(reduce(live(), event(1, shown('sticky'), null)).content.interlude).toMatchObject([{ key: 'sticky', ttlMs: null, seenAt: null }])
  })

  it('gives a prompt heard live a deadline from Hermes\'s timeout, and one heard through replay none', () => {
    const asked: SessionEvent = { type: 'prompt.opened', id: promptId('p1'), generation: generation(1), ask: APPROVAL, timeoutS: 60 }
    expect(openItems(feed(live(), event(1, started('t1')), event(2, asked, 1, EPOCH, 5_000)))).toMatchObject([{ kind: 'prompt', deadline: 65_000 }])
    expect(openItems(feed(live(), event(1, started('t1')), event(2, asked)))).toMatchObject([{ kind: 'prompt', deadline: null }])
    const settled = feed(live(), event(1, started('t1')), event(2, asked, 1, EPOCH, 5_000), event(3, ended(COMPLETE)))
    expect(settled.content.history[0]?.items).toMatchObject([{ kind: 'prompt', state: { s: 'withdrawn' }, deadline: null }])
  })

  it('gives a prompt found in a snapshot no deadline', () => {
    const state = feed(emptyTracked('s1' as SessionId), { in: 'attach' }, {
      in: 'attached', attempt: 1, replay: null,
      snapshot: snapshot({ running: true, prompts: [{ id: promptId('p1'), generation: generation(1), ask: APPROVAL }, { id: promptId('p2'), generation: generation(1), ask: APPROVAL }] })
    })
    expect(openItems(state).map(item => item.kind === 'prompt' && item.deadline)).toEqual([null, null])
  })
})

describe('tuning', () => {
  it('takes facts read under the current attach, and drops facts read under an older one', () => {
    const state = live()
    expect(state.content.tuning).toEqual({ reasoning: null, busy: null, effort: null, fast: null, yolo: null })
    const read = reduce(state, { in: 'facts', attempt: 1, heard: UNHEARD, tuning: { reasoning: true } })
    expect(read.content.tuning).toEqual({ reasoning: true, busy: null, effort: null, fast: null, yolo: null })
    const reattached = feed(read, { in: 'link.lost' }, { in: 'attach' })
    expect(reduce(reattached, { in: 'facts', attempt: 1, heard: UNHEARD, tuning: { reasoning: false } }).content).toBe(reattached.content)
    expect(reduce(reattached, { in: 'facts', attempt: 2, heard: UNHEARD, tuning: { reasoning: false } }).content.tuning).toEqual({ reasoning: false, busy: null, effort: null, fast: null, yolo: null })
  })

  it('takes a switch this client set, keeps it through a rebuild, and changes nothing when it is the same', () => {
    const tuned = reduce(live(), { in: 'local', action: { did: 'tuned', tuning: { reasoning: true } } })
    expect(tuned.content.tuning).toEqual({ reasoning: true, busy: null, effort: null, fast: null, yolo: null })
    expect(reduce(tuned, { in: 'local', action: { did: 'tuned', tuning: { reasoning: true } } }).content).toBe(tuned.content)
    const rebuilt = feed(tuned, { in: 'gap' }, { in: 'attached', attempt: 2, snapshot: snapshot(), replay: null })
    expect(rebuilt.content.tuning).toEqual({ reasoning: true, busy: null, effort: null, fast: null, yolo: null })
  })
})

describe('a rewrite of the stored rows', () => {
  it('reads the chat again from a live gate, as a replay gap does', () => {
    const rewritten = feed(live(), event(1, started('t1')), event(2, delta('Hello')), event(3, { type: 'meta', revision: 4, rewritten: true }, null))
    expect(rewritten.gate).toMatchObject({ at: 'attaching', plan: { mode: 'rebuild' } })
    expect(syncOf(rewritten.gate, { state: 'online' }).state).toBe('rebuilding')
  })

  it('takes a rewrite heard in a replay as a reason to rebuild instead of catching up', () => {
    const reattaching = feed(live(), { in: 'link.lost' }, { in: 'attach' })
    const after = reduce(reattaching, {
      in: 'attached', attempt: 2, snapshot: snapshot({ watermark: { epoch: EPOCH, seq: 1 } }),
      replay: { snapshotRequired: false, epoch: EPOCH, events: [{ stamp: { epoch: EPOCH, seq: 1, generation: null }, event: { type: 'meta', revision: 4, rewritten: true }, seenAt: null }] }
    })
    expect(after.gate).toMatchObject({ at: 'attaching', plan: { mode: 'rebuild' } })
  })
})

describe('side questions and background prompts', () => {
  const started = (id: string, kind: SideTask['kind'] = 'btw', asked = 'Which file was it?'): SessionInput =>
    ({ in: 'local', action: { did: 'side.started', id: id as SideId, kind, asked } })
  const answered = (seq: number, id: string, text: string, kind: SideTask['kind'] = 'btw', asked: string | null = 'Which file was it?'): SessionInput =>
    event(seq, { type: 'side.answered', id: id as SideId, kind, asked, text }, null)

  it('runs from the reply that names the task until its answer, which arrives whole', () => {
    const running = feed(live(), started('btw_1'))
    expect(running.content.sides).toEqual([{ id: 'btw_1', kind: 'btw', asked: 'Which file was it?', state: { s: 'running' } }])
    const done = reduce(running, answered(1, 'btw_1', 'notes.md'))
    expect(done.content.sides).toEqual([{ id: 'btw_1', kind: 'btw', asked: 'Which file was it?', state: { s: 'done', text: 'notes.md' } }])
    expect(reduce(done, started('btw_1')), 'a late reply changes nothing').toBe(done)
  })

  it("keeps an answer that came before the reply, and one to another client's task", () => {
    const early = feed(live(), answered(1, 'btw_1', 'notes.md'), started('btw_1'))
    expect(early.content.sides).toMatchObject([{ id: 'btw_1', state: { s: 'done', text: 'notes.md' } }])
    const earlyBackground = feed(live(), answered(1, 'bg_2', 'Tidied.', 'background', null), started('bg_2', 'background', 'Tidy the notes'))
    expect(earlyBackground.content.sides, 'its reply fills in what was asked').toEqual([{ id: 'bg_2', kind: 'background', asked: 'Tidy the notes', state: { s: 'done', text: 'Tidied.' } }])
    const theirs = reduce(live(), answered(1, 'bg_9', 'Tidied.', 'background', null))
    expect(theirs.content.sides).toEqual([{ id: 'bg_9', kind: 'background', asked: null, state: { s: 'done', text: 'Tidied.' } }])
  })

  it('marks a running one lost when the chat is read again, keeps the answered ones, and takes an answer that still comes', () => {
    const before = feed(live(), started('btw_1'), answered(1, 'btw_1', 'notes.md'), started('bg_2', 'background', 'Tidy the notes'))
    const rebuilt = feed(before, { in: 'gap' }, { in: 'attached', attempt: 2, snapshot: snapshot(), replay: null })
    expect(rebuilt.content.sides.map(side => [side.id, side.state.s])).toEqual([['btw_1', 'done'], ['bg_2', 'lost']])
    expect(reduce(rebuilt, answered(1, 'bg_2', 'Tidied.', 'background', null)).content.sides[1]).toMatchObject({ asked: 'Tidy the notes', state: { s: 'done', text: 'Tidied.' } })
  })

  it('keeps a running one through a replayed reattach, which delivers its answer', () => {
    const before = feed(live(), started('btw_1'), { in: 'link.lost' }, { in: 'attach' })
    const caughtUp = reduce(before, {
      in: 'attached', attempt: 2, snapshot: snapshot({ watermark: { epoch: EPOCH, seq: 1 } }),
      replay: { snapshotRequired: false, epoch: EPOCH, events: [{ stamp: { epoch: EPOCH, seq: 1, generation: null }, event: { type: 'side.answered', id: 'btw_1' as SideId, kind: 'btw', asked: 'Which file was it?', text: 'notes.md' }, seenAt: null }] }
    })
    expect(caughtUp.content.sides).toMatchObject([{ id: 'btw_1', state: { s: 'done', text: 'notes.md' } }])
  })
})
