import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '../src/domain/reduce'
import type { FileDiff, ToolResult } from '../src/domain/session'
import { loadFixture } from '../src/testing/fixture'
import type { CanonicalPendingPrompt } from '../src/wire/contract.generated'
import { GATEWAY_EVENT_TYPES } from '../src/wire/contract.generated'
import { parseEvent, parseInlineDiff, parseToolResult, SHOWN, UNSHOWN } from '../src/wire/parse'

const ERRAND = fileURLToPath(new URL('../../../fixtures/errand.jsonl', import.meta.url))

interface Params {
  readonly type: string
  readonly session_id: string
  readonly seq: number
  readonly replay_epoch: string
  readonly execution_generation?: number
  readonly payload: { readonly [key: string]: unknown }
}

const fixture = loadFixture(ERRAND)
const SESSION = fixture.header.sessionId
const params = fixture.steps.flatMap(step => ('push' in step ? [(step.push as { params: Params }).params] : []))
const EPOCH = params[0]?.replay_epoch ?? ''
const REQUEST = 'In /tmp/hermes-proto-work: make notes.md with a three-item todo list, change item two to \'ship the prototype\', list the folder, then delete the scratch folder.'

function only<T>(values: readonly T[]): T {
  expect(values).toHaveLength(1)
  return values[0] as T
}

/** The event a frame of the fixture parses to, failing when it is not a shown session frame. */
function eventOf(frame: Params): SessionEvent {
  const parsed = parseEvent(frame)
  if (parsed.scope !== 'session' || parsed.event === null) throw new Error(`${frame.type} seq ${frame.seq} did not parse to an event: ${JSON.stringify(parsed)}`)
  return parsed.event
}

function finished(tool: string): Extract<SessionEvent, { type: 'tool.finished' }>[] {
  return params.filter(frame => frame.type === 'tool.complete' && frame.payload.name === tool).map(frame => {
    const event = eventOf(frame)
    if (event.type !== 'tool.finished') throw new Error(`tool.complete parsed to ${event.type}`)
    return event
  })
}

