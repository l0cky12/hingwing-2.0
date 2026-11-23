import { describe, expect, it } from 'vitest'
import { manualClock, settle } from '../src/testing/clock'
import { scriptedDialer, type Fixture, type ScriptOptions } from '../src/testing/fixture'
import { ERRAND, paramsOf, PROFILES, SESSION, SLASH, WITH_BOTS } from './support/errand'

interface Reply {
  readonly id?: number
  readonly result?: Record<string, unknown>
  readonly error?: { readonly code: number; readonly message: string; readonly data?: Record<string, unknown> }
}

async function rawSocket(options: ScriptOptions = {}, fixture: Fixture = ERRAND) {
  const script = scriptedDialer(fixture, { clock: manualClock(), ...options })
  const socket = await script({ start: false })
  const frames: Reply[] = []
  socket.onText = text => frames.push(JSON.parse(text) as Reply)
  let ids = 0
  const call = async (method: string, params?: unknown): Promise<Reply> => {
    const id = ++ids
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    await settle()
    const reply = frames.find(frame => frame.id === id)
    if (reply === undefined) throw new Error(`${method} got no reply`)
    return reply
  }
  return { script, call, frames }
}

const without = (params: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(params).filter(([held]) => held !== key))
const refusal = (reason: string, more: Record<string, unknown> = {}) => ({ error: { code: 4001, message: reason, data: { reason, ...more } } })
const ANSWER = paramsOf('approval.respond')
const SUBMIT = paramsOf('prompt.submit')

describe('the scripted gateway refuses a wrong key set', () => {
  it('an unknown key, before any handler runs', async () => {
    const { call } = await rawSocket()
    expect(await call('approval.respond', { ...ANSWER, all: true })).toMatchObject(refusal('invalid_params', { fields: ['all'] }))
    expect(await call('session.resume', { session_id: SESSION, history: true })).toMatchObject(refusal('invalid_params', { fields: ['history'] }))
    expect(await call('runtime.describe', { verbose: true })).toMatchObject(refusal('invalid_params', { fields: ['verbose'] }))
  })

  it('a missing key on a canonical-only method', async () => {
    const { call } = await rawSocket()
    expect(await call('session.detach', { session_id: SESSION })).toMatchObject(refusal('invalid_params', { fields: ['subscription_id'] }))
    expect(await call('clarify.respond', { session_id: SESSION, execution_generation: 1, prompt_id: 'p' })).toMatchObject(refusal('invalid_params', { fields: ['answer'] }))
  })

  it('a missing key the handler checks for itself', async () => {
    const { call } = await rawSocket()
    const reply = await call('approval.respond', without(ANSWER, 'choice'))
    expect(reply).toMatchObject(refusal('invalid_params'))
    expect(reply.error?.data).not.toHaveProperty('fields')
    await call('session.resume', { session_id: SESSION })
    expect(await call('prompt.submit', without(SUBMIT, 'input_id'))).toMatchObject(refusal('invalid_params'))
  })

  it('a value of the wrong type, and params that are not an object', async () => {
    const { call } = await rawSocket()
    expect(await call('prompt.submit', { ...SUBMIT, text: 7 })).toMatchObject(refusal('invalid_params', { fields: ['text'] }))
    expect(await call('session.list', { limit: 500 })).toMatchObject(refusal('invalid_params'))
    expect(await call('session.resume', [SESSION])).toMatchObject(refusal('invalid_params'))
  })

  it('and answers a method nobody declares with -32601', async () => {
    const { call } = await rawSocket()
    expect(await call('approval.answer', ANSWER)).toMatchObject({ error: { code: -32601, data: { reason: 'unknown_method' } } })
  })
})

describe('the scripted gateway refuses a session verb on a socket that has not attached the session', () => {
  it('a submit and an answer are permission_denied until the socket resumes the session', async () => {
    const { call } = await rawSocket()
    expect(await call('prompt.submit', SUBMIT)).toMatchObject(refusal('permission_denied'))
    expect(await call('approval.respond', ANSWER)).toMatchObject(refusal('permission_denied'))
    expect(await call('clarify.respond', { session_id: SESSION, execution_generation: 1, prompt_id: 'p', answer: 'yes' })).toMatchObject(refusal('permission_denied'))

    expect(await call('session.resume', { session_id: SESSION })).toMatchObject({ result: { session_id: SESSION, running: false, last_sequence: 0 } })
    expect(await call('prompt.submit', SUBMIT)).toMatchObject({ result: { status: 'queued' } })
  })

  it('attachment ends with a detach, and belongs to one socket', async () => {
    const { script, call } = await rawSocket()
    const { result } = await call('session.resume', { session_id: SESSION })
    expect(await call('session.detach', { session_id: SESSION, subscription_id: 'not-mine' })).toMatchObject({ result: { detached: false } })
    expect(await call('session.detach', { session_id: SESSION, subscription_id: result?.subscription_id })).toMatchObject({ result: { detached: true } })
    expect(await call('prompt.submit', SUBMIT)).toMatchObject(refusal('permission_denied'))

    const other = await script({ start: false })
    const replies: Reply[] = []
    other.onText = text => replies.push(JSON.parse(text) as Reply)
    other.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'prompt.submit', params: SUBMIT }))
    await settle()
    expect(replies.find(frame => frame.id === 1)).toMatchObject(refusal('permission_denied'))
  })

  it('an answer for a turn that is not running is stale_generation, and a session it does not have is not_found', async () => {
    const { call } = await rawSocket()
    await call('session.resume', { session_id: SESSION })
    expect(await call('approval.respond', ANSWER)).toMatchObject(refusal('stale_generation'))
    expect(await call('session.resume', { session_id: 'local-other' })).toMatchObject(refusal('not_found'))
  })
})

