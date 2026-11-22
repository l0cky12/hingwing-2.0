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

/** What the stand-in user does when the story waits for a call: the fixture's recorded params, as the command a window would send. */
const USER: Readonly<Record<string, (sessionId: SessionId, params: Recorded) => Command>> = {
  'prompt.submit': (sessionId, params) => ({ do: 'send', sessionId, text: String(params.text) }),
  'approval.respond': (sessionId, params) => ({ do: 'answer', sessionId, promptId: params.prompt_id as PromptId, reply: { kind: 'choice', value: String(params.choice) } }),
  'clarify.respond': (sessionId, params) => ({ do: 'answer', sessionId, promptId: params.prompt_id as PromptId, reply: { kind: 'text', value: String(params.answer) } }),
  'session.interrupt': sessionId => ({ do: 'stop', sessionId })
}

/** The keys the client mints fresh, in the order the story's calls use them. */
const mintedIn = (step: AwaitStep): unknown => recorded(step).input_id ?? recorded(step).request_id

/** Story time with nothing happening before a play gives up, far past any backoff or heartbeat. */
const STUCK_MS = 10 * 60_000
const LOOPBACK = { turnMs: 2, stuckMs: 20_000 } as const

/**
 * Plays a fixture through `openHermes` with a stand-in user: when the story awaits `prompt.submit`,
 * `approval.respond`, `clarify.respond` or `session.interrupt`, it issues the matching `Command` with the
 * recorded text or choice. Yields the session after every step that changed it, so a test can assert on
 * any moment of a turn, not only its end. Ends when the story is over and the session is live.
 * `script` is the gateway's side: what the client sent it, and how often it dialed.
 *
 * Time is virtual in memory: the client's timers (backoff, heartbeat) run as soon as nothing else
 * can, so a play with a drop takes no real second. Over loopback the system clock runs.
 */
export interface Moment {
  /** The index of the step the story was at when the session changed. */
  readonly step: number
  readonly session: Session
  readonly hermes: Hermes
  readonly script: ScriptedDialer
}

export async function* play(fixture: Fixture, options: Omit<ScriptOptions, 'timing' | 'clock'> = {}): AsyncGenerator<Moment> {
  const { sessionId } = fixture.header
  const virtual = options.transport === 'loopback' ? null : manualClock()
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
    const command = USER[step.await]?.(sessionId, recorded(step))
    if (command === undefined) throw new Error(`step ${index}: the stand-in user has no command for ${step.await}`)
    asked.add(index)
    // A refusal means the client was not ready for it (the socket dropped, the prompt has not arrived). It is asked again.
    void hermes.run(command).then(outcome => { if (!outcome.ok) asked.delete(index) })
  }

  try {
    const startedAt = clock.now()
    for (let latest: Session | undefined, progressAt = startedAt; ;) {
      if (virtual !== null) await virtual.next()
      else await new Promise(resolve => setTimeout(resolve, LOOPBACK.turnMs))
      if (failure !== null) throw failure
      if (moments.length > 0) progressAt = clock.now()
      for (const moment of moments.splice(0)) {
        latest = moment.session
        yield { ...moment, hermes, script }
      }
      if (latest !== undefined) user(latest)
      if (script.finished && latest?.sync.state === 'live') return
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
export async function playToEnd(fixture: Fixture, options?: Omit<ScriptOptions, 'timing' | 'clock'>): Promise<Session> {
  let last: Session | undefined
  for await (const { session } of play(fixture, options)) last = session
  if (last === undefined) throw new Error('the play published no session')
  return last
}
