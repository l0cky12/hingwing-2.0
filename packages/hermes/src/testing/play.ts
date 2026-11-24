import { randomUUID } from 'node:crypto'
import type { Answer, HermesRequest, PromptId, RequestId, RequestReply, Session, SessionId } from '../domain/session'
import { openHermes, type Command, type Hermes, type Upload } from '../hub'
import { systemClock } from '../wire/link'
import { manualClock } from './clock'
import { MASKED, type Fixture, type FixtureStep } from './fixture'
import { scriptedDialer, type ScriptedDialer, type ScriptOptions } from './script'

type Recorded = Readonly<Record<string, unknown>>
type AwaitStep = Extract<FixtureStep, { await: string }>
type AnswerStep = Extract<FixtureStep, { answer: string }>

const record = (value: unknown): Recorded => (value !== null && typeof value === 'object' ? value as Recorded : {})
const recorded = (step: AwaitStep): Recorded => record(step.params)

function lockedAnswer(raw: unknown): Answer {
  if (typeof raw !== 'string') return null
  try {
    const picks: unknown = JSON.parse(raw)
    return Array.isArray(picks) && picks.every(pick => typeof pick === 'string') ? picks : [raw]
  } catch {
    return [raw]
  }
}

function cardReply(result: Recorded): RequestReply {
  const [target] = Array.isArray(result.targets) ? result.targets.map(record) : []
  if (target === undefined) return { kind: 'skip' }
  const values = target.env === undefined ? {} : { values: record(target.env) as { readonly [field: string]: string } }
  return { kind: 'connect', target: String(target.name), as: target.status === 'approved' ? 'approved' : 'skipped', ...values }
}

const USER: Readonly<Record<string, (sessionId: SessionId, params: Recorded, fixture: Fixture, following: FixtureStep | undefined) => Command>> = {
  'prompt.submit': (sessionId, params) => ({ do: 'send', sessionId, text: String(params.text) }),
  'session.mutate': (sessionId, params, fixture, following) => {
    const rowId = (params.payload as { target_message_id?: unknown } | undefined)?.target_message_id
    if (params.operation !== 'rewind' || typeof rowId !== 'number') throw new Error(`the stand-in user has no command for session.mutate ${String(params.operation)}`)
    const sends = following !== undefined && 'await' in following && following.await === 'prompt.submit'
    const stored = fixture.header.stored.find(row => (row as { row_id?: unknown }).row_id === rowId) as { text?: unknown } | undefined
    return { do: 'rewind', sessionId, rowId, text: String(sends ? recorded(following).text : stored?.text) }
  },
  'approval.respond': (sessionId, params) => ({ do: 'answer', sessionId, promptId: params.prompt_id as PromptId, reply: { kind: 'choice', value: String(params.choice) } }),
  'clarify.respond': (sessionId, params) => ({ do: 'answer', sessionId, promptId: params.prompt_id as PromptId, reply: { kind: 'text', value: String(params.answer) } }),
  'session.interrupt': sessionId => ({ do: 'stop', sessionId }),
  'clarify.lock': (sessionId, params) => ({
    do: 'answer', sessionId, requestId: params.request_id as RequestId, reply: { kind: 'lock', question: String(params.question_id), answer: lockedAnswer(params.answer) }
  }),
  'connection.respond': (sessionId, params) => ({ do: 'answer', sessionId, requestId: params.op_id as RequestId, reply: cardReply(record(params.result)) })
}

const TYPED = 'typed by the stand-in user'

function requestReply({ ask }: HermesRequest, result: Recorded): RequestReply {
  if (ask.kind !== 'secret' || result.value !== MASKED) return { kind: 'skip' }
  return { kind: 'secret', value: TYPED, ...(ask.for.is === 'login' ? { identifier: TYPED } : {}) }
}

function commandFor(step: AwaitStep | AnswerStep, session: Session, index: number, fixture: Fixture): Command | null {
  const { id: sessionId } = session
  if ('await' in step) {
    const command = USER[step.await]?.(sessionId, recorded(step), fixture, fixture.steps.slice(index + 1).find(next => 'await' in next))
    if (command === undefined) throw new Error(`step ${index}: the stand-in user has no command for ${step.await}`)
    return command
  }
  const request = session.requests.find(held => held.id === step.answer)
  if ('error' in step || request === undefined || request.state.s !== 'waiting') return null
  return { do: 'answer', sessionId, requestId: request.id, reply: requestReply(request, record(step.result)) }
}

const mintedIn = (step: AwaitStep): unknown => recorded(step).input_id ?? recorded(step).request_id

const STUCK_MS = 10 * 60_000
const LOOPBACK = { turnMs: 2, stuckMs: 20_000 } as const