describe('the scripted gateway', () => {
  it('speaks first with gateway.ready, and answers the heartbeat from any socket', async () => {
    const { call, frames } = await rawSocket()
    await settle()
    expect(frames[0]).toMatchObject({ method: 'event', params: { type: 'gateway.ready', payload: { session_authority: true } } })
    expect(await call('gateway.ping')).toMatchObject({ result: { ok: true } })
  })

  it('answers events.since from its ring, and asks for a snapshot on another epoch or a cursor ahead of it', async () => {
    const { call } = await rawSocket()
    const { result } = await call('session.resume', { session_id: SESSION })
    const replay_epoch = result?.replay_epoch
    expect(await call('session.events.since', { session_id: SESSION, last_seen: 0, replay_epoch })).toMatchObject({ result: { events: [], snapshot_required: false, epoch: replay_epoch } })
    expect(await call('session.events.since', { session_id: SESSION, last_seen: 0, replay_epoch: 'another' })).toMatchObject({ result: { snapshot_required: true } })
    expect(await call('session.events.since', { session_id: SESSION, last_seen: 9, replay_epoch })).toMatchObject({ result: { snapshot_required: true } })
    expect(await call('session.events.since', { session_id: SESSION, last_seen: -1, replay_epoch })).toMatchObject(refusal('invalid_params'))
  })

  it('fails the story on a call it did not expect', async () => {
    const { script, call } = await rawSocket()
    await call('session.resume', { session_id: SESSION })
    expect(await call('session.interrupt', { session_id: SESSION, execution_generation: 0 })).toMatchObject({ error: { code: -32603 } })
    await expect(script.done).rejects.toThrow('the story did not expect session.interrupt at step 0: it waits for prompt.submit')
  })
})

describe('the scripted gateway answers the slash catalog and command calls as Hermes does', () => {
  it('answers commands.catalog from the fixture, with or without a session', async () => {
    const { call } = await rawSocket({}, SLASH)
    expect((await call('commands.catalog', {})).result).toEqual(SLASH.header.catalog)
    expect((await call('commands.catalog', { session_id: SESSION, profile: 'default' })).result).toEqual(SLASH.header.catalog)
  })

  it('refuses a commands.catalog key the handler does not declare, a value that is not text, and another session', async () => {
    const { call } = await rawSocket({}, SLASH)
    expect(await call('commands.catalog', { text: '/' })).toMatchObject(refusal('invalid_params'))
    expect(await call('commands.catalog', { session_id: 7 })).toMatchObject(refusal('invalid_params'))
    expect(await call('commands.catalog', { profile: null })).toMatchObject(refusal('invalid_params'))
    expect(await call('commands.catalog', { session_id: 'someone-else' })).toMatchObject(refusal('not_found'))
  })

  it('does not know commands.catalog when the fixture has no catalog, as an older Hermes', async () => {
    const { call } = await rawSocket()
    expect(await call('commands.catalog', {})).toMatchObject({ error: { code: -32601, data: { reason: 'unknown_method' } } })
  })

  it('answers profiles.list from the fixture, and refuses a key the contract does not declare', async () => {
    const { script, call } = await rawSocket({}, WITH_BOTS)
    expect((await call('profiles.list', {})).result).toEqual(PROFILES)
    expect((await call('profiles.list', { include_sessions: true })).result).toEqual(PROFILES)
    expect(await call('profiles.list', { session_id: SESSION })).toMatchObject(refusal('invalid_params', { fields: ['session_id'] }))
    expect(script.step, 'the story has not moved').toBe(0)
  })

  it('does not know profiles.list when the fixture has no profiles, as an older Hermes', async () => {
    const { script, call } = await rawSocket()
    expect(await call('profiles.list', {})).toMatchObject({ error: { code: -32601, data: { reason: 'unknown_method' } } })
    expect(script.step, 'the story has not moved').toBe(0)
  })

  it('refuses a command.dispatch with an undeclared key, a value that is not text, or a name of more than one word', async () => {
    const { call } = await rawSocket({}, SLASH)
    const dispatch = { session_id: SESSION, name: 'status' }
    expect(await call('command.dispatch', { ...dispatch, command: '/status' })).toMatchObject(refusal('invalid_params'))
    expect(await call('command.dispatch', { ...dispatch, arg: 3 })).toMatchObject(refusal('invalid_params'))
    expect(await call('command.dispatch', { ...dispatch, name: 'status now' })).toMatchObject(refusal('invalid_params'))
    expect(await call('command.dispatch', { ...dispatch, session_id: 'someone-else' })).toMatchObject(refusal('not_found'))
  })
})
