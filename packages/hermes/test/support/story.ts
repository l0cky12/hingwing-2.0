import { loadFixture, type Fixture, type FixtureStep } from '../../src/testing/fixture'
import type { Admission } from '../../src/domain/queue'
import { parseCorrection, parseEvent, parseFast, parsePending, parseRows, parseServerRequest } from '../../src/wire/parse'
import {
  emptyTracked, reduce,
  type Cursor, type SessionInput, type Snapshot, type StampedEvent, type Tracked
} from '../../src/domain/reduce'
import type { Generation, InputId, Item, PromptId, RequestId, SessionContent, SessionId, SettledTurn, SideId } from '../../src/domain/session'

export type Beat =
  | { readonly kind: 'frame'; readonly frame: StampedEvent }
  | { readonly kind: 'user'; readonly inputs: readonly SessionInput[] }
  /** From here on Hermes stores these rows, which a rebuild reads. */
  | { readonly kind: 'stored'; readonly rows: readonly unknown[] }

export interface Story {
  readonly fixture: Fixture
  readonly sessionId: SessionId
  readonly epoch: string
  readonly beats: readonly Beat[]
  readonly frames: readonly StampedEvent[]
}

const local = (action: Extract<SessionInput, { in: 'local' }>['action']): SessionInput => ({ in: 'local', action })

type Call = Extract<FixtureStep, { await: string }>

function userInputs({ await: method, params: sent, reply: answered }: Call, next: Call | undefined): SessionInput[] {
  const params = sent as Record<string, unknown>
  const reply = answered as Record<string, unknown> | undefined
  switch (method) {
    case 'prompt.cancel':
    case 'prompt.steer_queued':
    case 'prompt.resolve_unknown':
      return []
    case 'prompt.replace_queued':
      return [local({ did: 'send', inputId: params.submission_id as InputId, text: params.text as string, attachments: [] })]
    case 'session.steer':
    case 'session.redirect': {
      const text = params.text as string
      const taken = parseCorrection(answered as Parameters<typeof parseCorrection>[0]) === 'taken'
        ? [local({ did: 'steered', text, during: params.execution_generation as Generation })]
        : []
      const denial = next?.await === 'approval.respond' ? next.params as Record<string, unknown> : null
      return denial?.choice === 'deny' ? [local({ did: 'answer', promptId: denial.prompt_id as PromptId, reply: { kind: 'deny', tell: text } }), ...taken] : taken
    }
    case 'prompt.submit': {
      const inputId = params.input_id as InputId
      return [
        local({ did: 'send', inputId, text: params.text as string, attachments: [] }),
        local({ did: 'send.admitted', inputId, admissionId: reply?.admission_id as string })
      ]
    }
    case 'approval.respond': {
      const promptId = params.prompt_id as PromptId
      return [
        local({ did: 'answer', promptId, reply: { kind: 'choice', value: params.choice as string } }),
        local({ did: 'answer.resolved', promptId, byUs: true })
      ]
    }
    case 'clarify.lock': {
      const requestId = params.request_id as RequestId
      const answer = typeof params.answer !== 'string' ? null : params.answer.startsWith('[') ? JSON.parse(params.answer) as string[] : [params.answer]
      return [
        local({ did: 'answer', requestId, reply: { kind: 'lock', question: params.question_id as string, answer } }),
        local({ did: 'answer.accepted', requestId, then: (reply?.remaining as unknown[]).length === 0 ? 'settles' : 'waits' })
      ]
    }
    case 'prompt.btw':
    case 'prompt.background':
      return [local({ did: 'side.started', id: reply?.task_id as SideId, kind: method === 'prompt.btw' ? 'btw' : 'background', asked: params.text as string })]
    case 'config.set':
      return [local({ did: 'tuned', tuning: params.key === 'fast' ? { fast: parseFast(reply ?? {}) } : { yolo: reply?.value === '1' } })]
    case 'session.mutate':
      if (params.operation === 'rewind') throw new Error('the direct fold has no rewind')
      return []
    case 'complete.path':
    case 'session.export':
      return []
    case 'connection.respond': {
      const requestId = params.op_id as RequestId
      return [local({ did: 'answer', requestId, reply: { kind: 'withheld' } }), local({ did: 'answer.accepted', requestId, then: reply?.settled === true ? 'settles' : 'waits' })]
    }
    default:
      throw new Error(`the stand-in user has no command for ${method}`)
  }
}

