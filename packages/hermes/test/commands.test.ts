import { describe, expect, it } from 'vitest'
import type { Outcome } from '../src/domain/command'
import type { SideId } from '../src/domain/session'
import type { SlashCatalog } from '../src/domain/slash'
import { settle } from '../src/testing/clock'
import { ID, refusal, stage, started } from './support/actor'

const DONE: Outcome = { ok: true, value: undefined }

describe('tune', () => {
  it.each([
    ['YOLO on', { set: 'yolo', on: true }, { key: 'yolo', value: 'on' }, { key: 'yolo', value: '1', scope: 'session' }, { yolo: true }],
    ['YOLO off', { set: 'yolo', on: false }, { key: 'yolo', value: 'off' }, { key: 'yolo', value: '0', scope: 'session' }, { yolo: false }],
    ['fast on', { set: 'fast', on: true }, { key: 'fast', value: 'fast' }, { key: 'fast', value: 'fast' }, { fast: true }],
    ['fast off', { set: 'fast', on: false }, { key: 'fast', value: 'normal' }, { key: 'fast', value: 'normal' }, { fast: false }]
  ] as const)('%s is one config.set for this chat, with no scope, and takes the state Hermes answers', async (_, set, params, reply, tuning) => {
    const { actor, command, sent, answer } = await stage()
    const done = command({ do: 'tune', sessionId: ID, ...set })
    expect(sent()).toEqual([['config.set', { session_id: ID, ...params }]])
    await answer('config.set', reply)
    expect(await done).toEqual(DONE)
    expect(actor.session.tuning).toMatchObject(tuning)
  })

  it('takes the YOLO from the reply, not from what was asked', async () => {
    const { actor, command, answer } = await stage()
    const done = command({ do: 'tune', sessionId: ID, set: 'yolo', on: true })
    await answer('config.set', { key: 'yolo', value: '0', scope: 'session' })
    expect(await done).toEqual(DONE)
    expect(actor.session.tuning.yolo).toBe(false)
  })

  it('says why fast was refused for a model without it, and keeps the state', async () => {
    const { actor, command, answer } = await stage()
    const done = command({ do: 'tune', sessionId: ID, set: 'fast', on: true })
    await answer('config.set', refusal('fast_unavailable'))
    expect(await done).toEqual({ ok: false, refusal: { kind: 'rejected', message: "This chat's model has no fast mode." } })
    expect(actor.session.tuning.fast).toBeNull()
  })

  it('sets the effort with a fenced reasoning mutate, and leaves the level to the session.info Hermes pushes', async () => {
    const { actor, command, sent, answer, event } = await stage()
    const done = command({ do: 'tune', sessionId: ID, set: 'effort', to: 'high' })
    expect(sent()).toEqual([['session.mutate', { session_id: ID, request_id: 'id-1', expected_revision: 3, expected_generation: 0, operation: 'reasoning', payload: { effort: 'high' } }]])
    event({ type: 'meta', tuning: { effort: 'high' } }, null)
    await answer('session.mutate', { session_id: ID, operation: 'reasoning', revision: 4, execution_generation: 1, effort: 'high' })
    expect(await done).toEqual(DONE)
    expect(actor.session.tuning.effort).toBe('high')
  })

  it('sends a null effort for the model\'s own level, with the running generation during a turn', async () => {
    const { command, sent, event } = await stage()
    event(started, 2)
    void command({ do: 'tune', sessionId: ID, set: 'effort', to: 'default' })
    expect(sent()).toMatchObject([['session.mutate', { expected_generation: 2, operation: 'reasoning', payload: { effort: null } }]])
  })
})

const CATALOG: SlashCatalog = [
  { kind: 'command', name: 'title', description: 'Set a title' },
  { kind: 'command', name: 'btw', description: 'Ask a side question' },
  { kind: 'command', name: 'bg', description: 'Run a prompt in the background' },
  { kind: 'command', name: 'busy', description: 'Control how messages behave while Hermes is working' },
  { kind: 'command', name: 'fast', description: 'Fast mode' },
  { kind: 'command', name: 'reasoning', description: 'Manage reasoning effort and display' },
  { kind: 'command', name: 'rollback', description: 'List or restore filesystem checkpoints' }
]