describe('parseEvent on the errand fixture', () => {
  it('routes every push to the fixture session with the envelope seq, epoch and generation', () => {
    for (const frame of params) {
      const parsed = parseEvent(frame)
      expect(parsed, frame.type).toMatchObject({
        scope: 'session',
        sessionId: SESSION,
        type: frame.type,
        stamp: { epoch: frame.replay_epoch, seq: frame.seq, generation: frame.execution_generation ?? null }
      })
    }
  })

  it('leaves the generation empty on the session.info published before the turn is claimed', () => {
    const [submitted] = params
    expect(submitted?.type).toBe('session.info')
    expect(parseEvent(submitted)).toMatchObject({ stamp: { generation: null } })
  })

  it('parses every message, tool and approval frame to an event, and skips agent.step as unshown', () => {
    for (const frame of params.filter(({ type }) => /^(message|tool|approval)\./.test(type))) expect(eventOf(frame), `seq ${frame.seq}`).not.toBeNull()
    for (const frame of params.filter(({ type }) => type === 'agent.step')) expect(parseEvent(frame)).toMatchObject({ event: null, skipped: 'unshown' })
  })

  it('starts the turn from an empty message.start with the envelope admission id', () => {
    const start = only(params.filter(({ type }) => type === 'message.start'))
    expect(eventOf(start)).toEqual({ type: 'turn.started', turnId: null, admissionId: 'e07cb5793e7f497bbcc1c0c8b0cdf20a', requestText: null })
  })

  it('places each delta at its segment and UTF-16 offset, and seals on a null delta', () => {
    const deltas = params.filter(({ type }) => type === 'message.delta')
    expect(eventOf(deltas[1] as Params)).toEqual({ type: 'text.delta', text: 'le first, then make the ', at: { segment: 0, offset: 24 } })
    const seals = deltas.filter(frame => frame.payload.text === null)
    expect(seals).toHaveLength(4)
    for (const seal of seals) expect(eventOf(seal)).toEqual({ type: 'text.sealed', text: null })
  })

  it('reads the write_file diff as a new notes.md with five lines added', () => {
    const { diffs, result, durationS } = only(finished('write_file'))
    const diff = only(diffs)
    expect(diff).toMatchObject({ path: '/tmp/hermes-proto-work/notes.md', createsFile: true, added: 5, removed: 0 })
    expect(diff.lines).toEqual([
      { t: 'hunk', text: '@@ -0,0 +1,5 @@' },
      { t: 'add', text: '# Todo' },
      { t: 'add', text: '' },
      { t: 'add', text: '- [ ] sketch the chat view' },
      { t: 'add', text: '- [ ] wire the gateway socket' },
      { t: 'add', text: '- [ ] review screenshots' }
    ])
    expect(durationS).toBeCloseTo(0.016)
    expect(result).toMatchObject({ kind: 'text', isError: false, clipped: 0 })
  })

  it('reads the patch diff as one line removed and one added', () => {
    const diff = only(only(finished('patch')).diffs)
    expect(diff).toMatchObject({ path: '/tmp/hermes-proto-work/notes.md', createsFile: false, added: 1, removed: 1 })
    expect(diff.lines.filter(line => line.t !== 'ctx')).toEqual([
      { t: 'hunk', text: '@@ -1,5 +1,5 @@' },
      { t: 'del', text: '- [ ] wire the gateway socket' },
      { t: 'add', text: '- [ ] ship the prototype' }
    ])
  })

  it('reads terminal results as commands with their exit code and no ANSI', () => {
    const [listing, removal] = finished('terminal')
    expect(listing?.result).toMatchObject({ kind: 'command', exitCode: 0, clipped: 0 })
    expect(listing?.result.kind === 'command' && listing.result.output).toContain('notes.md')
    expect(removal?.result).toEqual({ kind: 'command', output: '', exitCode: 0, clipped: 0 })
    expect(listing?.diffs).toEqual([])
    for (const { result } of finished('terminal')) expect(JSON.stringify(result)).not.toContain('\\u001b')
  })

  it('opens the approval with the payload generation and its four choices', () => {
    const request = only(params.filter(({ type }) => type === 'approval.request'))
    expect(eventOf(request)).toEqual({
      type: 'prompt.opened',
      id: '3c0eea6699184b1dbee7a16b0a6bf830',
      generation: 1,
      ask: { kind: 'approval', command: 'rm -rf /tmp/hermes-proto-work/scratch', reason: 'delete in root path', choices: ['once', 'deny', 'session', 'always'] }
    })
    const settled = only(params.filter(({ type }) => type === 'approval.settled'))
    expect(eventOf(settled)).toEqual({ type: 'prompt.settled', id: '3c0eea6699184b1dbee7a16b0a6bf830' })
  })

  it('ends the turn complete with no final text and the receipt rows 1 to 10', () => {
    const complete = only(params.filter(({ type }) => type === 'message.complete'))
    expect(eventOf(complete)).toEqual({ type: 'turn.ended', outcome: { kind: 'complete' }, finalText: null, rows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] })
  })

  it('reads the queue and revision from session.info', () => {
    const [submitted, running, settled] = params.filter(({ type }) => type === 'session.info')
    expect(eventOf(submitted as Params)).toEqual({
      type: 'meta', revision: 0, queue: [{ inputId: 'input_990d3cd8381d422f', admissionId: 'e07cb5793e7f497bbcc1c0c8b0cdf20a', text: REQUEST, status: 'queued' }]
    })
    expect(eventOf(running as Params)).toMatchObject({ type: 'meta', revision: 0, queue: [{ status: 'started' }] })
    expect(eventOf(settled as Params)).toEqual({ type: 'meta', revision: 1, queue: [] })
  })
})

