import { describe, expect, it } from 'vitest'
import type { Outcome } from '../src/domain/command'
import { emptyTracked, reduce, type SessionEvent, type SessionInput, type Snapshot, type Tracked } from '../src/domain/reduce'
import type { BackgroundProcess, CheckpointId, Generation, ProcessId, SessionControl, TurnId } from '../src/domain/session'
import { settle } from '../src/testing/clock'
import { parseEvent, parseRows } from '../src/wire/parse'
import { EPOCH, ID, refusal, stage, started } from './support/actor'

const DONE: Outcome = { ok: true, value: undefined }
const BUILD = { session_id: 'proc_1', command: 'npm run build', status: 'running', exit_code: null, started_epoch: 1_795_251_600, exited_at: null, completion_reason: null, output_tail: '\u001b[32mok\u001b[0m 12 files\n' }
const BUILT = { ...BUILD, status: 'exited', exit_code: -15, exited_at: 1_795_251_660, completion_reason: 'killed' }
const RUNNING = { id: 'proc_1', command: 'npm run build', state: { s: 'running' }, startedAt: 1_795_251_600_000, tail: 'ok 12 files\n' }
const GOAL = {
  title: 'Ship the release notes', status: 'active', turns_used: 1, max_turns: 20, subgoals: ['notes list every change'], gates: [],
  contract: { outcome: 'notes.md is final', verification: '', constraints: '', boundaries: '', stop_when: '' }, last_verdict: 'continue', last_reason: 'Two items left.'
}
const control = (goal: object | null) => ({ goal, loop: null, heartbeat: null, revision: goal === null ? '' : 'r1', updated_at: 1_795_251_600 })
const feed = (state: Tracked, ...inputs: SessionInput[]): Tracked => inputs.reduce(reduce, state)
const SNAPSHOT: Snapshot = {
  id: ID, title: 'Notes', cwd: null, model: null, tuning: { effort: null, fast: null, yolo: null }, running: false, generation: 1 as Generation, revision: 1, subscriptionId: 'sub-1',
  watermark: { epoch: EPOCH, seq: 0 }, queue: [], prompts: [], history: null, openRequests: []
}
const ended = (replyRow: number | null): SessionEvent => ({ type: 'turn.ended', outcome: { kind: 'complete' }, finalText: null, rows: [], userRow: null, replyRow, usage: null })

