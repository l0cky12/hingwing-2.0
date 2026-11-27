import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { activityOf } from '../src/domain/reduce'
import type { Session, SettledTurn } from '../src/domain/session'
import { loadFixture, play, playToEnd, type Fixture, type Moment } from '../src/testing/fixture'
import { errand, fold, ignoringStartTimes } from './support/story'

const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/errand.jsonl', import.meta.url)))
const want = fold(errand()).content
const pushes = fixture.steps.filter(step => 'push' in step).length
const stepOf = (method: string) => fixture.steps.findIndex(step => 'await' in step && step.await === method)

const LIVE = { ...want, sync: { state: 'live' } } satisfies Session
const methodsOf = (received: readonly unknown[]) => received.flatMap(frame => {
  const { method, params } = frame as { method?: string; params?: Record<string, unknown> }
  return method === undefined || method === 'gateway.ping' ? [] : [{ method, params }]
})

async function moments(played: Fixture, options?: Parameters<typeof play>[1]): Promise<Moment[]> {
  const seen: Moment[] = []
  for await (const moment of play(played, options)) seen.push(moment)
  return seen
}

describe('the errand, played through the real client', () => {
  it('ends in the session the direct fold gives', async () => {
    const played = await playToEnd(fixture)
    expect(ignoringStartTimes(played)).toEqual(LIVE)
    expect(played.history[0]?.began).toEqual({ at: expect.any(Number), clock: 'client' })
  })

  it('opens with the handshake, one resume with history, the three lists, the slash catalog, the relay probe, the bots, the group chats and the watched chat\'s facts, then makes the story\'s two calls', async () => {
    const { script, session } = (await moments(fixture)).at(-1) as Moment
    expect(script.dials).toBe(1)
    const sent = methodsOf(script.received)
    expect(sent.map(call => call.method)).toEqual([
      'client.capabilities', 'runtime.describe', 'session.resume', 'session.list', 'session.list', 'session.list', 'commands.catalog', 'bot_relay.deliver', 'profiles.list', 'groups.capabilities',
      'session.stats', 'config.get', 'config.get', 'config.get', 'session.control.read', 'process.list', 'display.status', 'session.stats', 'prompt.submit', 'approval.respond', 'session.stats', 'process.list'
    ])
    expect(sent.splice(16, 1).map(call => call.params), "the open chat's bot is asked after its screen once, as the socket's own profile").toEqual([{}])
    expect(sent.splice(14, 2).map(call => call.params), 'the panel is read with the switches').toEqual([{ session_id: fixture.header.sessionId }, { session_id: fixture.header.sessionId }])
    expect(sent.splice(11, 3).map(call => call.params)).toEqual(['show_reasoning', 'busy', 'approval_mode'].map(key => ({ session_id: fixture.header.sessionId, key })))
    expect(sent.splice(9, 1).map(call => call.params), 'the errand\'s Hermes has no group chats, so it is asked nothing more').toEqual([{}])
    expect(session.tuning, 'the errand\'s Hermes refuses every read, so the switches stay unknown').toEqual({ reasoning: null, busy: null, effort: null, fast: null, yolo: null, approvals: null })
    expect([session.processes, session.control], 'and every panel read, so the panel stays unknown').toEqual([null, null])
    expect(sent[2]?.params).toEqual({ session_id: fixture.header.sessionId, display_projection: true })
    expect(sent.slice(3, 6).map(call => call.params)).toEqual([
      { scope: 'live', picker: true }, { scope: 'live', include_hidden: true }, { scope: 'stored', limit: 100, include_hidden: true, picker: true }
    ])
    expect(sent[6]?.params).toEqual({})
    expect(sent[7]?.params, 'the relay probe').toEqual({})
    expect(sent[8]?.params).toEqual({ include_sessions: true })
    expect(sent[11]?.params, 'the gateway sends batches, so the submit asks for them').toEqual({ ...(fixture.steps[stepOf('prompt.submit')] as { params: object }).params, clarify_batch: true })
    expect(sent[12]?.params).toEqual((fixture.steps[stepOf('approval.respond')] as { params: unknown }).params)
  })

  it('yields the session at every step that changed it', async () => {
    const seen = await moments(fixture)
    const steps = seen.map(moment => moment.step)
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
    expect(new Set(steps).size).toBeGreaterThan(30)
    expect(seen[0]?.session.sync.state).toBe('offline')
    expect(ignoringStartTimes(seen.at(-1)!.session)).toEqual(LIVE)

    const asking = seen.find(moment => activityOf(moment.session).kind === 'asking')
    expect(asking?.step, 'the approval card is up while the story waits for the answer').toBe(stepOf('approval.respond'))
    const working = seen.findIndex(moment => activityOf(moment.session).kind === 'working')
    expect(working).toBeGreaterThan(-1)
    expect(working).toBeLessThan(seen.indexOf(asking as Moment))
    expect(seen.find(moment => moment.session.queue.length > 0)?.session, 'the sent message is a row of Hermes\'s queue, and has left the outbox').toMatchObject({
      queue: [{ from: 'here', state: { s: 'queued' } }], outbox: []
    })
  })
})