describe('parseEvent outside the happy path', () => {
  const frame = (over: Record<string, unknown>) => ({ type: 'tool.start', session_id: SESSION, seq: 7, replay_epoch: EPOCH, payload: {}, ...over })

  it('makes session.replay_gap its own kind', () => {
    const gap = { type: 'session.replay_gap', session_id: SESSION, payload: { replay_epoch: EPOCH, latest_seq: 50 } }
    expect(parseEvent(gap)).toEqual({ scope: 'gap', sessionId: SESSION })
  })

  it('never guesses a session for a frame without one, or places one without a seq', () => {
    expect(parseEvent(frame({ session_id: undefined }))).toEqual({ scope: 'unrouted', type: 'tool.start', why: 'no session id' })
    expect(parseEvent(frame({ seq: undefined }))).toMatchObject({ scope: 'unrouted', type: 'tool.start' })
    expect(parseEvent('not a frame')).toMatchObject({ scope: 'unrouted' })
  })

  it('routes sessions.changed to the app', () => {
    expect(parseEvent({ type: 'sessions.changed', session_id: '', payload: {} })).toEqual({ scope: 'app', event: 'sessions.changed' })
  })

  it('keeps a malformed payload in the stream as invalid', () => {
    const invalid = { scope: 'session', sessionId: SESSION, event: null, skipped: 'invalid' }
    expect(parseEvent(frame({ payload: { tool_id: 7, name: 'terminal' } }))).toMatchObject(invalid)
    expect(parseEvent(frame({ payload: { tool_id: 'call_1', name: 'terminal', args: 'rm -rf /' } }))).toMatchObject(invalid)
    expect(parseEvent(frame({ type: 'message.delta', payload: { text: 3 } }))).toMatchObject(invalid)
    expect(parseEvent(frame({ type: 'approval.request', payload: { kind: 'approval', prompt_id: 'p', choices: ['once'] } }))).toMatchObject(invalid)
    expect(parseEvent(frame({ payload: null }))).toMatchObject(invalid)
  })

  it('keeps a type it does not know in the stream as unshown', () => {
    expect(parseEvent(frame({ type: 'brand.new' }))).toMatchObject({ scope: 'session', stamp: { seq: 7 }, event: null, skipped: 'unshown' })
  })

  it('maps a failed and a stopped completion to their outcomes', () => {
    const complete = (payload: object) => {
      const parsed = parseEvent(frame({ type: 'message.complete', execution_generation: 2, payload }))
      return parsed.scope === 'session' ? parsed.event : null
    }
    expect(complete({ text: 'Worker execution is unknown.', outcome: 'unknown', status: 'error' })).toEqual({
      type: 'turn.ended', outcome: { kind: 'failed', message: 'Worker execution is unknown.', code: null, retryable: false }, finalText: null, rows: []
    })
    expect(complete({ status: 'error', error: 'no credentials', error_surface: { layer: 'provider', code: 'auth_permanent', retryable: false } }))
      .toMatchObject({ outcome: { kind: 'failed', message: 'no credentials', code: 'auth_permanent' } })
    expect(complete({ text: null, outcome: 'cancelled', status: 'interrupted' })).toMatchObject({ outcome: { kind: 'stopped' } })
    expect(complete({ text: '', content: '', admission_id: 'a2', outcome: 'cancelled' })).toMatchObject({ outcome: { kind: 'stopped' }, finalText: null })
  })

  it('leaves the generation empty on a completion stamped with an admission only', () => {
    const cancelled = { type: 'message.complete', session_id: SESSION, seq: 9, replay_epoch: EPOCH, authority_epoch: 1, admission_id: 'a2', payload: { text: '', outcome: 'cancelled' } }
    expect(parseEvent(cancelled)).toMatchObject({ stamp: { generation: null }, event: { type: 'turn.ended' } })
  })

  it('opens a clarify prompt', () => {
    const payload: CanonicalPendingPrompt = { kind: 'clarify', prompt_id: 'q1', execution_generation: 3, question: 'Which folder?', choices: ['a', 'b'], multi_select: false }
    expect(parseEvent(frame({ type: 'clarify.request', payload }))).toMatchObject({
      event: { type: 'prompt.opened', id: 'q1', generation: 3, ask: { kind: 'clarify', question: 'Which folder?', choices: ['a', 'b'], multi: false } }
    })
  })

  it('covers every generated event type as shown, unshown or app-wide', () => {
    const unlisted = GATEWAY_EVENT_TYPES.filter(type => !(type in SHOWN) && !UNSHOWN.has(type) && parseEvent({ type }).scope !== 'app')
    expect(unlisted).toEqual([])
    expect(Object.keys(SHOWN).filter(type => UNSHOWN.has(type))).toEqual([])
  })
})

describe('parseInlineDiff and parseToolResult', () => {
  it('keeps one FileDiff per file header and drops the banner and the omitted summary', () => {
    const raw = ['  ┊ review diff', '\u001b[33ma/a.txt → b/a.txt\u001b[0m', '@@ -1 +1 @@', '-x', '+y', 'a/b.txt → b/b.txt', '@@ -0,0 +1 @@', '+new', '… omitted 4 diff line(s)'].join('\n')
    expect(parseInlineDiff(raw).map(({ path, createsFile, added, removed }): Partial<FileDiff> => ({ path, createsFile, added, removed }))).toEqual([
      { path: 'a.txt', createsFile: false, added: 1, removed: 1 },
      { path: 'b.txt', createsFile: true, added: 1, removed: 0 }
    ])
  })

  it('strips ANSI from command output and caps text at 256 kB', () => {
    expect(parseToolResult('{"output": "\\u001b[31mred\\u001b[0m", "exit_code": 1, "error": null}', null, false))
      .toEqual({ kind: 'command', output: 'red', exitCode: 1, clipped: 0 } satisfies ToolResult)
    const long = parseToolResult('x'.repeat(256 * 1024 + 10), null, true)
    expect(long).toMatchObject({ kind: 'text', isError: true, clipped: 10 })
    expect(long.kind === 'text' && long.text.length).toBe(256 * 1024)
  })

  it('pretty-prints other JSON, prefers Hermes\'s own text, and reads nothing as none', () => {
    expect(parseToolResult('{"a":1}', null, false)).toEqual({ kind: 'text', text: '{\n  "a": 1\n}', isError: false, clipped: 0 })
    expect(parseToolResult('{"a":1}', 'a is 1', false)).toMatchObject({ text: 'a is 1' })
    expect(parseToolResult('plain words', null, false)).toMatchObject({ kind: 'text', text: 'plain words' })
    expect(parseToolResult(null, null, false)).toEqual({ kind: 'none' })
  })
})