export interface PlayOptions extends Omit<ScriptOptions, 'timing' | 'clock'> {
  /**
   * When the play is over, once the story has played every step. Default: the session is live.
   * Over a real socket the last frames are still on their way when the story ends, so a test that
   * reads the final session passes the session it waits for.
   */
  readonly ended?: (session: Session) => boolean
  /** Files the stand-in user attaches to its first message. The hub reads them from here. */
  readonly attach?: readonly Upload[]
  /** Called with each command the stand-in user ran and what the hub answered. */
  readonly answered?: (command: Command, outcome: Awaited<ReturnType<Hermes['run']>>) => void
}

export interface Moment {
  /** The index of the step the story was at when the session changed. */
  readonly step: number
  readonly session: Session
  readonly hermes: Hermes
  readonly script: ScriptedDialer
}

/**
 * Plays a fixture through `openHermes` with a stand-in user: when the story awaits a call or an
 * answer to a server request, it issues the matching `Command` with the recorded text or choice.
 * In place of a masked value it types one of its own. A rewind is one command for the `session.mutate`
 * step and the `prompt.submit` after it. Yields the session after every step that changed it, so a test can assert on
 * any moment of a turn, not only its end. Ends when the story is over and the session is live.
 * `script` is the gateway's side: what the client sent it, and how often it dialed.
 *
 * Time is virtual in memory: the client's timers (backoff, heartbeat) run as soon as nothing else
 * can, so a play with a drop takes no real second. Over a real socket the system clock runs.
 */
export async function* play(fixture: Fixture, options: PlayOptions = {}): AsyncGenerator<Moment> {
  const { sessionId } = fixture.header
  const ended = options.ended ?? (session => session.sync.state === 'live')
  const virtual = (options.transport ?? 'memory') === 'memory' ? manualClock() : null
  const clock = virtual ?? systemClock
  const script = scriptedDialer(fixture, { ...options, timing: 'instant', clock })
  const ids = fixture.steps.flatMap(step => ('await' in step && typeof mintedIn(step) === 'string' ? [mintedIn(step) as string] : []))
  const attach = options.attach ?? []
  let attached = attach.length === 0
  const hermes = openHermes({
    dial: script, clock, client: { name: 'highwing-play', version: '0' }, mintId: () => ids.shift() ?? randomUUID(),
    uploads: { read: async id => attach.find(upload => upload.id === id) ?? null }
  })

  const moments: { readonly step: number; readonly session: Session }[] = []
  const asked = new Set<number>()
  let failure: unknown = null
  script.done.catch((error: unknown) => { failure = error })
  const unwatch = hermes.watch(sessionId, session => moments.push({ step: script.step, session }))

  const user = (session: Session) => {
    const index = script.step
    const step = fixture.steps[index]
    if (step === undefined || !('await' in step || 'answer' in step) || session.sync.state !== 'live' || asked.has(index)) return
    const typed = commandFor(step, session, index, fixture)
    if (typed === null) return
    const command: Command = typed.do === 'send' && !attached ? { ...typed, attachments: attach.map(upload => upload.id) } : typed
    if (command.do === 'send') attached = true
    asked.add(index)
    const sendAfter = command.do === 'rewind' ? fixture.steps.findIndex((next, at) => at > index && 'await' in next) : -1
    if (sendAfter >= 0) asked.add(sendAfter)
    void hermes.run(command).then(outcome => {
      options.answered?.(command, outcome)
      if (!outcome.ok) asked.delete(index)
    })
  }

  try {
    const startedAt = clock.now()
    for (let latest: Session | undefined, progressAt = startedAt; ;) {
      if (virtual !== null) await virtual.next()
      else await new Promise<void>(resolve => void clock.setTimeout(resolve, LOOPBACK.turnMs))
      if (failure !== null) throw failure
      if (moments.length > 0) progressAt = clock.now()
      for (const moment of moments.splice(0)) {
        latest = moment.session
        yield { ...moment, hermes, script }
      }
      if (latest !== undefined) user(latest)
      if (script.finished && latest !== undefined && ended(latest)) return
      if (clock.now() - progressAt > (virtual === null ? LOOPBACK.stuckMs : STUCK_MS)) {
        const step = fixture.steps[script.step]
        const waiting = step === undefined || 'push' in step || 'stored' in step || 'drop' in step
          ? 'with no viewer attached'
          : `waiting for ${'await' in step ? step.await : `an answer to ${step.answer}`}`
        throw new Error(`the story is stuck at step ${script.step} of ${fixture.steps.length}, ${waiting}. The session is ${latest?.sync.state ?? 'unseen'}.`)
      }
    }
  } finally {
    unwatch()
    await hermes.close()
    await script.close()
  }
}

/** The last value `play` yields. */
export async function playToEnd(fixture: Fixture, options?: PlayOptions): Promise<Session> {
  let last: Session | undefined
  for await (const { session } of play(fixture, options)) last = session
  if (last === undefined) throw new Error('the play published no session')
  return last
}