describe('side', () => {
  it.each([
    ['btw', 'prompt.btw'],
    ['background', 'prompt.background']
  ] as const)('%s sends the words with the chat alone, and holds the task running until its answer', async (kind, method) => {
    const { actor, command, sent, answer, event } = await stage()
    const done = command({ do: 'side', sessionId: ID, kind, text: 'Which file was it?' })
    expect(sent()).toEqual([[method, { session_id: ID, text: 'Which file was it?' }]])
    await answer(method, { task_id: 'task_1' })
    expect(await done).toEqual(DONE)
    expect(actor.session.sides).toEqual([{ id: 'task_1', kind, asked: 'Which file was it?', state: { s: 'running' } }])
    event({ type: 'side.answered', id: 'task_1' as SideId, kind, asked: null, text: 'notes.md' }, null)
    expect(actor.session.sides[0]?.state).toEqual({ s: 'done', text: 'notes.md' })
  })

  it('sends nothing while offline, since only a socket that has the chat attached may ask', async () => {
    const { actor, command, sent, drop } = await stage()
    drop()
    expect(await command({ do: 'side', sessionId: ID, kind: 'btw', text: 'why?' })).toMatchObject({ ok: false, refusal: { kind: 'offline' } })
    expect(sent()).toEqual([])
    expect(actor.session.sides).toEqual([])
  })

  it('holds nothing when Hermes refuses a socket that has not attached the chat', async () => {
    const { actor, command, answer } = await stage()
    const done = command({ do: 'side', sessionId: ID, kind: 'btw', text: 'why?' })
    await answer('prompt.btw', refusal('permission_denied'))
    expect(await done).toMatchObject({ ok: false, refusal: { kind: 'not-attached' } })
    expect(actor.session.sides).toEqual([])
  })
})

describe('the slash commands Highwing runs itself', () => {
  const typed = async (text: string) => {
    const staged = await stage({ hub: { settledCatalog: async () => CATALOG } })
    return { ...staged, done: staged.command({ do: 'send', sessionId: ID, text }) }
  }

  it.each([
    ['/btw Which file was it?', 'prompt.btw', { session_id: ID, text: 'Which file was it?' }],
    ['/bg   tidy the notes  ', 'prompt.background', { session_id: ID, text: 'tidy the notes' }]
  ])('%s runs the side command, while a turn runs too, and shows nothing under the composer', async (text, method, params) => {
    const { done, sent, answer, event } = await typed(text)
    event(started)
    await settle()
    expect(sent()).toEqual([[method, params]])
    await answer(method, { task_id: 'task_1' })
    expect(await done).toEqual({ ok: true, value: null })
  })

  it('says how to type a side question it cannot run, and sends nothing', async () => {
    const { done, sent } = await typed('/btw')
    expect(await done).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'Type it as /btw <question>.' } })
    expect(sent()).toEqual([])
  })

  it.each([
    ['/busy steer', { key: 'busy', value: 'steer' }, { key: 'busy', value: 'steer', scope: 'session' }, { busy: 'steer' }, 'busy input mode: steer'],
    ['/fast on', { key: 'fast', value: 'fast' }, { key: 'fast', value: 'fast' }, { fast: true }, 'fast mode: fast'],
    ['/reasoning hide', { key: 'show_reasoning', value: 'off' }, { key: 'show_reasoning', value: '0', scope: 'session' }, { reasoning: false }, 'reasoning: hide']
  ] as const)('%s sets the switch with tune, takes the state Hermes answers, and says so under the composer', async (text, params, reply, tuning, says) => {
    const { actor, done, sent, answer } = await typed(text)
    await settle()
    expect(sent()).toEqual([['config.set', { session_id: ID, ...params }]])
    await answer('config.set', reply)
    expect(await done).toEqual({ ok: true, value: says })
    expect(actor.session.tuning).toMatchObject(tuning)
  })

  it('sets a reasoning level with the reasoning mutate', async () => {
    const { done, sent, answer } = await typed('/reasoning xhigh')
    await settle()
    expect(sent()).toMatchObject([['session.mutate', { operation: 'reasoning', payload: { effort: 'xhigh' } }]])
    await answer('session.mutate', { session_id: ID, operation: 'reasoning', revision: 4, execution_generation: 1, effort: 'xhigh' })
    expect(await done).toEqual({ ok: true, value: 'reasoning: xhigh' })
  })

  it('shows Hermes\'s refusal of a switch, and says nothing was set', async () => {
    const { done, answer } = await typed('/fast on')
    await settle()
    await answer('config.set', refusal('fast_unavailable'))
    expect(await done).toEqual({ ok: false, refusal: { kind: 'rejected', message: "This chat's model has no fast mode." } })
  })

  it('leaves a status read to Hermes', async () => {
    const { sent } = await typed('/busy status')
    await settle()
    expect(sent()).toEqual([['command.dispatch', { session_id: ID, name: 'busy', arg: 'status' }]])
  })

  it('lists the checkpoints with /rollback, under the composer', async () => {
    const { done, sent, answer } = await typed('/rollback')
    await settle()
    expect(sent()).toEqual([['rollback.list', { session_id: ID }]])
    await answer('rollback.list', { enabled: true, checkpoints: [{ hash: '4f1c2a9e0b7d', timestamp: '2026-11-24T10:05:00+00:00', message: 'before write_file notes.md' }] })
    expect(await done).toMatchObject({ ok: true, value: expect.stringContaining('1. 4f1c2a9e  2026-11-24T10:05:00+00:00  before write_file notes.md') })
  })

  it('refuses a whole-folder /rollback while a turn runs, and restores one file then', async () => {
    const { command, sent, answer, event } = await stage({ hub: { settledCatalog: async () => CATALOG } })
    event(started)
    expect(await command({ do: 'send', sessionId: ID, text: '/rollback 2' })).toEqual({ ok: false, refusal: { kind: 'stale', message: 'Wait for the reply to finish, then try again.' } })
    expect(sent()).toEqual([])
    const done = command({ do: 'send', sessionId: ID, text: '/rollback 2 notes.md' })
    await settle()
    expect(sent()).toEqual([['rollback.restore', { session_id: ID, hash: '2', file_path: 'notes.md' }]])
    await answer('rollback.restore', { success: true, restored_to: '4f1c2a9e', file: 'notes.md' })
    expect(await done).toEqual({ ok: true, value: 'Restored notes.md from checkpoint 2.' })
  })

  it('shows Hermes\'s reason when it cannot restore a /rollback number', async () => {
    const { done, answer } = await typed('/rollback 9')
    await settle()
    await answer('rollback.restore', { success: false, error: 'Invalid checkpoint number. Use 1-3.' })
    expect(await done).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'Invalid checkpoint number. Use 1-3.' } })
  })

  it('renames with /title, and leaves a bare /title to Hermes', async () => {
    const titled = await typed('/title Notes cleanup')
    await settle()
    expect(titled.sent()).toMatchObject([['session.mutate', { operation: 'rename', payload: { title: 'Notes cleanup' } }]])
    const bare = await typed('/title')
    await settle()
    expect(bare.sent()).toEqual([['command.dispatch', { session_id: ID, name: 'title' }]])
  })
})

