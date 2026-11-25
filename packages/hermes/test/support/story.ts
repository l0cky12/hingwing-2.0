import { loadFixture, type Fixture } from '../../src/testing/fixture'
import { parseEvent, parseRows } from '../../src/wire/parse'
import {
  emptyTracked, reduce,
  type Admission, type Cursor, type SessionInput, type Snapshot, type StampedEvent, type Tracked
} from '../../src/domain/reduce'
import type { Generation, InputId, PromptId, SessionId, SettledTurn } from '../../src/domain/session'

export type Beat =
  | { readonly kind: 'frame'; readonly frame: StampedEvent }
  | { readonly kind: 'user'; readonly inputs: readonly SessionInput[] }

export interface Story {
  readonly fixture: Fixture
  readonly sessionId: SessionId
  readonly epoch: string
  readonly beats: readonly Beat[]
  readonly frames: readonly StampedEvent[]
}

const local = (action: Extract<SessionInput, { in: 'local' }>['action']): SessionInput => ({ in: 'local', action })

function userInputs(method: string, params: Record<string, unknown>, reply: Record<string, unknown> | undefined): SessionInput[] {
  switch (method) {
    case 'prompt.submit': {
      const inputId = params.input_id as InputId
      return [
        local({ did: 'send', inputId, text: params.text as string, attachments: [] }),
        local({ did: 'send.admitted', inputId, admissionId: reply?.admission_id as string, status: reply?.status as Admission['status'] })
      ]
    }
    case 'approval.respond': {
      const promptId = params.prompt_id as PromptId
      return [
        local({ did: 'answer', promptId, reply: { kind: 'choice', value: params.choice as string } }),
        local({ did: 'answer.resolved', promptId, byUs: true })
      ]
    }
    default:
      throw new Error(`the stand-in user has no command for ${method}`)
  }
}

export function readStory(path: string): Story {
  const fixture = loadFixture(path)
  const beats: Beat[] = []
  let epoch: string | null = null
  for (const step of fixture.steps) {
    if ('push' in step) {
      const parsed = parseEvent((step.push as { params: unknown }).params)
      if (parsed.scope !== 'session' || parsed.sessionId !== fixture.header.sessionId)
        throw new Error(`push ${JSON.stringify(step.push).slice(0, 120)} is not a frame of the fixture's session`)
      epoch ??= parsed.stamp.epoch
      beats.push({ kind: 'frame', frame: { stamp: parsed.stamp, event: parsed.event, seenAt: null } })
    } else if ('await' in step) {
      beats.push({ kind: 'user', inputs: userInputs(step.await, step.params as Record<string, unknown>, step.reply as Record<string, unknown> | undefined) })
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
  let queue: readonly Admission[] = []
  let yolo: boolean | null = null
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
        if (event.yolo !== undefined) yolo = event.yolo
        break
    }
  }
  const last = published.at(-1)
  const watermark: Cursor = { epoch: story.epoch, seq: last ? last.stamp.seq : 0 }
  return {
    id: story.sessionId, title, cwd: null, model: null, yolo, running, generation: generation as Generation, revision, subscriptionId,
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

export function fold(story: Story, onMoment?: (moment: Moment) => void): Tracked {
  let state = open(story)
  story.beats.forEach((beat, index) => {
    state = beat.kind === 'frame'
      ? reduce(state, { in: 'event', frame: beat.frame })
      : beat.inputs.reduce(reduce, state)
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
    } else {
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
