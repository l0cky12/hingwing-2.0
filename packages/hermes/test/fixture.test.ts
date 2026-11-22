import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type FixtureStep, loadFixture } from '../src/testing/fixture'
import { checkParams } from '../src/testing/params'
import { GATEWAY_EVENT_TYPES } from '../src/wire/contract.generated'

const ERRAND = fileURLToPath(new URL('../../../fixtures/errand.jsonl', import.meta.url))

/** Event types the canonical gateway sends that the generated contract leaves out. */
const HAND_TYPED = ['approval.request', 'approval.settled', 'clarify.request', 'clarify.settled', 'session.replay_gap', 'session.updated']
/** Published by `TurnRunner._step_callback_sync` (gateway/run_turn_progress.py:1092) and declared nowhere in 0.23.3. */
const UNDECLARED = ['agent.step']
const KNOWN_TYPES = new Set<string>([...GATEWAY_EVENT_TYPES, ...HAND_TYPED, ...UNDECLARED])

/** The keys `SessionEvents.publish` puts on an event's params: the execution stamp, then the frame's own. */
const ENVELOPE_KEYS = new Set(['authority_epoch', 'execution_generation', 'admission_id', 'type', 'session_id', 'payload', 'replay_epoch', 'seq'])

interface EventParams {
  readonly type: string
  readonly session_id?: string
  readonly seq?: number
  readonly replay_epoch?: string
  readonly payload: Record<string, unknown>
}

const fixture = loadFixture(ERRAND)
const pushes = fixture.steps.flatMap(step => ('push' in step ? [step.push as { jsonrpc: string; method: string; params: EventParams }] : []))
const events = pushes.map(frame => frame.params)
const awaits = fixture.steps.filter((step): step is Extract<FixtureStep, { await: string }> => 'await' in step)

describe('the errand fixture', () => {
  it('loads with a header for a new session', () => {
    expect(fixture.header).toMatchObject({ fixture: 1, hermes: '0.23.3', source: 'generated', stored: [] })
    expect(pushes.length).toBeGreaterThan(30)
  })

  it('pushes only canonical event notifications', () => {
    for (const frame of pushes) {
      expect(Object.keys(frame).sort()).toEqual(['jsonrpc', 'method', 'params'])
      expect(frame).toMatchObject({ jsonrpc: '2.0', method: 'event' })
      expect(KNOWN_TYPES, frame.params.type).toContain(frame.params.type)
      expect([...Object.keys(frame.params)].filter(key => !ENVELOPE_KEYS.has(key)), frame.params.type).toEqual([])
      expect(frame.params.payload).toBeTypeOf('object')
    }
  })

  it('stamps every session event with the session, a seq one past the last and one replay epoch', () => {
    const [first] = events
    expect(first?.replay_epoch).toMatch(/^[0-9a-f]{32}$/)
    events.forEach((event, index) => {
      expect(event.session_id, event.type).toBe(fixture.header.sessionId)
      expect(event.replay_epoch, event.type).toBe(first?.replay_epoch)
      expect(event.seq, event.type).toBe(index + 1)
    })
  })

  it('records every call with the key set the gateway accepts', () => {
    expect(awaits.map(step => step.await)).toEqual(['prompt.submit', 'approval.respond'])
    for (const step of awaits) expect(checkParams(step.await, step.params), step.await).toEqual([])
  })

  it('answers the approval with the prompt\'s own id and generation, then settles it', () => {
    const request = events.find(event => event.type === 'approval.request')
    const answer = awaits.find(step => step.await === 'approval.respond')
    expect(answer?.params).toEqual({
      session_id: fixture.header.sessionId, choice: 'once',
      prompt_id: request?.payload.prompt_id, execution_generation: request?.payload.execution_generation
    })
    const afterAnswer = fixture.steps.slice(fixture.steps.indexOf(answer as FixtureStep) + 1)
    expect(afterAnswer.find(step => 'push' in step)).toMatchObject({
      push: { params: { type: 'approval.settled', payload: { prompt_id: request?.payload.prompt_id } } }
    })
  })

  it('ends the turn with a completion receipt, then the stored rows', () => {
    const complete = events.find(event => event.type === 'message.complete')
    expect(complete?.payload).toMatchObject({ status: 'complete', persisted_turn: { complete: true } })
    expect(fixture.steps.at(-1)).toHaveProperty('stored')
  })
})

describe('checkParams', () => {
  const answer = { session_id: 's', execution_generation: 1, prompt_id: 'p', choice: 'once' }

  it('refuses an unknown key and a missing key on a canonical method', () => {
    expect(checkParams('approval.respond', { ...answer, all: true })).toEqual(['all'])
    expect(checkParams('prompt.submit', { session_id: 's' })).toEqual(['text'])
  })

  it('knows no method the contract does not declare', () => {
    expect(checkParams('approval.answer', answer)).toBeUndefined()
  })
})

describe('loadFixture', () => {
  const write = (lines: readonly unknown[]) => {
    const path = join(mkdtempSync(join(tmpdir(), 'fixture-')), 'bad.jsonl')
    writeFileSync(path, lines.map(line => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n')
    return path
  }
  const header = { fixture: 1, hermes: '0.23.3', source: 'generated', sessionId: 's', describe: {}, list: {}, stored: [] }

  it('names the line of a step that is not JSON', () => {
    const path = write([header, { at: 0, stored: [] }, '{"at": 1, "push"'])
    expect(() => loadFixture(path)).toThrow(`${path}:3: not JSON`)
  })

  it('names the line of the prototype\'s envelope', () => {
    const path = write([header, { at: 0, push: { kind: 'event', type: 'message.delta', session_id: 's', seq: 1, payload: {} } }])
    expect(() => loadFixture(path)).toThrow(`${path}:2: "push" must be a JSON-RPC 2.0 frame with a method`)
  })
})