function requestInputs(push: { readonly id: string; readonly method: string; readonly params: unknown }): SessionInput[] {
  const request = parseServerRequest(push)
  switch (request.kind) {
    case 'card': return [{ in: 'request', request, seenAt: 0 }]
    case 'bridge': return [{ in: 'declined', request }]
    case 'unusable': return []
  }
}

function answerInputs(step: Extract<FixtureStep, { answer: string }>): SessionInput[] {
  if ('error' in step) return []
  const { value } = step.result as { value?: string }
  return [local({ did: 'answer', requestId: step.answer as RequestId, reply: { kind: value === undefined || value === '' ? 'skip' : 'withheld' } })]
}

export function readStory(path: string): Story {
  const fixture = loadFixture(path)
  const beats: Beat[] = []
  let epoch: string | null = null
  for (const step of fixture.steps) {
    if ('push' in step) {
      const push = step.push as { id: string; method: string; params: unknown }
      if (push.method !== 'event') {
        beats.push({ kind: 'user', inputs: requestInputs(push) })
        continue
      }
      const parsed = parseEvent(push.params)
      if (parsed.scope !== 'session' || parsed.sessionId !== fixture.header.sessionId)
        throw new Error(`push ${JSON.stringify(step.push).slice(0, 120)} is not a frame of the fixture's session`)
      epoch ??= parsed.stamp.epoch
      beats.push({ kind: 'frame', frame: { stamp: parsed.stamp, event: parsed.event, seenAt: null } })
    } else if ('await' in step) {
      const isCall = (other: FixtureStep): other is Call => 'await' in other
      beats.push({ kind: 'user', inputs: userInputs(step, fixture.steps.slice(fixture.steps.indexOf(step) + 1).find(isCall)) })
    } else if ('answer' in step) {
      beats.push({ kind: 'user', inputs: answerInputs(step) })
    } else if ('stored' in step) {
      beats.push({ kind: 'stored', rows: step.stored })
    }
  }
  if (epoch === null) throw new Error('fixture has no frames')
  const frames = beats.flatMap(beat => (beat.kind === 'frame' ? [beat.frame] : []))
  return { fixture, sessionId: fixture.header.sessionId, epoch, beats, frames }
}

export function snapshotAfter(story: Story, published: readonly StampedEvent[], subscriptionId: string, history: Snapshot['history']): Snapshot {
  let running = false
  let generation = 0
  let title = ''
  let revision = 0
  let queue: readonly Admission[] = parsePending(story.fixture.header.pending ?? [])
  const header = parseEvent({ type: 'session.info', session_id: story.sessionId, seq: 1, replay_epoch: story.epoch, payload: story.fixture.header.info ?? {} })
  const attached = header.scope === 'session' && header.event?.type === 'meta' ? header.event : { tuning: {}, cwd: undefined }
  let said: Snapshot['tuning'] = { effort: null, fast: null, yolo: null, ...attached.tuning }
  let cwd: string | null = attached.cwd ?? null
  const prompts = new Map<PromptId, Snapshot['prompts'][number]>()
  for (const { stamp, event } of published) {
    if (stamp.generation !== null) generation = stamp.generation
    if (event === null) continue
    switch (event.type) {
      case 'turn.started': running = true; break
      case 'turn.ended': running = false; prompts.clear(); break
      case 'prompt.opened': prompts.set(event.id, { id: event.id, generation: event.generation, ask: event.ask }); break
      case 'prompt.settled': prompts.delete(event.id); break
      case 'prompts.cancelled': for (const id of event.ids) prompts.delete(id); break
      case 'meta':
        if (event.title !== undefined) title = event.title
        if (event.revision !== undefined) revision = event.revision
        if (event.queue !== undefined) queue = event.queue
        if (event.tuning !== undefined) said = { ...said, ...event.tuning }
        if (event.cwd !== undefined) cwd = event.cwd
        break
    }
  }
  const last = published.at(-1)
  const watermark: Cursor = { epoch: story.epoch, seq: last ? last.stamp.seq : 0 }
  return {
    id: story.sessionId, title, cwd, model: null, tuning: said, running, generation: generation as Generation, revision, subscriptionId,
    watermark, queue, prompts: [...prompts.values()], history, openRequests: []
  }
}

function attempt(state: Tracked): number {
  if (state.gate.at !== 'attaching') throw new Error(`expected an attaching gate, got ${state.gate.at}`)
  return state.gate.attempt
}