describe('the processes', () => {
  it('are read with the chat\'s facts once it is watched, and again when Hermes says one changed', async () => {
    const { actor, calls, answer, event } = await stage({ watched: true })
    expect(calls.filter(call => call.method === 'process.list').map(call => call.params)).toEqual([{ session_id: ID }])
    await answer('process.list', { processes: [BUILD] })
    expect(actor.session.processes).toEqual([RUNNING])
    event({ type: 'processes.changed' }, null)
    await answer('process.list', { processes: [BUILT] })
    expect(actor.session.processes).toEqual([{ ...RUNNING, state: { s: 'exited', code: -15, why: 'killed', at: 1_795_251_660_000 } }])
  })

  it('are read again when a turn ends, since a turn starts and stops them', async () => {
    const { calls, answer, event } = await stage({ watched: true })
    await answer('process.list', { processes: [] })
    event(started)
    expect(calls.some(call => call.method === 'process.list')).toBe(false)
    event(ended(null))
    expect(calls.filter(call => call.method === 'process.list')).toHaveLength(1)
  })

  it('are not read for a chat no window watches', async () => {
    const { calls, event } = await stage()
    event({ type: 'processes.changed' }, null)
    expect(calls.map(call => call.method)).not.toContain('process.list')
  })

  it('keep a list Hermes gave after a change it said since an older read was asked', async () => {
    const { actor, calls, event } = await stage({ watched: true })
    const [first] = calls.filter(call => call.method === 'process.list')
    event({ type: 'processes.changed' }, null)
    const second = calls.filter(call => call.method === 'process.list').at(-1)
    second?.resolve({ processes: [BUILT] })
    await settle()
    first?.resolve({ processes: [BUILD] })
    await settle()
    expect(actor.session.processes, 'the older read answered last').toMatchObject([{ state: { s: 'exited' } }])
  })

  it('stay unknown on a Hermes that refuses the read', async () => {
    const { actor, answer } = await stage({ watched: true })
    await answer('process.list', refusal('unsupported_projection'))
    expect(actor.session.processes).toBeNull()
  })

  it('are killed one at a time by id, and read again after', async () => {
    const { actor, command, sent, answer } = await stage({ watched: true })
    await answer('process.list', { processes: [BUILD] })
    const done = command({ do: 'killProcess', sessionId: ID, processId: 'proc_1' as ProcessId })
    expect(sent()).toEqual([['config.get', { session_id: ID, key: 'show_reasoning' }], ['config.get', { session_id: ID, key: 'busy' }], ['process.kill', { session_id: ID, process_id: 'proc_1' }]])
    await answer('process.kill', { status: 'killed', session_id: 'proc_1', completion_reason: 'killed' })
    expect(await done).toEqual(DONE)
    await answer('process.list', { processes: [BUILT] })
    expect(actor.session.processes).toMatchObject([{ state: { s: 'exited', why: 'killed' } }])
  })

  it.each([
    ['a process that already ended', { status: 'already_exited' }, DONE],
    ['a process Hermes no longer has', refusal('process_not_found'), { ok: false, refusal: { kind: 'stale', message: 'That process is no longer in this chat.' } }],
    ['a kill that left the process running', { status: 'error', error: 'Kill incomplete: 1 process(es) still alive (42); session running' },
      { ok: false, refusal: { kind: 'rejected', message: "Hermes couldn't stop it: Kill incomplete: 1 process(es) still alive (42); session running" } }]
  ])('answers %s', async (_, reply, outcome) => {
    const { command, answer } = await stage()
    const done = command({ do: 'killProcess', sessionId: ID, processId: 'proc_1' as ProcessId })
    await answer('process.kill', reply)
    expect(await done).toEqual(outcome)
  })
})

