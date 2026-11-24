import { randomUUID } from 'node:crypto'
import type { PromptId, Session, SessionId } from '../domain/session'
import { openHermes, type Command, type Hermes } from '../hub'
import { systemClock } from '../wire/link'
import { manualClock } from './clock'
import type { Fixture, FixtureStep } from './fixture'
import { scriptedDialer, type ScriptedDialer, type ScriptOptions } from './script'

type Recorded = Readonly<Record<string, unknown>>
type AwaitStep = Extract<FixtureStep, { await: string }>

const recorded = (step: AwaitStep): Recorded => (step.params !== null && typeof step.params === 'object' ? step.params as Recorded : {})

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
  'session.interrupt': sessionId => ({ do: 'stop', sessionId })
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
 * Plays a fixture through `openHermes` with a stand-in user: when the story awaits `prompt.submit`,
 * `approval.respond`, `clarify.respond` or `session.interrupt`, it issues the matching `Command` with the
 * recorded text or choice. A rewind is one command for the `session.mutate` step and the `prompt.submit` after it. Yields the session after every step that changed it, so a test can assert on
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
  const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-play', version: '0' }, mintId: () => ids.shift() ?? randomUUID() })

  const moments: { readonly step: number; readonly session: Session }[] = []
  const asked = new Set<number>()
  let failure: unknown = null
  script.done.catch((error: unknown) => { failure = error })
  const unwatch = hermes.watch(sessionId, session => moments.push({ step: script.step, session }))

  const user = (session: Session) => {
    const index = script.step
    const step = fixture.steps[index]
    if (step === undefined || !('await' in step) || session.sync.state !== 'live' || asked.has(index)) return
    const command = USER[step.await]?.(sessionId, recorded(step), fixture, fixture.steps.slice(index + 1).find(next => 'await' in next))
    if (command === undefined) throw new Error(`step ${index}: the stand-in user has no command for ${step.await}`)
    asked.add(index)
    if (command.do === 'rewind') asked.add(fixture.steps.findIndex((next, at) => at > index && 'await' in next))
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
        const waiting = step !== undefined && 'await' in step ? `waiting for ${step.await}` : 'with no viewer attached'
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