describe('a socket drop after every push of the errand, played through the real client', () => {
  it.each(Array.from({ length: pushes }, (_, index) => index + 1))('drop after push %i, 3 missed, ends in the undisturbed session', async afterPush => {
    const seen = await moments(fixture, { drop: { afterPush, missed: 3 } })
    const { session, script } = seen.at(-1) as Moment
    expect(ignoringStartTimes(session)).toEqual(LIVE)

    expect(script.dials, 'one redial').toBe(2)
    const states = seen.map(moment => moment.session.sync.state)
    expect(states, 'the session was offline, then caught up').toEqual(expect.arrayContaining(['offline', 'catching-up']))
    expect(states, 'replay covered the gap, so nothing was rebuilt').not.toContain('rebuilding')

    const sent = methodsOf(script.received)
    const since = sent.findIndex(call => call.method === 'session.events.since')
    expect(sent.filter(call => call.method === 'session.events.since'), 'one replay request').toHaveLength(1)
    expect(sent[since + 1], 'the resume is the very next frame the gateway reads').toEqual({
      method: 'session.resume', params: { session_id: fixture.header.sessionId, omit_messages: true, defer_history: true }
    })
    expect(sent.filter(call => call.method === 'session.resume'), 'the first open and the re-attach').toHaveLength(2)
  })
})

describe('a replay ring too small for the gap', () => {
  it('answers snapshot_required, and the session rebuilds from the snapshot into a settled turn', async () => {
    const seen = await moments(fixture, { drop: { afterPush: 12, missed: 6 }, ringFrames: 2 })
    const { session, script } = seen.at(-1) as Moment
    const states = seen.map(moment => moment.session.sync.state)
    expect(states.indexOf('rebuilding')).toBeGreaterThan(states.indexOf('catching-up'))

    const resumes = methodsOf(script.received).filter(call => call.method === 'session.resume').map(call => call.params)
    expect(resumes, 'open, re-attach, then the rebuild with history').toMatchObject([
      { display_projection: true }, { omit_messages: true }, { display_projection: true }
    ])

    expect(session.sync).toEqual({ state: 'live' })
    expect(session.run).toEqual({ state: 'idle' })
    expect(session.outbox).toEqual([])
    expect(session.history).toHaveLength(1)
    const turn = session.history[0] as SettledTurn
    expect(turn.outcome).toEqual({ kind: 'complete' })
    expect(turn.request?.text).toBe(want.history[0]?.request?.text)
    expect(turn.rows).toEqual(want.history[0]?.rows)
    expect(turn.items.at(-1)).toMatchObject({ kind: 'text', sealed: true })
    expect(turn.items.length, 'the frames lost for good are not in the rebuilt turn').toBeLessThan(want.history[0]?.items.length ?? 0)
    expect(turn.items.some(item => item.kind === 'prompt' && item.state.s === 'answered')).toBe(true)
  })
})