describe('the goal, loop and heartbeat', () => {
  it('are read once the chat is watched, and follow every update Hermes publishes', async () => {
    const { actor, answer, event } = await stage({ watched: true })
    await answer('session.control.read', { control: control(GOAL) })
    expect(actor.session.control?.goal).toEqual({
      title: 'Ship the release notes', status: 'active', turns: { used: 1, max: 20 }, subgoals: ['notes list every change'], gates: [],
      contract: { outcome: 'notes.md is final', verification: null, constraints: null, boundaries: null, stopWhen: null },
      pausedWhy: null, verdict: { is: 'continue', why: 'Two items left.' }, waiting: null
    })
    const paused: SessionControl = { goal: { ...actor.session.control!.goal!, status: 'paused', pausedWhy: 'paused by user' }, loop: null, heartbeat: null }
    event({ type: 'control', control: paused }, null)
    expect(actor.session.control).toEqual(paused)
  })

  it('keep an update Hermes published after the read was asked, when the older read answers last', async () => {
    const { actor, answer, event } = await stage({ watched: true })
    event({ type: 'control', control: { goal: null, loop: null, heartbeat: null } }, null)
    await answer('session.control.read', { control: control(GOAL) })
    expect(actor.session.control).toEqual({ goal: null, loop: null, heartbeat: null })
  })

  it('are pressed as one session.control with the action and its arguments, and answer the words Hermes shows', async () => {
    const { command, sent, answer } = await stage()
    const done = command({ do: 'control', sessionId: ID, action: { act: 'subgoal.add', text: 'the changelog links each PR' } })
    expect(sent()).toEqual([['session.control', { session_id: ID, action: 'subgoal.add', args: { text: 'the changelog links each PR' } }]])
    await answer('session.control', { control: control(GOAL), dispatch: { type: 'exec', output: 'Added criterion 2: the changelog links each PR', notice: null, message: null, display: null } })
    expect(await done).toEqual({ ok: true, value: 'Added criterion 2: the changelog links each PR' })
  })

  it('send an action with no arguments as an empty set of them', async () => {
    const { command, sent } = await stage()
    void command({ do: 'control', sessionId: ID, action: { act: 'goal.pause' } })
    expect(sent()).toEqual([['session.control', { session_id: ID, action: 'goal.pause', args: {} }]])
  })

  it('submit the message Hermes hands back when the button starts a turn', async () => {
    const { command, sent, answer } = await stage()
    const done = command({ do: 'control', sessionId: ID, action: { act: 'goal.resume' } })
    await answer('session.control', { control: control(GOAL), dispatch: { type: 'send', message: 'Continue toward the goal.', display: '/goal resume', notice: 'Goal resumed.', output: null } })
    expect(sent().at(-1)).toEqual(['prompt.submit', { session_id: ID, text: '/goal resume', api_text: 'Continue toward the goal.', input_id: 'id-1' }])
    await answer('prompt.submit', { admission_id: 'a1', status: 'queued' })
    expect(await done).toEqual({ ok: true, value: 'Goal resumed.' })
  })

  it('say the chat has no goal when Hermes refuses a criterion for that', async () => {
    const { command, answer } = await stage()
    const done = command({ do: 'control', sessionId: ID, action: { act: 'subgoal.remove', index: 1 } })
    await answer('session.control', refusal('goal_not_active'))
    expect(await done).toEqual({ ok: false, refusal: { kind: 'stale', message: 'This chat has no goal now.' } })
  })
})