describe('move', () => {
  it('moves the chat with a fenced workspace mutate, and takes the folder from the session.info Hermes pushes', async () => {
    const { actor, command, sent, answer, event } = await stage()
    const done = command({ do: 'move', sessionId: ID, cwd: '/work/docs' })
    expect(sent()).toEqual([['session.mutate', { session_id: ID, request_id: 'id-1', expected_revision: 3, expected_generation: 0, operation: 'workspace', payload: { cwd: '/work/docs' } }]])
    event({ type: 'meta', cwd: '/work/docs' }, null)
    await answer('session.mutate', { session_id: ID, operation: 'workspace', revision: 4, execution_generation: 1, cwd: '/work/docs' })
    expect(await done).toEqual(DONE)
    expect(actor.session.cwd).toBe('/work/docs')
  })

  it('is refused while a turn runs, and sends nothing', async () => {
    const { command, sent, event } = await stage()
    event(started)
    expect(await command({ do: 'move', sessionId: ID, cwd: '/work/docs' })).toMatchObject({ ok: false, refusal: { kind: 'stale' } })
    expect(sent()).toEqual([])
  })

  it('says the folder is not there when Hermes cannot find it', async () => {
    const { command, answer } = await stage()
    const done = command({ do: 'move', sessionId: ID, cwd: '/nowhere' })
    await answer('session.mutate', refusal('invalid_params'))
    expect(await done).toEqual({ ok: false, refusal: { kind: 'rejected', message: "That folder isn't on the machine Hermes runs on." } })
  })
})

