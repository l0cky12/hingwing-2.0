import { describe, expect, it } from 'vitest'
import type { Outcome } from '../src/domain/command'
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