describe('the checkpoints', () => {
  const HASH = '4f1c2a9e0b7d' as CheckpointId

  it('are listed when asked, newest first as Hermes lists them', async () => {
    const { command, sent, answer } = await stage()
    const done = command({ do: 'checkpoints', sessionId: ID })
    expect(sent()).toEqual([['rollback.list', { session_id: ID }]])
    await answer('rollback.list', { enabled: true, checkpoints: [{ hash: HASH, timestamp: '2026-11-24T10:00:00+00:00', message: 'before write_file notes.md' }] })
    expect(await done).toEqual({ ok: true, value: { kept: 'on', items: [{ id: HASH, at: '2026-11-24T10:00:00+00:00', reason: 'before write_file notes.md' }] } })
  })

  it('say so when the chat keeps none', async () => {
    const { command, answer } = await stage()
    const done = command({ do: 'checkpoints', sessionId: ID })
    await answer('rollback.list', { enabled: false, checkpoints: [] })
    expect(await done).toEqual({ ok: true, value: { kept: 'off' } })
  })

  it('answer a diff as git prints it', async () => {
    const { command, sent, answer } = await stage()
    const done = command({ do: 'checkpointDiff', sessionId: ID, checkpoint: HASH })
    expect(sent()).toEqual([['rollback.diff', { session_id: ID, hash: HASH }]])
    await answer('rollback.diff', { stat: ' notes.md | 2 +-\n', diff: '--- a/notes.md\n+++ b/notes.md\n', rendered: '\u001b[31m-x\u001b[0m' })
    expect(await done).toEqual({ ok: true, value: { stat: ' notes.md | 2 +-\n', patch: '--- a/notes.md\n+++ b/notes.md\n' } })
  })

  it('restore the whole folder, keeping the user\'s edits, and read the chat again when Hermes took back the last turn', async () => {
    const { actor, command, sent, answer } = await stage()
    const done = command({ do: 'restore', sessionId: ID, checkpoint: HASH, scope: { kind: 'folder', edits: 'keep' } })
    expect(sent()).toEqual([['rollback.restore', { session_id: ID, hash: HASH }]])
    await answer('rollback.restore', { success: true, restored_to: '4f1c2a9e', restored_files: ['notes.md'], skipped_user_edits: ['todo.md'], skipped_oversize: [], history_removed: 2 })
    expect(await done).toEqual({ ok: true, value: { files: ['notes.md'], kept: ['todo.md'], lastTurn: 'removed' } })
    expect(actor.session.sync.state).toBe('rebuilding')
    expect(sent().at(-1)).toEqual(['session.resume', { session_id: ID, display_projection: true }])
  })

  it('overwrite the user\'s edits only when asked', async () => {
    const { command, sent } = await stage()
    void command({ do: 'restore', sessionId: ID, checkpoint: HASH, scope: { kind: 'folder', edits: 'overwrite' } })
    expect(sent()).toEqual([['rollback.restore', { session_id: ID, hash: HASH, all: true }]])
  })

  it('refuse a whole folder while a turn runs, and restore one file then, which leaves the chat as it is', async () => {
    const { actor, command, sent, answer, event } = await stage()
    event(started)
    expect(await command({ do: 'restore', sessionId: ID, checkpoint: HASH, scope: { kind: 'folder', edits: 'keep' } })).toMatchObject({ ok: false, refusal: { kind: 'stale' } })
    expect(sent()).toEqual([])
    const done = command({ do: 'restore', sessionId: ID, checkpoint: HASH, scope: { kind: 'file', path: 'notes.md' } })
    expect(sent()).toEqual([['rollback.restore', { session_id: ID, hash: HASH, file_path: 'notes.md' }]])
    await answer('rollback.restore', { success: true, restored_to: '4f1c2a9e', file: 'notes.md' })
    expect(await done).toEqual({ ok: true, value: { files: null, kept: [], lastTurn: 'kept' } })
    expect(actor.session.sync.state).toBe('live')
  })

  it('say why Hermes could not restore', async () => {
    const { command, answer } = await stage()
    const done = command({ do: 'restore', sessionId: ID, checkpoint: HASH, scope: { kind: 'folder', edits: 'keep' } })
    await answer('rollback.restore', { success: false, error: "Checkpoint '4f1c2a9e0b7d' not found" })
    expect(await done).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Checkpoint '4f1c2a9e0b7d' not found" } })
  })
})

describe('a reaction', () => {
  async function answered() {
    const staged = await stage()
    staged.event({ type: 'turn.started', turnId: 't1' as TurnId, admissionId: null, requestText: 'Draft the notes' })
    staged.event(ended(12))
    staged.event({ type: 'turn.started', turnId: 't2' as TurnId, admissionId: null, requestText: 'Then stop' }, 2)
    staged.event({ type: 'turn.ended', outcome: { kind: 'stopped' }, finalText: null, rows: [], userRow: null, replyRow: null, usage: null }, 2)
    return staged
  }

  it('goes on the stored row of the turn\'s answer, and the list Hermes answers shows at once', async () => {
    const { actor, command, sent, answer } = await answered()
    const done = command({ do: 'react', sessionId: ID, turn: 't1' as TurnId, emoji: '👍' })
    expect(sent()).toEqual([['message.react', { session_id: ID, row_id: 12, emoji: '👍' }]])
    await answer('message.react', { row_id: 12, reactions: [{ emoji: '👍', author: 'user', at: 1_795_251_700 }] })
    expect(await done).toEqual(DONE)
    expect(actor.session.history[0]?.reply).toEqual({ rowId: 12, reactions: [{ emoji: '👍', by: 'user' }] })
  })

  it('is taken off with no emoji', async () => {
    const { actor, command, sent, answer } = await answered()
    const done = command({ do: 'react', sessionId: ID, turn: 't1' as TurnId, emoji: null })
    expect(sent()).toEqual([['message.react', { session_id: ID, row_id: 12, emoji: null }]])
    await answer('message.react', { row_id: 12, reactions: [] })
    expect(await done).toEqual(DONE)
    expect(actor.session.history[0]?.reply?.reactions).toEqual([])
  })

  it('is refused, and sends nothing, for a turn with no stored answer', async () => {
    const { command, sent } = await answered()
    expect(await command({ do: 'react', sessionId: ID, turn: 't2' as TurnId, emoji: '👍' })).toEqual({ ok: false, refusal: { kind: 'rejected', message: "That answer isn't stored, so it can't take a reaction." } })
    expect(sent()).toEqual([])
  })

  it('says the message is gone when Hermes no longer shows its row', async () => {
    const { command, answer } = await answered()
    const done = command({ do: 'react', sessionId: ID, turn: 't1' as TurnId, emoji: '👍' })
    await answer('message.react', refusal('not_found'))
    expect(await done).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'That message is no longer in this chat.' } })
  })
})