describe('compress', () => {
  const summary = { headline: 'Compressed: 12 → 4 messages', token_line: 'Approx request size: ~9,000 → ~2,000 tokens', note: null }

  it('sends the focus with a fenced compress mutate, answers Hermes\'s report, and reads the chat again', async () => {
    const { actor, command, sent, answer, event } = await stage()
    const done = command({ do: 'compress', sessionId: ID, focus: 'the changelog' })
    expect(sent()).toEqual([['session.mutate', { session_id: ID, request_id: 'id-1', expected_revision: 3, expected_generation: 0, operation: 'compress', payload: { focus: 'the changelog' } }]])
    event({ type: 'meta', revision: 4, rewritten: true }, null)
    await answer('session.mutate', { session_id: ID, operation: 'compress', revision: 4, execution_generation: 1, summary })
    expect(await done).toEqual({ ok: true, value: 'Compressed: 12 → 4 messages\nApprox request size: ~9,000 → ~2,000 tokens' })
    expect(actor.session.sync.state).toBe('rebuilding')
    expect(sent().at(-1)).toEqual(['session.resume', { session_id: ID, display_projection: true }])
  })

  it('sends no focus when none is given, and shows the report of a compression that removed nothing', async () => {
    const { actor, command, sent, answer } = await stage()
    const done = command({ do: 'compress', sessionId: ID, focus: null })
    expect(sent()).toMatchObject([['session.mutate', { operation: 'compress', payload: {} }]])
    await answer('session.mutate', { session_id: ID, operation: 'compress', status: 'noop', summary: { headline: 'No changes from compression: 2 messages', token_line: '', note: null } })
    expect(await done).toEqual({ ok: true, value: 'No changes from compression: 2 messages' })
    expect(actor.session.sync.state).toBe('live')
  })

  it('is refused while a turn runs, and sends nothing', async () => {
    const { command, sent, event } = await stage()
    event(started)
    expect(await command({ do: 'compress', sessionId: ID, focus: null })).toMatchObject({ ok: false, refusal: { kind: 'stale' } })
    expect(sent()).toEqual([])
  })

  it.each([
    ['/compress', {}],
    ['/compress the changelog', { focus: 'the changelog' }]
  ])('%s runs the compress command', async (text, payload) => {
    const { sent, command } = await stage({ hub: { settledCatalog: async () => [...CATALOG, { kind: 'command', name: 'compress', description: 'Compress' }] } })
    void command({ do: 'send', sessionId: ID, text })
    await settle()
    expect(sent()).toMatchObject([['session.mutate', { operation: 'compress', payload }]])
  })

  it.each(['/compress here 3', '/compress --preview'])('leaves %s, a form Highwing does not send, to Hermes', async text => {
    const { sent, command } = await stage({ hub: { settledCatalog: async () => [...CATALOG, { kind: 'command', name: 'compress', description: 'Compress' }] } })
    void command({ do: 'send', sessionId: ID, text })
    await settle()
    expect(sent()).toMatchObject([['command.dispatch', { name: 'compress' }]])
  })
})

describe('export', () => {
  it('asks Hermes to render the chat in the format, and answers the file name and text', async () => {
    const { command, sent, answer } = await stage()
    const done = command({ do: 'export', sessionId: ID, format: 'md' })
    expect(sent()).toEqual([['session.export', { session_id: ID, format: 'md' }]])
    await answer('session.export', { format: 'md', filename: 'hermes_session_s1.md', content: '# Session: s1' })
    expect(await done).toEqual({ ok: true, value: { filename: 'hermes_session_s1.md', content: '# Session: s1' } })
  })

  it('says when the chat is too large to export', async () => {
    const { command, answer } = await stage()
    const done = command({ do: 'export', sessionId: ID, format: 'json' })
    await answer('session.export', refusal('export_too_large'))
    expect(await done).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'This chat is too large for Hermes to export.' } })
  })
})

describe('remove', () => {
  it('deletes the chat at its generation, then moves a window off it before the list drops it', async () => {
    const gone: string[] = []
    const { command, sent, answer } = await stage({ hub: { drop: id => void gone.push(`drop ${id}`), gone: id => void gone.push(`gone ${id}`) } })
    const done = command({ do: 'remove', sessionId: ID })
    expect(sent()).toEqual([['session.mutate', { session_id: ID, request_id: 'id-1', operation: 'delete', payload: {}, expected_revision: 3, expected_generation: 0 }]])
    await answer('session.mutate', { session_id: ID, operation: 'delete' })
    expect(await done).toEqual(DONE)
    expect(gone).toEqual([`gone ${ID}`, `drop ${ID}`])
  })

  it('refuses while a reply runs, asking Hermes nothing', async () => {
    const { command, sent, event } = await stage()
    event(started)
    expect(await command({ do: 'remove', sessionId: ID })).toEqual({ ok: false, refusal: { kind: 'stale', message: 'Wait for the reply to finish, then remove this chat.' } })
    expect(sent()).toEqual([])
  })

  it.each([
    ['session_busy', 'Wait for the reply to finish, then remove this chat.'],
    ['unknown_execution', 'Wait for the reply to finish, then remove this chat.'],
    ['runtime_coordination_required', "Hermes can't remove this chat. You can archive it instead."]
  ])('says why Hermes refused with %s in plain words, and keeps the chat', async (reason, message) => {
    const gone: string[] = []
    const { command, answer } = await stage({ hub: { drop: id => void gone.push(id), gone: id => void gone.push(id) } })
    const done = command({ do: 'remove', sessionId: ID })
    await answer('session.mutate', refusal(reason))
    expect(await done).toMatchObject({ ok: false, refusal: { message } })
    expect(gone).toEqual([])
  })
})
