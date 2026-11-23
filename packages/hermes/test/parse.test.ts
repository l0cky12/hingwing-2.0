import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '../src/domain/reduce'
import type { FileDiff, ToolResult } from '../src/domain/session'
import { loadFixture } from '../src/testing/fixture'
import type {
  CanonicalEventsResult, CanonicalPendingPrompt, CanonicalSessionListRow, CanonicalSnapshot, StoredTranscriptResult, TranscriptMessage
} from '../src/wire/contract.generated'
import { GATEWAY_EVENT_TYPES } from '../src/wire/contract.generated'
import {
  parseEvent, parseInlineDiff, parseListRows, parseModelMenu, parseModelReceipt, parseReplay, parseRows, parseServerRequest, parseSnapshot, parseToolResult,
  parseTranscript, SHOWN, UNSHOWN
} from '../src/wire/parse'

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
const stored = fixture.steps.flatMap(step => ('stored' in step ? [step.stored as TranscriptMessage[]] : [])).at(-1) ?? []
const EPOCH = params[0]?.replay_epoch ?? ''
const REQUEST = 'In /tmp/hermes-proto-work: make notes.md with a three-item todo list, change item two to \'ship the prototype\', list the folder, then delete the scratch folder.'

function only<T>(values: readonly T[]): T {
  expect(values).toHaveLength(1)
  return values[0] as T
}

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

  it('reads the queue, revision and generation from session.info', () => {
    const [submitted, running, settled] = params.filter(({ type }) => type === 'session.info')
    expect(eventOf(submitted as Params)).toEqual({
      type: 'meta', revision: 0, generation: 0, queue: [{ inputId: 'input_990d3cd8381d422f', admissionId: 'e07cb5793e7f497bbcc1c0c8b0cdf20a', text: REQUEST, status: 'queued' }]
    })
    expect(eventOf(running as Params)).toMatchObject({ type: 'meta', revision: 0, queue: [{ status: 'started' }] })
    expect(eventOf(settled as Params)).toEqual({ type: 'meta', revision: 1, generation: 1, queue: [] })
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

describe('parseRows and when a turn began', () => {
  const user = (text: string, timestamp?: number | null): TranscriptMessage => ({ role: 'user', text, ...(timestamp === undefined ? {} : { timestamp }) })
  const answer = (text: string, timestamp?: number): TranscriptMessage => ({ role: 'assistant', text, ...(timestamp === undefined ? {} : { timestamp }) })

  it('reads a request row\'s timestamp, in seconds, as the turn\'s start on the gateway\'s clock', () => {
    const turn = only(parseRows([user('First', 1_795_251_600.182), answer('Done.', 1_795_251_700)]).turns)
    expect(turn.began).toEqual({ at: 1_795_251_600_182, clock: 'hermes' })
  })

  it('takes the start of the stored errand from its request row', () => {
    expect(only(parseRows(stored).turns).began).toEqual({ at: Math.round((stored[0]?.timestamp as number) * 1000), clock: 'hermes' })
  })

  it.each([[undefined], [null], [0], [-5]])('gives a request row with timestamp %s no start', timestamp => {
    expect(only(parseRows([user('First', timestamp), answer('Done.', 1_795_251_700)]).turns).began).toBeNull()
  })

  it('gives a turn whose request sits on an older page no start, whatever its other rows say', () => {
    const { turns } = parseRows([answer('The tail of an older turn.', 1_795_251_500), user('Next', 1_795_251_600), answer('Done.', 1_795_251_700)])
    expect(turns.map(turn => turn.began)).toEqual([null, { at: 1_795_251_600_000, clock: 'hermes' }])
  })

  it('carries the start of an unfinished turn', () => {
    const { turns, unfinished } = parseRows([user('First', 1_795_251_600), answer('Done.'), user('Second', 1_795_251_900)])
    expect(turns.map(turn => turn.began)).toEqual([{ at: 1_795_251_600_000, clock: 'hermes' }])
    expect(unfinished?.began).toEqual({ at: 1_795_251_900_000, clock: 'hermes' })
  })
})

describe('parseRows on the stored errand', () => {
  it('folds the stored rows into one complete turn that lists every row id', () => {
    const { turns, unfinished } = parseRows(stored)
    expect(unfinished).toBeNull()
    const turn = only(turns)
    expect(turn.request).toEqual({ text: REQUEST, inputId: null })
    expect(turn.outcome).toEqual({ kind: 'complete' })
    expect(turn.rows).toEqual(stored.flatMap(row => (typeof row.row_id === 'number' ? [row.row_id] : [])))
    expect(turn.rows).toEqual([1, 2, 6, 10])
  })

  it('makes assistant text and tool rows its items, with done tools and no diffs', () => {
    const turn = only(parseRows(stored).turns)
    expect(turn.items.map(item => (item.kind === 'tool' ? `tool ${item.name}` : item.kind))).toEqual(
      ['text', 'tool write_file', 'tool patch', 'text', 'tool terminal', 'tool terminal', 'text'])
    const tools = turn.items.flatMap(item => (item.kind === 'tool' ? [item] : []))
    for (const tool of tools) expect(tool.status).toMatchObject({ s: 'done', durationS: null, diffs: [] })
    expect(tools[0]).toMatchObject({ id: 'call_4350cc1721e54f21acd552a0', args: { path: '/tmp/hermes-proto-work/notes.md' } })
    expect(tools[2]?.status).toMatchObject({ result: { kind: 'none' } })
    expect(turn.items.at(-1)).toMatchObject({ kind: 'text', sealed: true, markdown: expect.stringMatching(/^Done\. I created `notes\.md`/) })
  })

  it('leaves a last turn without an answer unfinished and an earlier one lost', () => {
    const { turns, unfinished } = parseRows([...stored.slice(0, 4), ...stored, ...stored.slice(0, 3)])
    expect(turns.map(turn => turn.outcome.kind)).toEqual(['lost', 'complete'])
    expect(unfinished).toMatchObject({ request: REQUEST, items: [{ kind: 'text' }, { kind: 'tool', name: 'write_file' }] })
  })
})

function snapshotReply(over: Partial<CanonicalSnapshot> = {}): CanonicalSnapshot {
  return {
    session_id: SESSION,
    stored_session_id: SESSION,
    messages: [],
    display_messages: stored,
    message_count: 10,
    running: false,
    authority_epoch: 1,
    replay_epoch: EPOCH,
    last_sequence: 43,
    subscription_id: 'sub-1',
    revision: 1,
    execution_generation: 1,
    pending: [],
    prompts: [],
    info: { desktop_protocol: 'hermes-gateway-v1', cwd: '/tmp/hermes-proto-work', title: 'Errand' },
    open_requests: [],
    ...over
  }
}

describe('parseSnapshot', () => {
  it('reads a settled session with its history up to the watermark', () => {
    expect(parseSnapshot(snapshotReply())).toMatchObject({
      id: SESSION,
      title: 'Errand',
      cwd: '/tmp/hermes-proto-work',
      running: false,
      generation: 1,
      revision: 1,
      subscriptionId: 'sub-1',
      watermark: { epoch: EPOCH, seq: 43 },
      queue: [],
      prompts: [],
      history: { turns: [{ rows: [1, 2, 6, 10], outcome: { kind: 'complete' } }], unfinished: null, older: null },
      openRequests: []
    })
  })

  it('reads a running session waiting on an approval, with no rows asked for', () => {
    const approval = params.find(({ type }) => type === 'approval.request')?.payload as unknown as CanonicalPendingPrompt
    const snapshot = parseSnapshot(snapshotReply({
      running: true,
      messages_omitted: true,
      display_messages: null,
      prompts: [approval],
      pending: [{
        admission_id: 'e07cb5793e7f497bbcc1c0c8b0cdf20a', ref: { profile_id: '/tmp/hermes-proto-home', session_id: SESSION }, sequence: 1,
        status: 'started', outcome: null, authority_epoch: 1, execution_generation: 1, input_id: 'input_990d3cd8381d422f', text: REQUEST
      }],
      open_requests: [{ id: 'req-1', method: 'sudo', params: { session_id: SESSION, command: 'apt install x' } }]
    }))
    expect(snapshot.history).toBeNull()
    expect(snapshot.prompts).toEqual([{
      id: '3c0eea6699184b1dbee7a16b0a6bf830', generation: 1,
      ask: { kind: 'approval', command: 'rm -rf /tmp/hermes-proto-work/scratch', reason: 'delete in root path', choices: ['once', 'deny', 'session', 'always'] }
    }])
    expect(snapshot.queue).toEqual([{ inputId: 'input_990d3cd8381d422f', admissionId: 'e07cb5793e7f497bbcc1c0c8b0cdf20a', text: REQUEST, status: 'started' }])
    expect(snapshot.openRequests).toEqual([{ requestId: 'req-1', method: 'sudo', sessionId: SESSION }])
  })

  it('says older rows exist when the first stored row was cut by the byte budget', () => {
    const history = parseSnapshot(snapshotReply({ messages: [{ role: 'user', text: 'old', archived_truncated: true }] })).history
    expect(history?.older).toEqual({ cursor: null })
  })
})

describe('parseReplay', () => {
  it('stamps each replayed frame from its own envelope', () => {
    const tail = params.slice(-3) as unknown as CanonicalEventsResult['events']
    const reply: CanonicalEventsResult = { events: tail, latest_seq: 43, last_sequence: 43, epoch: EPOCH, replay_epoch: EPOCH, truncated: false, snapshot_required: false, count: 3 }
    const replay = parseReplay(reply)
    expect(replay).toMatchObject({ snapshotRequired: false, epoch: EPOCH })
    expect(replay.events.map(({ stamp }) => stamp)).toEqual([41, 42, 43].map(seq => ({ epoch: EPOCH, seq, generation: 1 })))
    expect(replay.events.map(({ event }) => event?.type)).toEqual(['text.delta', 'turn.ended', 'meta'])
  })

  it('marks every replayed frame as seen at no known time', () => {
    const tail = params.slice(-3) as unknown as CanonicalEventsResult['events']
    const replay = parseReplay({ events: tail, latest_seq: 43, last_sequence: 43, epoch: EPOCH, replay_epoch: EPOCH, truncated: false, snapshot_required: false, count: 3 })
    expect(replay.events.map(({ seenAt }) => seenAt)).toEqual([null, null, null])
  })

  it('passes on that the gateway cannot replay', () => {
    const reply: CanonicalEventsResult = { events: [], latest_seq: 90, last_sequence: 90, epoch: 'e2', replay_epoch: 'e2', truncated: true, snapshot_required: true, count: 0 }
    expect(parseReplay(reply)).toEqual({ snapshotRequired: true, epoch: 'e2', events: [] })
  })
})

describe('parseTranscript', () => {
  const page = (rows: readonly TranscriptMessage[], next: string | null): StoredTranscriptResult =>
    ({ session_id: SESSION, rows: rows.map(row => ({ ...row, row_kind: 'message' as const })), next_cursor: next, reset: false })

  it('reads pages newest first into turns oldest first, continuing from the oldest page cursor', () => {
    const newer = stored.map(row => (row.row_id == null ? row : { ...row, row_id: row.row_id + 100 }))
    const compaction = { role: 'system', text: 'Earlier work summarised.', row_id: 50 }
    const oldest = { ...page([...stored, compaction], 'cursor-1') }
    const history = parseTranscript([page(newer, null), { ...oldest, rows: oldest.rows.map(row => (row.row_id === 50 ? { ...row, row_kind: 'compaction' as const } : row)) }])
    expect(history.older).toEqual({ cursor: 'cursor-1' })
    expect(history.turns.map(turn => turn.rows)).toEqual([[1, 2, 6, 10, 50], [101, 102, 106, 110]])
    expect(history.turns.map(turn => turn.outcome.kind)).toEqual(['complete', 'complete'])
    expect(history.turns[0]?.items.at(-1)).toEqual({ kind: 'notice', what: 'said', tone: 'info', text: 'Earlier work summarised.' })
  })

  it('skips a row it cannot use without failing the page', () => {
    expect(parseRows([...stored.slice(0, 2), { role: 'assistant', text: 'x', row_id: -1 }, 'junk', ...stored.slice(2)]).turns[0]?.rows).toEqual([1, 2, 6, 10])
  })
})

describe('parseListRows and parseServerRequest', () => {
  it('reads the fixture list row with its start time in milliseconds', () => {
    const { sessions } = fixture.header.list as { sessions: CanonicalSessionListRow[] }
    expect(parseListRows(sessions)).toEqual([{ id: SESSION, title: '', preview: null, lastActiveAt: 1795251600000 }])
  })

  it('reads an app-level request as having no session', () => {
    expect(parseServerRequest({ id: 'r2', method: 'display.install.sudo', params: { session_id: '' } })).toEqual({ requestId: 'r2', method: 'display.install.sudo', sessionId: null })
  })
})

describe('parseInlineDiff and parseToolResult', () => {
  it('keeps one FileDiff per file header and drops the banner and the omitted summary', () => {
    const raw = ['  ┊ review diff', '\u001b[33ma/a.txt → b/a.txt\u001b[0m', '@@ -1 +1 @@', '-x', '+y', 'a/b.txt → b/b.txt', '@@ -0,0 +1 @@', '+new', '… omitted 4 diff line(s)'].join('\n')
    expect(parseInlineDiff(raw).map(({ path, createsFile, cut, added, removed }): Partial<FileDiff> => ({ path, createsFile, cut, added, removed }))).toEqual([
      { path: 'a.txt', createsFile: false, cut: false, added: 1, removed: 1 },
      { path: 'b.txt', createsFile: true, cut: true, added: 1, removed: 0 }
    ])
  })

  it('marks a file cut when the cap falls between two of its hunks, though every kept hunk is whole', () => {
    const raw = ['a/a.txt → b/a.txt', '@@ -1 +1 @@', '-x', '+y', '… omitted 4 diff line(s)'].join('\n')
    expect(parseInlineDiff(raw).map(diff => diff.cut)).toEqual([true])
  })

  it('marks a file cut when the cap falls inside a hunk', () => {
    const raw = ['a/a.txt → b/a.txt', '@@ -1,90 +1,90 @@', ' one', '-two', '+three'].join('\n')
    expect(parseInlineDiff(raw).map(diff => diff.cut)).toEqual([true])
  })

  it('reads a /dev/null target as a delete', () => {
    const raw = ['a/old.txt → /dev/null', '@@ -1 +0,0 @@', '-gone'].join('\n')
    expect(parseInlineDiff(raw).map(({ path, deletesFile, cut }) => ({ path, deletesFile, cut }))).toEqual([{ path: 'old.txt', deletesFile: true, cut: false }])
  })

  it('leaves whole files uncut when a note sits between them', () => {
    const raw = ['a/a.txt → b/a.txt', '@@ -1 +1 @@', '-x', '+y', '# Moved: a.txt -> b.txt', 'a/c.txt → b/c.txt', '@@ -1 +1 @@', '-p', '+q'].join('\n')
    expect(parseInlineDiff(raw).map(diff => diff.cut)).toEqual([false, false])
  })

  it.each(['# Moved: a.txt -> b.txt', '# Deleted: c.txt'])('leaves a whole file uncut when the patch ends with "%s"', note => {
    const raw = ['a/a.txt → b/a.txt', '@@ -1 +1 @@', '-x', '+y', note].join('\n')
    expect(parseInlineDiff(raw).map(diff => diff.cut)).toEqual([false])
  })

  it('leaves a whole diff uncut', () => {
    const raw = ['  ┊ review diff', 'a/a.txt → b/a.txt', '@@ -1,2 +1,2 @@', ' one', '-two', '+three'].join('\n')
    expect(parseInlineDiff(raw).map(diff => diff.cut)).toEqual([false])
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


describe('models', () => {
  const frame = (type: string, payload: Record<string, unknown>) => ({ type, session_id: SESSION, seq: 9, replay_epoch: EPOCH, payload })

  it('reads the model Hermes names on session.info and on a committed session.updated', () => {
    expect(parseEvent(frame('session.info', { revision: 3, model: 'careful-large', provider: 'acme' })))
      .toMatchObject({ event: { type: 'meta', revision: 3, model: { id: 'careful-large', provider: 'acme' } } })
    expect(parseEvent(frame('session.updated', { session_id: SESSION, operation: 'model', revision: 3, model: 'careful-large' })))
      .toMatchObject({ event: { type: 'meta', model: { id: 'careful-large', provider: null } } })
    expect(parseEvent(frame('session.updated', { session_id: SESSION, operation: 'model', status: 'deferred', model: 'careful-large' })))
      .toMatchObject({ event: { type: 'meta' } })
    expect(parseEvent(frame('session.updated', { session_id: SESSION, operation: 'model', status: 'deferred', model: 'careful-large' })))
      .not.toMatchObject({ event: { model: expect.anything() } })
  })

  it('settles a pick on a committed or refused receipt, carrying the generation the switch moved to', () => {
    const base = { session_id: SESSION, operation: 'model', revision: 4 }
    expect(parseEvent(frame('session.updated', { ...base, model: 'careful-large', provider: 'acme', execution_generation: 3 })))
      .toMatchObject({ event: { type: 'meta', revision: 4, model: { id: 'careful-large' }, pick: { is: 'settled' }, generation: 3 } })
    expect(parseEvent(frame('session.updated', { ...base, status: 'refused', reason: 'model_resolution_failed', target_model: 'careful-large', model: 'fast-small' })))
      .toMatchObject({ event: { model: { id: 'fast-small' }, pick: { is: 'settled' } } })
    expect(parseEvent(frame('session.updated', { session_id: SESSION, operation: 'rename', revision: 5, title: 'Notes' })))
      .not.toMatchObject({ event: { pick: expect.anything() } })
  })

  it('asks for a held pick Hermes wants confirmed at the turn boundary', () => {
    const asked = {
      session_id: SESSION, operation: 'model', status: 'confirmation_required', confirm_required: true, confirm: 'tok',
      confirm_message: 'This model costs more.', payload: { model: 'careful-large', provider: 'acme' }, committed_model: 'fast-small', committed_provider: 'acme'
    }
    expect(parseEvent(frame('session.updated', asked))).toMatchObject({
      event: {
        type: 'meta',
        model: { id: 'fast-small', provider: 'acme' },
        pick: { is: 'asking', ask: { model: { id: 'careful-large', provider: 'acme' }, token: 'tok', message: 'This model costs more.' } }
      }
    })
  })

  it('keeps signed-in providers and their usable models, once each, in Hermes order', () => {
    const menu = parseModelMenu({
      model: 'fast-small',
      provider: 'acme',
      providers: [
        { slug: 'acme', name: 'Acme', models: ['fast-small', 'careful-large', 'retired', 'fast-small'], unavailable_models: ['retired'], authenticated: true },
        { slug: 'signed-out', name: 'Signed out', models: ['locked'], authenticated: false },
        { slug: 'local', name: 'Local', models: ['local-7b'] },
        { name: 'no slug', models: ['lost'] } as never
      ]
    })
    expect(menu).toEqual({
      options: [
        { id: 'fast-small', provider: 'acme', providerName: 'Acme' },
        { id: 'careful-large', provider: 'acme', providerName: 'Acme' },
        { id: 'local-7b', provider: 'local', providerName: 'Local' }
      ],
      fallback: { id: 'fast-small', provider: 'acme' }
    })
    expect(parseModelMenu({ providers: [] })).toEqual({ options: [], fallback: null })
  })

  it('tells a deferred pick and a confirmation apart from a committed one', () => {
    const base = { session_id: SESSION, operation: 'model', revision: 4 }
    expect(parseModelReceipt({ ...base, status: 'deferred', model: 'careful-large', execution_generation: 2 })).toEqual({ status: 'deferred', during: 2 })
    expect(parseModelReceipt({ ...base, status: 'confirmation_required', confirm: 'tok', confirm_message: 'This model costs more.' }))
      .toEqual({ status: 'confirm', confirm: { token: 'tok', message: 'This model costs more.' } })
    expect(parseModelReceipt({ ...base, status: 'applied', model: 'careful-large' })).toEqual({ status: 'committed' })
    expect(parseModelReceipt({ ...base, status: 'deferred' })).toEqual({ status: 'deferred', during: null })
    expect(parseModelReceipt({ ...base, status: 'confirmation_required' }))
      .toEqual({ status: 'confirm-without-token', message: 'Hermes asks you to confirm this model before it switches.' })
    expect(parseModelReceipt({ ...base, status: 'deferred', execution_generation: 'two' })).toEqual({ status: 'committed' })
  })
})