describe('the answer a reaction goes on, read from stored rows', () => {
  const user = (text: string, row: number) => ({ role: 'user', text, row_id: row })
  const answer = (text: string, row: number, reactions?: unknown) => ({ role: 'assistant', text, row_id: row, ...(reactions === undefined ? {} : { display_metadata: { reactions } }) })

  it('is the turn\'s last answering row, with the reactions on it of either author', () => {
    const { turns } = parseRows([
      user('Draft the notes', 1), answer('Looking at notes.md first.', 2), answer('Here are the notes.', 4, [{ emoji: '❤️', author: 'user', at: 1 }, { emoji: '👀', author: 'agent' }]),
      user('Thanks', 5), answer('Any time.', 6)
    ])
    expect(turns.map(turn => turn.reply)).toEqual([
      { rowId: 4, reactions: [{ emoji: '❤️', by: 'user' }, { emoji: '👀', by: 'agent' }] },
      { rowId: 6, reactions: [] }
    ])
  })

  it('leaves out a reaction it cannot read', () => {
    const { turns } = parseRows([user('Hi', 1), answer('Hello.', 2, [{ emoji: ' ', author: 'user' }, { emoji: '👍', author: 'someone' }, 'x', { emoji: '👍', author: 'user' }])])
    expect(turns[0]?.reply).toEqual({ rowId: 2, reactions: [{ emoji: '👍', by: 'user' }] })
  })

  it('is none for a turn with no stored answer', () => {
    const { turns } = parseRows([user('Hi', 1), { role: 'tool', name: 'terminal', tool_call_id: 'c1' }, user('Again', 3), answer('Done.', 4)])
    expect(turns.map(turn => turn.reply)).toEqual([null, { rowId: 4, reactions: [] }])
  })
})