function open(story: Story): Tracked {
  const attaching = reduce(emptyTracked(story.sessionId), { in: 'attach' })
  const rows = parseRows(story.fixture.header.stored)
  const snapshot = snapshotAfter(story, [], 'sub-1', { ...rows, older: null })
  return reduce(attaching, { in: 'attached', attempt: attempt(attaching), snapshot, replay: null })
}

export interface Moment { readonly beat: number; readonly state: Tracked }

/** Every beat in order. A rebuild the beats start (a rewrite of the stored rows) is answered with the rows Hermes stores by then. */
export function fold(story: Story, onMoment?: (moment: Moment) => void): Tracked {
  let state = open(story)
  let stored = story.fixture.header.stored
  const published: StampedEvent[] = []
  story.beats.forEach((beat, index) => {
    if (beat.kind === 'frame') {
      published.push(beat.frame)
      state = reduce(state, { in: 'event', frame: beat.frame })
    } else if (beat.kind === 'stored') {
      stored = beat.rows
    } else {
      state = beat.inputs.reduce(reduce, state)
    }
    if (state.gate.at === 'attaching') {
      const snapshot = snapshotAfter(story, published, `sub-${state.gate.attempt}`, { ...parseRows(stored), older: null })
      state = reduce(state, { in: 'attached', attempt: state.gate.attempt, snapshot, replay: null })
    }
    onMoment?.({ beat: index, state })
  })
  return state
}

export function foldWithDrop(story: Story, afterFrame: number, missed: number): Tracked {
  let state = open(story)
  let seen = 0
  let index = 0
  const published: StampedEvent[] = []
  const play = (beat: Beat) => {
    if (beat.kind === 'frame') {
      published.push(beat.frame)
      state = reduce(state, { in: 'event', frame: beat.frame })
      seen++
    } else if (beat.kind === 'user') {
      state = beat.inputs.reduce(reduce, state)
    }
  }
  for (; index < story.beats.length && seen < afterFrame; index++) play(story.beats[index]!)

  state = reduce(state, { in: 'link.lost' })
  const lost: StampedEvent[] = []
  for (; index < story.beats.length && lost.length < missed; index++) {
    const beat = story.beats[index]!
    if (beat.kind !== 'frame') break
    lost.push(beat.frame)
    published.push(beat.frame)
  }

  state = reduce(state, { in: 'attach' })
  const catchUp = lost.length > 1 ? lost.at(-1)! : null
  const replayed = catchUp ? lost.slice(0, -1) : lost
  if (catchUp) state = reduce(state, { in: 'event', frame: catchUp })
  const snapshot = snapshotAfter(story, published, 'sub-2', null)
  state = reduce(state, {
    in: 'attached', attempt: attempt(state), snapshot,
    replay: { snapshotRequired: false, epoch: story.epoch, events: replayed }
  })
  if (state.gate.at !== 'live') throw new Error(`drop after frame ${afterFrame}: gate is ${state.gate.at} after re-attach, expected live`)

  for (; index < story.beats.length; index++) play(story.beats[index]!)
  return state
}

export const ignoringStartTimes = <T extends { readonly history: readonly SettledTurn[] }>(session: T): T =>
  ({ ...session, history: session.history.map(turn => ({ ...turn, began: null })) })

export const errand = () => readStory(new URL('../../../../fixtures/errand.jsonl', import.meta.url).pathname)
export const delegate = () => readStory(new URL('../../../../fixtures/delegate.jsonl', import.meta.url).pathname)
export const says = () => readStory(new URL('../../../../fixtures/says.jsonl', import.meta.url).pathname)
export const asks = () => readStory(new URL('../../../../fixtures/asks.jsonl', import.meta.url).pathname)
export const queue = () => readStory(new URL('../../../../fixtures/queue.jsonl', import.meta.url).pathname)
export const commands = () => readStory(new URL('../../../../fixtures/commands.jsonl', import.meta.url).pathname)

export const ignoringClocks = <T extends { readonly history: readonly SettledTurn[]; readonly interlude: SessionContent['interlude'] }>(session: T): T => {
  const unclocked = <I extends Item<'settled'>>(item: I): I =>
    item.kind === 'status' && item.what === 'notice' ? { ...item, seenAt: null }
      : item.kind === 'reasoning' ? { ...item, startedAt: null, endedAt: null }
        : item
  return {
    ...session,
    history: session.history.map(turn => ({ ...turn, began: null, items: turn.items.map(unclocked) })),
    interlude: session.interlude.map(unclocked)
  }
}
