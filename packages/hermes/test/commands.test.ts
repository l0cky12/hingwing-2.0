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
  { kind: 'command', name: 'bg', description: 'Run a prompt in the background' }
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

  it('renames with /title, and leaves a bare /title to Hermes', async () => {
    const titled = await typed('/title Notes cleanup')
    await settle()
    expect(titled.sent()).toMatchObject([['session.mutate', { operation: 'rename', payload: { title: 'Notes cleanup' } }]])
    const bare = await typed('/title')
    await settle()
    expect(bare.sent()).toEqual([['command.dispatch', { session_id: ID, name: 'title' }]])
  })
})