describe('the panel through attaches and turns', () => {
  const live = () => feed(emptyTracked(ID), { in: 'attach' }, { in: 'attached', attempt: 1, replay: null, snapshot: { ...SNAPSHOT, history: { turns: [], unfinished: null, older: null } } })
  const at = (seq: number, event: SessionEvent, generation: number | null = 1) => ({ in: 'event', frame: { stamp: { epoch: EPOCH, seq, generation: generation as Generation | null }, event, seenAt: null } }) as const
  const LISTED: BackgroundProcess = { id: 'proc_1' as ProcessId, command: 'npm run build', state: { s: 'running' }, startedAt: null, tail: '' }
  const CONTROL: SessionControl = { goal: null, loop: null, heartbeat: { prompt: 'check the build', status: 'active', everyS: 300, fired: 2, lastAt: null } }

  it('takes each part of a read unless Hermes said more about that part since it was asked', () => {
    const asked = live()
    const heardSince = reduce(asked, at(1, { type: 'processes.changed' }, null))
    const read = reduce(heardSince, { in: 'facts', attempt: 1, heard: asked.fence.heard, processes: [LISTED], control: CONTROL, tuning: { busy: 'steer' } })
    expect(read.content.processes, 'asked before the change').toBeNull()
    expect(read.content.control).toEqual(CONTROL)
    expect(read.content.tuning.busy).toBe('steer')
  })

  it('keeps the value it holds when a read says the same, so a push carries nothing', () => {
    const read = reduce(live(), { in: 'facts', attempt: 1, heard: { control: 0, processes: 0 }, processes: [LISTED] })
    const again = reduce(read, { in: 'facts', attempt: 1, heard: read.fence.heard, processes: [{ ...LISTED }] })
    expect(again.content).toBe(read.content)
  })

  it('keeps the processes and the goal through a rebuild, for the reads after it to replace', () => {
    const read = reduce(live(), { in: 'facts', attempt: 1, heard: { control: 0, processes: 0 }, processes: [LISTED], control: CONTROL })
    const rebuilt = feed(read, { in: 'local', action: { did: 'rewritten' } })
    expect(rebuilt.gate).toMatchObject({ at: 'attaching', plan: { mode: 'rebuild' } })
    const seeded = reduce(rebuilt, { in: 'attached', attempt: 2, replay: null, snapshot: { ...SNAPSHOT, subscriptionId: 'sub-2', history: { turns: [], unfinished: null, older: null } } })
    expect([seeded.content.processes, seeded.content.control]).toEqual([[LISTED], CONTROL])
  })

  it('names the stored row of a live turn\'s answer, which takes this client\'s reaction, and changes nothing for a row no turn answered with', () => {
    const settled = feed(live(), at(1, { type: 'turn.started', turnId: 't1' as TurnId, admissionId: null, requestText: 'Hi' }), at(2, ended(7)))
    expect(settled.content.history[0]?.reply).toEqual({ rowId: 7, reactions: [] })
    const reacted = reduce(settled, { in: 'local', action: { did: 'reacted', rowId: 7, reactions: [{ emoji: '🎉', by: 'user' }] } })
    expect(reacted.content.history[0]?.reply).toEqual({ rowId: 7, reactions: [{ emoji: '🎉', by: 'user' }] })
    expect(reduce(reacted, { in: 'local', action: { did: 'reacted', rowId: 7, reactions: [{ emoji: '🎉', by: 'user' }] } }).content).toBe(reacted.content)
    expect(reduce(reacted, { in: 'local', action: { did: 'reacted', rowId: 99, reactions: [] } }).content).toBe(reacted.content)
  })
})

describe('session.control.update, parsed', () => {
  const frame = (payload: unknown) => parseEvent({ type: 'session.control.update', session_id: ID, seq: 3, replay_epoch: EPOCH, payload })

  it('is the whole state, with a waiting goal, a self-paced loop and a part it cannot read left out', () => {
    const loop = {
      prompt: 'check CI', status: 'active', mode: 'self_paced', interval_seconds: 0, current_delay: 60, times: 0, until: '', max_ticks: 5, ticks_fired: 1, created_at: 1_795_251_600,
      last_fired_at: 1_795_251_600, next_due_at: 1_795_251_660, awaiting_response: false, deferred_by_goal: true
    }
    const goal = { ...GOAL, wait_barrier: { type: 'pid', target: 4242, reason: 'the build is running' } }
    const parsed = frame({ control: { goal, loop, heartbeat: { prompt: 'x', status: 'sleeping' }, revision: 'r2', updated_at: 1 } })
    expect(parsed).toMatchObject({
      event: {
        type: 'control',
        control: {
          goal: { waiting: { on: 'process', pid: 4242, why: 'the build is running' } },
          loop: { mode: 'self-paced', ticks: { fired: 1, max: 5 }, nextAt: 1_795_251_660_000, heldByGoal: true, pausedWhy: null },
          heartbeat: null
        }
      }
    })
  })

  it('is a frame Highwing cannot use without the state', () => {
    expect(frame({})).toMatchObject({ event: null, skipped: 'invalid' })
  })
})
