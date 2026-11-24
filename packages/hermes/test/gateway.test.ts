import { describe, expect, it } from 'vitest'
import { manualClock, settle } from '../src/testing/clock'
import { scriptedDialer, type Fixture, type ScriptOptions } from '../src/testing/fixture'
import { BOUND, ERRAND, NO_HOME_CHAT, paramsOf, PROFILES, RESEARCH_CHAT, RESEARCH_SAID, SESSION, SLASH, WITH_BOTS } from './support/errand'

interface Reply {
  readonly id?: number
  readonly method?: string
  readonly params?: { readonly type: string; readonly session_id?: string; readonly payload: Record<string, unknown> }
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
    const { script, call } = await rawSocket({}, NO_HOME_CHAT)
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

const RESEARCH = { profile: 'research', session_id: RESEARCH_CHAT }
const canonicalOf = (reply: Reply, name: string) =>
  (reply.result?.profiles as { name: string; canonical_session?: { id: string } | null }[]).find(row => row.name === name)?.canonical_session
const eventsOf = (frames: readonly Reply[], sessionId: string) =>
  frames.flatMap(frame => (frame.method === 'event' && frame.params?.session_id === sessionId ? [frame.params] : []))

describe('the scripted gateway routes a frame by the profile it names, as the dispatcher does', () => {
  it('refuses a profile nobody serves, and on a profile-bound socket every profile but its own', async () => {
    const host = await rawSocket({}, WITH_BOTS)
    expect(await host.call('session.list', { profile: 'nobody', title: 'Bot Chat' })).toMatchObject(refusal('profile_mismatch'))
    expect(await host.call('session.resume', RESEARCH)).toMatchObject({ result: { session_id: RESEARCH_CHAT } })

    const bound = await rawSocket({}, BOUND)
    expect(await bound.call('session.resume', RESEARCH)).toMatchObject(refusal('profile_mismatch'))
    expect(await bound.call('session.create', { profile: 'research', title: 'Bot Chat', hidden: true })).toMatchObject(refusal('profile_mismatch'))
    expect(await bound.call('session.resume', { profile: 'default', session_id: SESSION })).toMatchObject({ result: { session_id: SESSION } })
  })

  it('answers the usage a fixture cans, and refuses both reads as unknown methods without it', async () => {
    const usage = { before: { input_tokens: 0, last_prompt_tokens: 6000, context_length: 200_000 }, after: { input_tokens: 1204 }, breakdown: { categories: [], model: 'fast-small' } }
    const { call } = await rawSocket({}, { ...ERRAND, header: { ...ERRAND.header, usage } })
    expect(await call('session.stats', { session_id: SESSION })).toMatchObject({ result: usage.before })
    expect(await call('session.context_breakdown', { session_id: SESSION })).toMatchObject({ result: usage.breakdown })
    expect(await call('session.stats', { session_id: 'someone-else' })).toMatchObject(refusal('not_found'))

    const older = await rawSocket()
    const unknown = { error: { code: -32601, data: { reason: 'unknown_method' } } }
    expect(await older.call('session.stats', { session_id: SESSION })).toMatchObject(unknown)
    expect(await older.call('session.context_breakdown', { session_id: SESSION })).toMatchObject(unknown)
  })

  it("answers for a bot's session only on a frame that names the bot", async () => {
    const { call } = await rawSocket({}, { ...WITH_BOTS, header: { ...WITH_BOTS.header, models: { providers: [] } } })
    expect(await call('session.resume', { session_id: RESEARCH_CHAT })).toMatchObject(refusal('not_found'))
    expect(await call('session.resume', { profile: 'timothy', session_id: RESEARCH_CHAT })).toMatchObject(refusal('not_found'))
    expect(await call('session.events.since', { session_id: RESEARCH_CHAT, last_seen: 0 })).toMatchObject(refusal('not_found'))
    expect(await call('model.options', { session_id: RESEARCH_CHAT })).toMatchObject(refusal('not_found'))

    const { result } = await call('session.resume', RESEARCH)
    const submit = { session_id: RESEARCH_CHAT, text: 'hello', input_id: 'input-1' }
    expect(await call('prompt.submit', submit)).toMatchObject(refusal('permission_denied'))
    const detach = { session_id: RESEARCH_CHAT, subscription_id: result?.subscription_id }
    expect(await call('session.detach', detach), 'a forgotten profile detaches nothing and says so only in the reply').toMatchObject({ result: { detached: false } })
    expect(await call('prompt.submit', { ...submit, profile: 'research' })).toMatchObject({ result: { status: 'queued' } })
    expect(await call('model.options', { ...RESEARCH })).toMatchObject({ result: { model: 'research-model' } })
    expect(await call('session.detach', { ...detach, profile: 'research' })).toMatchObject({ result: { detached: true } })
  })

  it('drops the profile of a strict session verb before its key check, and of no other call', async () => {
    const { call } = await rawSocket({}, WITH_BOTS)
    const home = { profile: 'default', session_id: SESSION }
    const { result } = await call('session.resume', home)
    expect(await call('clarify.respond', { ...home, execution_generation: 1, prompt_id: 'p', answer: 'yes' })).toMatchObject(refusal('stale_generation'))
    expect(await call('clarify.respond', { ...home, execution_generation: 1, prompt_id: 'p', answer: 'yes', bogus: 1 })).toMatchObject(refusal('invalid_params', { fields: ['bogus'] }))
    expect(await call('session.detach', { ...home, subscription_id: result?.subscription_id })).toMatchObject({ result: { detached: true } })
    expect(await call('runtime.describe', { profile: 'default' })).toMatchObject(refusal('invalid_params', { fields: ['profile'] }))
  })
})

describe("the scripted gateway plays a bot's Bot Chat", () => {
  it('resumes it with the line its row previews, and answers a message as the bot the frame names', async () => {
    const { call, frames } = await rawSocket({}, WITH_BOTS)
    const opened = await call('session.resume', { ...RESEARCH, display_projection: true })
    expect(opened.result).toMatchObject({ session_id: RESEARCH_CHAT, running: false, display_messages: [{ role: 'assistant', text: RESEARCH_SAID }], info: { model: 'research-model' } })

    const receipt = await call('prompt.submit', { ...RESEARCH, text: 'hello', input_id: 'input-1' })
    expect(receipt.result).toMatchObject({ status: 'queued', ref: { session_id: RESEARCH_CHAT } })
    const turn = eventsOf(frames, RESEARCH_CHAT)
    expect(turn.map(event => event.type)).toEqual(['session.info', 'message.start', 'message.delta', 'message.complete'])
    expect(turn[0]?.payload).toMatchObject({ pending: [{ admission_id: receipt.result?.admission_id, input_id: 'input-1', text: 'hello' }] })
    expect(turn[2]?.payload).toMatchObject({ text: 'research: hello' })
    expect(frames.indexOf(receipt), 'the receipt comes before the turn').toBeLessThan(frames.findIndex(frame => frame.params?.type === 'message.start'))

    const again = await call('session.resume', { ...RESEARCH, display_projection: true })
    expect(again.result?.display_messages).toMatchObject([{ text: RESEARCH_SAID }, { role: 'user', text: 'hello' }, { role: 'assistant', text: 'research: hello' }])
    expect(await call('session.events.since', { ...RESEARCH, last_seen: 2, replay_epoch: again.result?.replay_epoch })).toMatchObject({ result: { count: 2, snapshot_required: false } })
    expect(await call('session.mutate', { ...RESEARCH, request_id: 'r', expected_revision: 0, operation: 'rename', payload: { title: 'x' } })).toMatchObject(refusal('unsupported_command'))
  })

  it('finds a Bot Chat by its title, and creates one once for a bot that has none', async () => {
    const { call } = await rawSocket({}, WITH_BOTS)
    const titled = { title: 'Bot Chat', include_hidden: true }
    expect(await call('session.list', { profile: 'research', ...titled })).toMatchObject({ result: { scope: 'stored', sessions: [{ session_id: RESEARCH_CHAT, resolved_id: RESEARCH_CHAT }] } })
    expect(await call('session.list', titled)).toMatchObject({ result: { sessions: [{ session_id: SESSION }] } })
    expect(await call('session.list', { profile: 'hermes-dev', ...titled })).toMatchObject({ result: { scope: 'stored', sessions: [] } })
    expect(await call('session.list', { ...titled, scope: 'stored' })).toMatchObject(refusal('invalid_params'))

    const create = { profile: 'hermes-dev', source: 'gui', title: 'Bot Chat', hidden: true, follow_profile_config: true, request_id: 'r-1' }
    expect(await call('session.create', { ...create, hidden: 'yes' })).toMatchObject(refusal('invalid_params'))
    expect(await call('session.create', { ...create, hide: true })).toMatchObject(refusal('invalid_params', { fields: ['hide'] }))
    const made = await call('session.create', create)
    expect(made.result).toMatchObject({ session_id: 'bot-chat-hermes-dev', messages: [] })
    expect((await call('session.create', { ...create, request_id: 'r-2' })).result?.session_id, 'a titled create is get-or-create').toBe('bot-chat-hermes-dev')
    expect(await call('session.list', { profile: 'hermes-dev', ...titled })).toMatchObject({ result: { sessions: [{ session_id: 'bot-chat-hermes-dev' }] } })
    expect(canonicalOf(await call('profiles.list', {}), 'hermes-dev')).toMatchObject({ id: 'bot-chat-hermes-dev', resolved_id: 'bot-chat-hermes-dev' })
    expect((await call('session.create', { ...create, profile: 'research' })).result?.session_id, 'a bot that has one gets it').toBe(RESEARCH_CHAT)
  })

  it('names the story as the Bot Chat of the home bot, unless the fixture says it has none', async () => {
    const { call } = await rawSocket({}, WITH_BOTS)
    const listed = await call('profiles.list', {})
    expect(canonicalOf(listed, 'default')).toMatchObject({ id: SESSION, resolved_id: SESSION })
    expect(canonicalOf(listed, 'research')).toMatchObject({ id: RESEARCH_CHAT, preview: RESEARCH_SAID })
    expect(canonicalOf(listed, 'hermes-dev')).toBeNull()

    const none = await rawSocket({}, NO_HOME_CHAT)
    expect(canonicalOf(await none.call('profiles.list', {}), 'default')).toBeNull()
    expect(await none.call('session.list', { title: 'Bot Chat', include_hidden: true })).toMatchObject({ result: { sessions: [] } })
    const made = await none.call('session.create', { profile: 'default', source: 'gui', title: 'Bot Chat', hidden: true })
    expect(made.result?.session_id).toBe('bot-chat-default')
    expect(none.script.step, 'the story has not moved').toBe(0)
  })

  it("gives a profile-bound socket the other bots' rows with no session fields", async () => {
    const { call } = await rawSocket({}, BOUND)
    const listed = await call('profiles.list', { include_sessions: true })
    expect(canonicalOf(listed, 'default')).toMatchObject({ id: SESSION })
    const research = (listed.result?.profiles as Record<string, unknown>[]).find(row => row.name === 'research')
    expect(research).toMatchObject({ name: 'research', ui_meta: { 'hermes-bots': { title: 'Research' } } })
    expect(Object.keys(research ?? {})).not.toEqual(expect.arrayContaining(['canonical_session']))
    expect(research).not.toHaveProperty('last_session')
  })
})

describe('the scripted gateway makes a new chat on an untitled create', () => {
  const create = { source: 'gui', follow_profile_config: true, request_id: 'draft-1' }

  it('makes an empty chat in the routed profile, and gives a retry with the same request_id the same chat', async () => {
    const { call, script } = await rawSocket({}, WITH_BOTS)
    const made = await call('session.create', create)
    expect(made.result).toMatchObject({ session_id: 'chat-default-1', messages: [] })
    expect((await call('session.create', create)).result?.session_id, 'a retry').toBe('chat-default-1')
    expect((await call('session.create', { ...create, request_id: 'draft-2' })).result?.session_id, 'another draft').toBe('chat-default-2')
    expect((await call('session.create', { ...create, profile: 'research' })).result?.session_id, 'the same draft in another bot').toBe('chat-research-3')
    expect(canonicalOf(await call('profiles.list', {}), 'default'), 'the Bot Chat is still the story').toMatchObject({ id: SESSION })
    expect(script.step, 'the story has not moved').toBe(0)
  })

  it('answers a message there with one turn that echoes it as the routed profile', async () => {
    const { call, frames } = await rawSocket({}, WITH_BOTS)
    await call('session.create', { ...create, profile: 'research' })
    const receipt = await call('prompt.submit', { profile: 'research', session_id: 'chat-research-1', text: 'hello', input_id: 'input-1' })
    expect(receipt.result).toMatchObject({ status: 'queued', ref: { session_id: 'chat-research-1' } })
    expect(eventsOf(frames, 'chat-research-1').find(event => event.type === 'message.delta')?.payload).toMatchObject({ text: 'research: hello' })
    expect((await call('prompt.submit', { session_id: 'chat-research-1', text: 'hello', input_id: 'input-2' })).error, 'it lives in its own profile only').toBeDefined()
  })
})
