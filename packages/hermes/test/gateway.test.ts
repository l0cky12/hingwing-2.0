import { describe, expect, it } from 'vitest'
import { manualClock, settle } from '../src/testing/clock'
import { MASKED, scriptedDialer, type Fixture, type FixtureStep, type ScriptOptions } from '../src/testing/fixture'
import {
  BOUND, BRANCH, BRANCH_OLD, DOWNLOADS, ERRAND, INVOICES, NO_HOME_CHAT, paramsOf, PICK_ASK, PROFILES, RAE_SAID, REMINDER, RESEARCH_CHAT, RESEARCH_SAID, SESSION, SLASH, SORTED, SORTED_2, SORTED_3,
  SUDO, SUDO_ASK, TEAM, TEAM_NO_RELAY, WITH_BOTS, WITH_CHATS, WITH_VERSIONS, type Added
} from './support/errand'

interface Reply {
  readonly id?: number
  readonly method?: string
  readonly params?: { readonly type: string; readonly session_id?: string; readonly payload: Record<string, unknown> }
  readonly result?: Record<string, unknown>
  readonly error?: { readonly code: number; readonly message: string; readonly data?: Record<string, unknown> }
}

async function rawSocket(options: ScriptOptions = {}, fixture: Fixture = ERRAND) {
  const clock = manualClock()
  const script = scriptedDialer(fixture, { clock, ...options })
  const socket = await script({ start: false })
  const frames: Reply[] = []
  socket.onText = text => frames.push(JSON.parse(text) as Reply)
  let ids = 0
  const post = (method: string, params?: unknown): number => {
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: ++ids, method, params }))
    return ids
  }
  const call = async (method: string, params?: unknown): Promise<Reply> => {
    const id = post(method, params)
    await settle()
    const reply = frames.find(frame => frame.id === id)
    if (reply === undefined) throw new Error(`${method} got no reply`)
    return reply
  }
  return { script, call, post, frames, clock, send: (frame: unknown) => socket.send(JSON.stringify(frame)), played: () => clock.advance(0) }
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
    expect(await call('session.mutate', { ...RESEARCH, request_id: 'r', expected_revision: 0, operation: 'archive', payload: { archived: true } })).toMatchObject(refusal('unsupported_command'))
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

describe("the scripted gateway lists a bot's chats", () => {
  const ids = (reply: Reply) => (reply.result?.sessions as Record<string, unknown>[]).map(row => row.session_id)

  it('lists the seeded and made chats of a profile, newest first, and the running ones live', async () => {
    const { call } = await rawSocket({ clock: manualClock(1_795_260_000_000) }, WITH_CHATS)
    await call('session.create', { profile: 'research', source: 'gui', follow_profile_config: true, request_id: 'draft-1' })
    await call('prompt.submit', { profile: 'research', session_id: 'chat-research-1', text: 'hello', input_id: 'input-1' })
    const stored = await call('session.list', { profile: 'research', scope: 'stored', limit: 100, picker: true })
    expect(ids(stored)).toEqual(['chat-research-1', REMINDER, INVOICES, DOWNLOADS])
    expect(stored.result).toMatchObject({ scope: 'stored', next_cursor: null })
    expect((stored.result?.sessions as unknown[])[2]).toEqual({
      session_id: INVOICES, id: INVOICES, resolved_id: INVOICES, title: 'Sort the invoices', source: 'gui', started_at: 1795249000, message_count: 2,
      model: 'research-model', running: false, preview: 'Sorted fourteen invoices by due date; the oldest is due Friday.', last_active_at: 1795249000
    })
    expect(await call('session.list', { profile: 'research', scope: 'live', picker: true })).toMatchObject({ result: { scope: 'live', sessions: [{ session_id: REMINDER, running: true }] } })
    expect((await call('session.list', { profile: 'research', scope: 'stored' })).result?.sessions, 'a picker field only for a picker').not.toContainEqual(expect.objectContaining({ preview: expect.anything() as unknown }))
  })

  it('lists a hidden Bot Chat only when the call asks for hidden chats', async () => {
    const { call } = await rawSocket({}, WITH_BOTS)
    expect(ids(await call('session.list', { profile: 'research', scope: 'stored' }))).toEqual([])
    expect(ids(await call('session.list', { profile: 'research', scope: 'stored', include_hidden: true }))).toEqual([RESEARCH_CHAT])
  })

  it('resumes a chat that waits on an approval as running, with the prompt open', async () => {
    const { call } = await rawSocket({}, WITH_CHATS)
    const resumed = await call('session.resume', { profile: 'research', session_id: REMINDER, display_projection: true })
    expect(resumed.result).toMatchObject({
      running: true, execution_generation: 1, display_messages: [{ role: 'user', timestamp: 1795250000 }, { role: 'assistant', timestamp: 1795250000 }],
      prompts: [{ kind: 'approval', execution_generation: 1, choices: ['once', 'deny', 'session', 'always'] }]
    })
    expect((await call('session.resume', { profile: 'research', session_id: INVOICES })).result).toMatchObject({ running: false, prompts: [] })
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

describe('the scripted gateway creates a profile as Hermes does', () => {
  const names = (reply: Reply) => (reply.result?.profiles as { name: string }[]).map(row => row.name)

  it('makes the profile under the home path, answers what Hermes does, and lists it from then on', async () => {
    const { call, script } = await rawSocket({}, WITH_BOTS)
    const made = await call('profiles.create', { name: ' Rae ', description: ' Writes the weekly report ', soul: 'You write short reports.', model: 'careful-large', provider: 'acme' })
    expect(made.result).toEqual({
      ok: true, name: 'Rae', path: '/tmp/hermes-proto-home/profiles/rae', soul_written: true, model_set: true,
      mirrored: { env: true, auth: 'shared', model_inherited: false, voice: false }, warnings: []
    })
    const listed = await call('profiles.list', {})
    expect(names(listed).at(-1)).toBe('rae')
    expect((listed.result?.profiles as unknown[]).at(-1)).toEqual({
      name: 'rae', path: '/tmp/hermes-proto-home/profiles/rae', is_default: false, model: 'careful-large', provider: 'acme',
      description: 'Writes the weekly report', display_name: '', skill_count: 0, previous_names: [], canonical_session: null
    })
    expect(script.step, 'the story has not moved').toBe(0)
  })

  it('leaves the model to Hermes when it is not given with its provider, and writes no persona for a blank one', async () => {
    const { call } = await rawSocket({}, WITH_BOTS)
    const made = await call('profiles.create', { name: 'rae', soul: '  ', model: 'careful-large' })
    expect(made.result).toMatchObject({ soul_written: false, model_set: false, mirrored: { model_inherited: true } })
  })

  it('answers the warnings the header names on every create', async () => {
    const { call } = await rawSocket({}, { ...WITH_BOTS, header: { ...WITH_BOTS.header, createWarnings: ['A credential was not copied.'] } })
    expect((await call('profiles.create', { name: 'rae' })).result?.warnings).toEqual(['A credential was not copied.'])
  })

  it.each([
    ['a blank name', ' ', 4061, 'name required', 'ValueError', 'profile name cannot be empty'],
    ['default in any case', 'DEFAULT', 4062, "Cannot create a profile named 'default' — it is the built-in profile (~/.hermes).", 'ValueError'],
    ['a name that is not an id', 'my/bot', 4062,
      "'my/bot' is not a valid profile name. Use lowercase letters, numbers, '-' or '_', starting with a letter or number, up to 64 characters (for example: my-bot). Then run `hermes profile create my-bot`.", 'ValueError'],
    ['a reserved name', 'Root', 4062,
      "Profile name 'root' is reserved — it collides with either the Hermes installation itself or a common system binary.  Pick a different name.", 'ValueError'],
    ['a name a bot has, in any case', 'Research', 4062,
      "A profile named 'research' already exists. Switch to it with `hermes profile use research`, see all profiles with `hermes profile list`, or choose a different name.", 'FileExistsError']
  ])('refuses %s with Hermes\'s reason, and makes nothing', async (_, name, code, message, type, text = message) => {
    const { call } = await rawSocket({}, WITH_BOTS)
    const before = names(await call('profiles.list', {}))
    expect((await call('profiles.create', { name })).error).toEqual({ code, message, data: { type, message_parts: [text] } })
    expect(names(await call('profiles.list', {}))).toEqual(before)
  })

  it('refuses a name a create made before', async () => {
    const { call } = await rawSocket({}, WITH_BOTS)
    await call('profiles.create', { name: 'rae' })
    expect((await call('profiles.create', { name: 'RAE' })).error).toMatchObject({ code: 4062, data: { type: 'FileExistsError' } })
  })

  it('serves the new profile like a listed bot: no Bot Chat, and chats made in it', async () => {
    const { call } = await rawSocket({}, WITH_BOTS)
    await call('profiles.create', { name: 'rae' })
    expect((await call('session.list', { title: 'Bot Chat', include_hidden: true, profile: 'rae' })).result?.sessions).toEqual([])
    expect((await call('session.create', { source: 'gui', request_id: 'draft-1', profile: 'rae' })).result?.session_id).toBe('chat-rae-1')
  })

  it('does not know the call without profiles in the header, nor on a socket bound to one profile', async () => {
    const unknown = { error: { code: -32601, data: { reason: 'unknown_method' } } }
    expect(await (await rawSocket()).call('profiles.create', { name: 'rae' })).toMatchObject(unknown)
    expect(await (await rawSocket({}, BOUND)).call('profiles.create', { name: 'rae' })).toMatchObject(unknown)
  })
})

describe('the scripted gateway answers config.set for YOLO as Hermes does', () => {
  const YOLO: Fixture = { ...WITH_BOTS, header: { ...WITH_BOTS.header, yolo: false } }
  const ON = { session_id: SESSION, key: 'yolo', value: 'on' }

  it('sets this chat only, answers its scope, and takes the words Hermes takes', async () => {
    const { call } = await rawSocket({}, YOLO)
    expect(await call('config.set', ON)).toMatchObject({ result: { key: 'yolo', value: '1', scope: 'session' } })
    expect((await call('session.resume', { session_id: SESSION })).result?.info).toMatchObject({ yolo: true })
    expect(await call('config.set', { ...ON, value: 'FALSE' })).toMatchObject({ result: { value: '0' } })
    expect(await call('config.set', { ...ON, value: 'maybe' })).toMatchObject(refusal('invalid_params'))
    expect(await call('config.set', without(ON, 'value'))).toMatchObject(refusal('invalid_params'))
  })

  it("keeps each chat's state apart", async () => {
    const { call } = await rawSocket({}, YOLO)
    expect((await call('config.set', { ...RESEARCH, key: 'yolo', value: 'on' })).result).toMatchObject({ value: '1' })
    expect((await call('session.resume', RESEARCH)).result?.info).toMatchObject({ yolo: true })
    expect((await call('session.resume', { session_id: SESSION })).result?.info).toMatchObject({ yolo: false })
  })

  it('refuses a missing or unknown session, a scope, another key and a viewer without control', async () => {
    const { call } = await rawSocket({}, YOLO)
    expect(await call('config.set', without(ON, 'session_id'))).toMatchObject(refusal('invalid_params'))
    expect(await call('config.set', { ...ON, session_id: 'nobody' })).toMatchObject(refusal('not_found'))
    expect(await call('config.set', { ...ON, scope: 'session' })).toMatchObject(refusal('invalid_params'))
    expect(await call('config.set', { ...ON, key: 'verbose' })).toMatchObject(refusal('invalid_params'))
    expect(await call('config.set', { ...ON, confirm_expensive_model: true })).toMatchObject(refusal('invalid_params'))

    const denied = await rawSocket({}, { ...YOLO, header: { ...YOLO.header, yoloDenied: true } })
    expect(await denied.call('config.set', ON)).toMatchObject(refusal('permission_denied'))
  })

  it('fails the story loudly when the client writes the global setting', async () => {
    const { call, script } = await rawSocket({}, YOLO)
    expect(await call('config.set', { ...ON, scope: 'global' })).toMatchObject({ error: { code: -32603 } })
    await expect(script.done).rejects.toThrow(/global YOLO/)
  })

  it('answers -32601 when the header has no yolo, as an older Hermes does', async () => {
    const { call } = await rawSocket({}, WITH_BOTS)
    expect(await call('config.set', ON)).toMatchObject({ error: { code: -32601, data: { reason: 'unknown_method' } } })
    expect((await call('session.resume', { session_id: SESSION })).result?.info).not.toHaveProperty('yolo')
  })
})

describe('the scripted gateway lists the files a typed @ can name', () => {
  const PATHS = { cwd: '/home/sam/errands', words: { '@not': { items: [{ text: '@file:notes.md', display: 'notes.md', meta: '' }] } } }
  const WITH_PATHS: Fixture = { ...ERRAND, header: { ...ERRAND.header, paths: PATHS } }

  it('answers a word from the header, and nothing for a word it does not list, an empty word or no session', async () => {
    const { call } = await rawSocket({}, WITH_PATHS)
    expect(await call('complete.path', { session_id: SESSION, word: '@not' })).toMatchObject({ result: PATHS.words['@not'] })
    expect(await call('complete.path', { session_id: SESSION, word: '@zzz' })).toMatchObject({ result: { items: [] } })
    expect(await call('complete.path', { session_id: SESSION, word: '' })).toMatchObject({ result: { items: [] } })
    expect(await call('complete.path', { word: '@not' })).toMatchObject({ result: { items: [] } })
  })

  it('refuses an unknown session, and a param that is not one of four strings', async () => {
    const { call } = await rawSocket({}, WITH_PATHS)
    expect(await call('complete.path', { session_id: 'someone-else', word: '@not' })).toMatchObject(refusal('not_found'))
    expect(await call('complete.path', { session_id: SESSION, word: '@not', cwd: null })).toMatchObject(refusal('invalid_params'))
    expect(await call('complete.path', { session_id: SESSION, word: '@not', limit: 'a' })).toMatchObject(refusal('invalid_params'))
  })

  it('gives the story session the header cwd, and knows no complete.path without the header', async () => {
    const { call } = await rawSocket({}, WITH_PATHS)
    expect((await call('session.resume', { session_id: SESSION })).result?.info).toMatchObject({ cwd: '/home/sam/errands' })
    const older = await rawSocket()
    expect((await older.call('session.resume', { session_id: SESSION })).result?.info).not.toHaveProperty('cwd')
    expect(await older.call('complete.path', { session_id: SESSION, word: '@not' })).toMatchObject({ error: { code: -32601, data: { reason: 'unknown_method' } } })
  })
})

describe('the scripted gateway hands a message to another bot', () => {
  const ID = 'a1'.repeat(16)
  const deliver = { profile: 'rae', id: ID, message: 'Ask @Rae for the weekly report' }
  const unknown = { error: { code: -32601, data: { reason: 'unknown_method' } } }

  it('knows no bot_relay method when the header has no relay, whatever the params', async () => {
    const { call } = await rawSocket({}, TEAM_NO_RELAY)
    expect(await call('bot_relay.deliver', {})).toMatchObject(unknown)
    expect(await call('bot_relay.deliver', deliver)).toMatchObject(unknown)
    expect(await call('bot_relay.deliver', 'rae')).toMatchObject(unknown)
    expect(await call('bot_relay.outbox.drain', {})).toMatchObject(unknown)
  })

  it('refuses a delivery with no id, a bad id or a blank message before it reaches the bot', async () => {
    const { call } = await rawSocket({}, TEAM)
    expect(await call('bot_relay.deliver', {}), 'the probe').toMatchObject(refusal('invalid_params'))
    for (const id of ['a1'.repeat(15), 'A1'.repeat(16), 'g1'.repeat(16), 'a1'.repeat(33)]) {
      expect(await call('bot_relay.deliver', { ...deliver, id }), id).toMatchObject(refusal('invalid_params'))
    }
    expect(await call('bot_relay.deliver', { ...deliver, message: ' \n' })).toMatchObject(refusal('invalid_params'))
    expect(await call('bot_relay.deliver', { ...deliver, from: 'ada' })).toMatchObject(refusal('invalid_params', { fields: ['from'] }))
  })

  it('answers with the settled receipt and the reply once the delay has passed, and not before', async () => {
    const { post, frames, clock } = await rawSocket({}, TEAM)
    const id = post('bot_relay.deliver', deliver)
    await clock.advance(1_499)
    expect(frames.filter(frame => frame.id === id)).toEqual([])
    await clock.advance(1)
    expect(frames.find(frame => frame.id === id)?.result).toEqual({
      status: 'settled', delivery_id: ID, profile_home: '/fixture/profiles/rae', session_id: 'bot-chat-rae', message: deliver.message,
      admission_id: 'bot-chat-rae-admission-a1a1a1a1', reply: RAE_SAID
    })
  })

  it('refuses for a bot the header refuses for, and for a bot with no entry as one that is not running', async () => {
    const { call, script } = await rawSocket({}, { ...TEAM, header: { ...TEAM.header, relay: { ...TEAM.header.relay, sam: { refuse: 'queue_full' } } } })
    expect(await call('bot_relay.deliver', { ...deliver, profile: 'sam' })).toMatchObject(refusal('queue_full'))
    expect(await call('bot_relay.deliver', { ...deliver, profile: 'default' })).toMatchObject(refusal('runtime_unavailable'))
    expect(script.step, 'the story has not moved').toBe(0)
  })
})

describe('the scripted gateway branches a chat as Hermes does', () => {
  const branch = (more: Record<string, unknown> = {}, payload: Record<string, unknown> = { through_message_id: 4 }) =>
    ({ session_id: SESSION, request_id: 'branch-1', expected_revision: 0, expected_generation: 0, operation: 'branch', payload, ...more })
  const rowsOf = (reply: Reply) => (reply.result?.display_messages as { role: string; text: string; row_id?: number }[]).map(row => [row.role, row.row_id])

  it('refuses the operation with no field when the fixture does not say it branches, as an older Hermes does', async () => {
    const { call, script } = await rawSocket({}, BRANCH_OLD)
    const refused = await call('session.mutate', branch())
    expect(refused).toMatchObject(refusal('invalid_params'))
    expect(refused.error?.data).not.toHaveProperty('fields')
    expect(script.branchesMade).toBe(0)
  })

  it('copies the rows through the one asked for into a chat of its own, and moves the parent revision', async () => {
    const { call, script, frames } = await rawSocket({}, BRANCH)
    await call('session.resume', { session_id: SESSION })
    const made = await call('session.mutate', branch())
    expect(made.result).toEqual({ session_id: SESSION, operation: 'branch', branched_session_id: 'branch-default-1', copied_messages: 4, revision: 1 })
    expect(script.branchesMade).toBe(1)
    expect(frames.filter(frame => frame.params?.type === 'session.updated').map(frame => frame.params?.payload)).toEqual([made.result])
    expect(frames.filter(frame => frame.params?.type === 'session.info').map(frame => frame.params?.payload), 'names the parent by its own title').toEqual([{ revision: 1, title: 'Notes heading', running: false }])

    const child = await call('session.resume', { session_id: 'branch-default-1', display_projection: true })
    expect(child.result).toMatchObject({ info: { title: 'Notes heading #2' }, revision: 0 })
    expect(rowsOf(child)).toEqual([['user', 1], ['assistant', 2], ['user', 3], ['assistant', 4]])
    expect((await call('session.resume', { session_id: SESSION })).result).toMatchObject({ revision: 1 })
    const stored = await call('session.list', { scope: 'stored', limit: 100, picker: true })
    expect(stored.result?.sessions).toMatchObject([{ session_id: 'branch-default-1', title: 'Notes heading #2', message_count: 4, running: false }])
  })

  it('branches the whole chat when no row is named, and keeps a title it is given', async () => {
    const { call } = await rawSocket({}, BRANCH)
    expect((await call('session.mutate', branch({}, { title: 'Second try' }))).result).toMatchObject({ copied_messages: 6 })
    const stored = await call('session.list', { scope: 'stored', limit: 100 })
    expect(stored.result?.sessions).toMatchObject([{ title: 'Second try', message_count: 6 }])
  })

  it('names the next child after the last in the lineage', async () => {
    const { call } = await rawSocket({}, BRANCH)
    await call('session.mutate', branch())
    await call('session.mutate', branch({ request_id: 'branch-2', expected_revision: 1 }))
    const titles = (await call('session.list', { scope: 'stored', limit: 100 })).result?.sessions as { title: string }[]
    expect(titles.map(row => row.title)).toEqual(['Notes heading #2', 'Notes heading #3'])
  })

  it('answers an exact retry from its receipt with the same child, though the first branch moved the revision', async () => {
    const { call, script } = await rawSocket({}, BRANCH)
    const first = await call('session.mutate', branch())
    const again = await call('session.mutate', branch())
    expect(again.result).toEqual(first.result)
    expect(script.branchesMade).toBe(1)
  })

  it('refuses a resend of the key with other fences or another row, as a request it did not receive', async () => {
    const { call, script } = await rawSocket({}, BRANCH)
    await call('session.mutate', branch())
    expect(await call('session.mutate', branch({ expected_revision: 1 }))).toMatchObject(refusal('admission_conflict'))
    expect(await call('session.mutate', branch({}, { through_message_id: 2 }))).toMatchObject(refusal('admission_conflict'))
    expect(script.branchesMade).toBe(1)
  })

  it('refuses a stale fence with the fresh ones', async () => {
    const { call } = await rawSocket({}, BRANCH)
    await call('session.mutate', branch())
    const moved = { request_id: 'branch-2' }
    expect(await call('session.mutate', branch(moved))).toMatchObject(refusal('revision_conflict', { revision: 1, execution_generation: 0 }))
    expect(await call('session.mutate', branch({ ...moved, expected_revision: 1, expected_generation: 3 }))).toMatchObject(refusal('stale_generation', { revision: 1 }))
  })

  it('refuses a row the chat does not have, a key it does not take and a title that is not text, each with no field', async () => {
    const { call, script } = await rawSocket({}, BRANCH)
    for (const payload of [{ through_message_id: 99 }, { through_message_id: 0 }, { through_message_id: 4, mcp_servers: [] }, { title: '' }]) {
      const refused = await call('session.mutate', branch({}, payload))
      expect(refused, JSON.stringify(payload)).toMatchObject(refusal('invalid_params'))
      expect(refused.error?.data).not.toHaveProperty('fields')
    }
    expect(script.branchesMade).toBe(0)
  })

  it('takes the tool rows that follow an assistant row along, and none after a user row', async () => {
    const rows = [
      { role: 'user', text: 'List it', row_id: 1 }, { role: 'assistant', text: 'Looking.', row_id: 2 },
      { role: 'tool', name: 'terminal', content: 'x', tool_call_id: 't1' }, { role: 'assistant', text: 'Done.', row_id: 3 }, { role: 'user', text: 'Again', row_id: 4 }
    ]
    const { call } = await rawSocket({}, { ...BRANCH, header: { ...BRANCH.header, stored: rows } })
    expect((await call('session.mutate', branch({}, { through_message_id: 2 }))).result).toMatchObject({ copied_messages: 3 })
    expect((await call('session.mutate', branch({ request_id: 'branch-2', expected_revision: 1 }, { through_message_id: 1 }))).result).toMatchObject({ copied_messages: 1 })
  })

  it('refuses a chat that has a reply running', async () => {
    const { call } = await rawSocket({}, { ...WITH_CHATS, header: { ...WITH_CHATS.header, branches: true } })
    const running = { profile: 'research', session_id: REMINDER, request_id: 'branch-1', expected_revision: 0, expected_generation: 1, operation: 'branch', payload: { through_message_id: 2 } }
    expect(await call('session.mutate', running)).toMatchObject(refusal('session_busy'))
  })

  it("branches a chat beside the story in its bot, and lists the child there", async () => {
    const { call, script } = await rawSocket({}, { ...WITH_CHATS, header: { ...WITH_CHATS.header, branches: true } })
    const asked = { profile: 'research', session_id: INVOICES, request_id: 'branch-1', expected_revision: 0, expected_generation: 0, operation: 'branch', payload: { through_message_id: 2 } }
    const made = await call('session.mutate', asked)
    expect(made.result).toMatchObject({ branched_session_id: 'branch-research-1', copied_messages: 2, revision: 1 })
    expect((await call('session.mutate', asked)).result, 'a retry').toEqual(made.result)
    expect(script.branchesMade).toBe(1)
    const stored = await call('session.list', { profile: 'research', scope: 'stored', limit: 100, picker: true })
    expect(stored.result?.sessions).toContainEqual(expect.objectContaining({ session_id: 'branch-research-1', title: 'Sort the invoices #2' }))
    const child = await call('session.resume', { profile: 'research', session_id: 'branch-research-1', display_projection: true })
    expect(rowsOf(child)).toEqual([['user', 1], ['assistant', 2]])
  })

  it('renames a chat beside the story, tells its viewers, and lists it by the new title', async () => {
    const { call, frames } = await rawSocket({}, WITH_CHATS)
    const chat = { profile: 'research', session_id: INVOICES }
    await call('session.resume', { ...chat, display_projection: true })
    const renamed = await call('session.mutate', { ...chat, request_id: 'r', expected_revision: 0, operation: 'rename', payload: { title: 'Invoices by date' } })
    expect(renamed.result).toMatchObject({ operation: 'rename', revision: 1 })
    expect(eventsOf(frames, INVOICES).at(-1)).toMatchObject({ type: 'session.info', payload: { title: 'Invoices by date', revision: 1 } })
    const stored = await call('session.list', { profile: 'research', scope: 'stored', limit: 100, picker: true })
    expect(stored.result?.sessions).toContainEqual(expect.objectContaining({ session_id: INVOICES, title: 'Invoices by date' }))
  })

  it('refuses a rename with a key Hermes does not take, and any other operation on a chat beside the story', async () => {
    const { call } = await rawSocket({}, WITH_CHATS)
    const rename = { profile: 'research', session_id: INVOICES, request_id: 'r', expected_revision: 0, operation: 'rename', payload: { title: 'x' } }
    expect(await call('session.mutate', { ...rename, payload: { title: 'x', color: 'red' } })).toMatchObject(refusal('invalid_params'))
    expect(await call('session.mutate', { ...rename, operation: 'archive', payload: { archived: true } })).toMatchObject(refusal('unsupported_command'))
  })

  it('exports a chat beside the story under the file name Hermes gives it, and refuses a format it does not know', async () => {
    const { call } = await rawSocket({}, WITH_CHATS)
    const chat = { profile: 'research', session_id: INVOICES }
    const saved = await call('session.export', { ...chat, format: 'md' })
    expect(saved.result).toMatchObject({ format: 'md', filename: `hermes_session_${INVOICES}.md`, content: expect.stringContaining('# Sort the invoices') })
    expect(await call('session.export', { ...chat, format: 'pdf' })).toMatchObject(refusal('invalid_params'))
    expect(await call('session.export', { ...chat, format: 'md', redact: 'no' })).toMatchObject(refusal('invalid_params'))
  })
})

describe('the scripted gateway lists a profile\'s chats as a tree', () => {
  type TreeRow = Record<string, unknown>
  const previews = (reply: Reply) => ((reply.result?.projects as { previewSessions: TreeRow[] }[])[0]?.previewSessions ?? [])
  const all = { profile: 'research', preview_limit: 100 }

  it('answers -32601 when the fixture has no tree, and on a socket bound to one profile', async () => {
    const { call } = await rawSocket({}, WITH_CHATS)
    expect(await call('projects.tree', { profile: 'research' })).toMatchObject({ error: { code: -32601, data: { reason: 'unknown_method' } } })
    const bound = await rawSocket({}, { ...WITH_VERSIONS, header: { ...WITH_VERSIONS.header, reach: 'profile' } })
    expect(await bound.call('projects.tree', {})).toMatchObject({ error: { code: -32601, data: { reason: 'unknown_method' } } })
  })

  it('names the chat a branch was made from twice, and no parent for any other chat', async () => {
    const { call } = await rawSocket({}, WITH_VERSIONS)
    const rows = previews(await call('projects.tree', all))
    expect(rows.map(row => [row.id, row.parent_session_id, row._branched_from, row.profile]), 'newest first').toEqual([
      [SORTED_3, SORTED, SORTED, 'research'], [SORTED_2, SORTED, SORTED, 'research'], [SORTED, null, null, 'research'], ['local-0103', null, null, 'research']
    ])
    expect(rows[2]).toMatchObject({ title: 'Sort the invoices', started_at: 1795249000, message_count: 6, archived: false })
  })

  it('previews the three newest chats unless asked for more, as Hermes does', async () => {
    const { call } = await rawSocket({}, WITH_VERSIONS)
    expect(previews(await call('projects.tree', { profile: 'research' })).map(row => row.id)).toEqual([SORTED_3, SORTED_2, SORTED])
  })

  it('lists a chat a branch made under the chat it was made from, and never the story session', async () => {
    const { call } = await rawSocket({}, WITH_VERSIONS)
    const asked = { profile: 'research', session_id: SORTED, request_id: 'branch-1', expected_revision: 0, expected_generation: 0, operation: 'branch', payload: { through_message_id: 2 } }
    await call('session.mutate', asked)
    expect(previews(await call('projects.tree', all))).toContainEqual(expect.objectContaining({ id: 'branch-research-1', parent_session_id: SORTED, _branched_from: SORTED, started_at: 0 }))
    await call('session.mutate', { ...asked, profile: undefined, session_id: SESSION, payload: {} })
    const home = previews(await call('projects.tree', { preview_limit: 100 }))
    expect(home.map(row => [row.id, row.parent_session_id])).toEqual([['branch-default-2', null]])
  })
})

describe('the scripted gateway pages a chat beside the story', () => {
  const page = (more: Record<string, unknown>) => ({ profile: 'research', session_id: SORTED, inline_images: false, ...more })
  const read = (reply: Reply) => (reply.result?.rows as { role: string; row_id: number; row_kind: string }[]).map(row => [row.role, row.row_id, row.row_kind])

  it('oldest first, with a cursor that is never null and an empty page at the end', async () => {
    const { call } = await rawSocket({}, WITH_VERSIONS)
    const first = await call('session.transcript', page({ order: 'oldest', limit: 4 }))
    expect(read(first)).toEqual([['user', 1, 'message'], ['assistant', 2, 'message'], ['user', 3, 'message'], ['assistant', 4, 'message']])
    expect(first.result).toMatchObject({ session_id: SORTED, reset: false })
    const second = await call('session.transcript', page({ order: 'oldest', limit: 4, cursor: first.result?.next_cursor }))
    expect(read(second)).toEqual([['user', 5, 'message'], ['assistant', 6, 'message']])
    const end = await call('session.transcript', page({ order: 'oldest', limit: 4, cursor: second.result?.next_cursor }))
    expect(read(end)).toEqual([])
    expect(end.result?.next_cursor).toBe(second.result?.next_cursor)
  })

  it('latest first, back to a null cursor', async () => {
    const { call } = await rawSocket({}, WITH_VERSIONS)
    const newest = await call('session.transcript', page({ order: 'latest', limit: 4 }))
    expect(read(newest).map(([, rowId]) => rowId)).toEqual([3, 4, 5, 6])
    const older = await call('session.transcript', page({ order: 'latest', limit: 4, cursor: newest.result?.next_cursor }))
    expect(read(older).map(([, rowId]) => rowId)).toEqual([1, 2])
    expect(older.result?.next_cursor).toBeNull()
  })

  it('refuses a cursor of the other order, a limit over 500 and an unknown key', async () => {
    const { call } = await rawSocket({}, WITH_VERSIONS)
    const first = await call('session.transcript', page({ order: 'oldest', limit: 2 }))
    expect(await call('session.transcript', page({ order: 'latest', cursor: first.result?.next_cursor }))).toMatchObject(refusal('invalid_params'))
    expect(await call('session.transcript', page({ order: 'oldest', limit: 501 }))).toMatchObject(refusal('invalid_params'))
    expect(await call('session.transcript', page({ newest: true }))).toMatchObject(refusal('invalid_params', { fields: ['newest'] }))
  })
})

describe('the scripted gateway edits a profile as Hermes does', () => {
  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7])
  const research = (reply: Reply) => (reply.result?.profiles as Record<string, unknown>[]).find(row => row.name === 'research')

  it("describes a profile's description and persona, and refuses a blank or unknown name", async () => {
    const { call } = await rawSocket({}, { ...WITH_BOTS, header: { ...WITH_BOTS.header, souls: { research: 'You dig.' } } })
    expect((await call('profiles.describe', { name: 'research' })).result).toMatchObject({ name: 'research', description: '', soul: 'You dig.' })
    expect(await call('profiles.describe', { name: ' ' })).toMatchObject({ error: { code: 4063, message: 'name required' } })
    expect(await call('profiles.describe', { name: 'nobody' })).toMatchObject({ error: { code: 4064, message: "profile 'nobody' not found" } })
  })

  it('applies a ui_meta write at the expected revision, and refuses a stale one with the conflict and nothing written', async () => {
    const { call } = await rawSocket({}, WITH_BOTS)
    const write = (revision: number, title: string) =>
      call('profiles.configure', { name: 'research', ui_meta: { 'hermes-bots': { title } }, ui_meta_expected_revisions: { 'hermes-bots': revision }, soul: 'S' })
    expect((await write(2, 'Scout')).result).toEqual({ ok: true, applied: { ui_meta: true, ui_meta_revisions: { 'hermes-bots': 3 }, soul: true } })
    expect((await write(2, 'Stale')).result).toEqual({
      ok: false,
      applied: { ui_meta: false, ui_meta_conflicts: { 'hermes-bots': { expected: 2, actual: 3 } }, ui_meta_revisions: { 'hermes-bots': 3 }, soul: true }
    })
    const row = research(await call('profiles.list', {}))
    expect([row?.ui_meta, row?.ui_meta_revisions]).toEqual([{ 'hermes-bots': { title: 'Scout' } }, { 'hermes-bots': 3 }])
  })

  it('plays one rename from another client ahead of the first ui_meta write when the header names a clash', async () => {
    const { call } = await rawSocket({}, { ...WITH_BOTS, header: { ...WITH_BOTS.header, configureClash: 'Robin' } })
    expect((await call('profiles.configure', { name: 'research', description: 'D' })).result).toEqual({ ok: true, applied: { description: true } })
    const clashed = await call('profiles.configure', { name: 'research', ui_meta: { 'hermes-bots': { title: 'Scout' } }, ui_meta_expected_revisions: { 'hermes-bots': 2 } })
    expect(clashed.result?.applied).toMatchObject({ ui_meta: false, ui_meta_conflicts: { 'hermes-bots': { expected: 2, actual: 3 } } })
    expect(research(await call('profiles.list', {}))).toMatchObject({ description: 'D', ui_meta: { 'hermes-bots': { title: 'Robin', color: '#ef4444' } } })
    const again = await call('profiles.configure', { name: 'research', ui_meta: { 'hermes-bots': { title: 'Scout' } }, ui_meta_expected_revisions: { 'hermes-bots': 3 } })
    expect(again.result?.applied, 'only once').toMatchObject({ ui_meta: true })
  })

  it('stores a picture by its bytes, lists the profile as having one, and clears it', async () => {
    const { call } = await rawSocket({}, WITH_BOTS)
    expect((await call('profiles.set_asset', { name: 'research', asset: 'avatar', data: PNG_BYTES.toString('base64') })).result).toEqual({ ok: true, asset: 'avatar', size: 9 })
    expect(research(await call('profiles.list', {}))?.has_avatar).toBe(true)
    expect((await call('profiles.get_asset', { name: 'research', asset: 'avatar' })).result).toEqual({ found: true, mime: 'image/png', size: 9, data: `data:image/png;base64,${PNG_BYTES.toString('base64')}` })
    expect((await call('profiles.set_asset', { name: 'research', asset: 'avatar', clear: true })).result).toEqual({ ok: true, asset: 'avatar', size: 0, removed: 1 })
    expect(research(await call('profiles.list', {}))?.has_avatar).toBe(false)
    expect((await call('profiles.get_asset', { name: 'research', asset: 'avatar' })).result).toEqual({ found: false })
  })

  it.each([
    ['no name', { asset: 'avatar', data: 'x' }, 4063],
    ['another asset', { name: 'research', asset: 'banner', data: 'x' }, 4066],
    ['no data', { name: 'research', asset: 'avatar' }, 4067],
    ['data that is not base64', { name: 'research', asset: 'avatar', data: 'data:image/png;base64,!!!' }, 4068],
    ['more than 2 MB', { name: 'research', asset: 'avatar', data: Buffer.concat([PNG_BYTES, Buffer.alloc(2_000_000)]).toString('base64') }, 4069],
    ['bytes of no picture type, whatever the data URL says', { name: 'research', asset: 'avatar', data: `data:image/png;base64,${Buffer.from('GIF89a').toString('base64')}` }, 4070]
  ])('refuses a picture with %s', async (_, params, code) => {
    const { call } = await rawSocket({}, WITH_BOTS)
    expect(await call('profiles.set_asset', params)).toMatchObject({ error: { code } })
    expect(research(await call('profiles.list', {}))?.has_avatar).toBe(false)
  })

  it('answers every editor call as an unknown method without profiles, or on a socket with no interactive grant', async () => {
    for (const fixture of [ERRAND, BOUND]) {
      const { call } = await rawSocket({}, fixture)
      for (const method of ['profiles.describe', 'profiles.configure', 'profiles.set_asset', 'profiles.get_asset']) {
        expect(await call(method, { name: 'research', asset: 'avatar', clear: true })).toMatchObject({ error: { code: -32601 } })
      }
    }
  })
})

describe('attachments, as Hermes stages them', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64')

  it('stages an image only for a socket attached to the session', async () => {
    const { call } = await rawSocket()
    expect(await call('image.attach_bytes', { session_id: SESSION, content_base64: PNG, ext: 'png' })).toMatchObject(refusal('permission_denied'))
    await call('session.resume', { session_id: SESSION })
    expect(await call('image.attach_bytes', { session_id: SESSION, content_base64: PNG, ext: 'png' }))
      .toMatchObject({ result: { attached: true, path: '/hermes/default/cache/images/upload-1.png', mime: 'image/png' } })
  })

  it('reads the type from the name before the ext hint, and from the bytes only when neither says', async () => {
    const { call } = await rawSocket()
    await call('session.resume', { session_id: SESSION })
    expect(await call('image.attach_bytes', { session_id: SESSION, content_base64: PNG, filename: 'photo.heic', ext: 'png' }), 'a name Hermes takes no image type from')
      .toMatchObject(refusal('invalid_params'))
    expect(await call('image.attach_bytes', { session_id: SESSION, content_base64: PNG, filename: 'photo.JPEG' }))
      .toMatchObject({ result: { attached: true, path: '/hermes/default/cache/images/upload-1.jpeg', mime: 'image/jpeg' } })
    expect(await call('image.attach_bytes', { session_id: SESSION, content_base64: PNG, ext: '.webp' }))
      .toMatchObject({ result: { attached: true, mime: 'image/webp' } })
    expect(await call('image.attach_bytes', { session_id: SESSION, content_base64: PNG }))
      .toMatchObject({ result: { attached: true, mime: 'image/png' } })
    expect(await call('image.attach_bytes', { session_id: SESSION, content_base64: PNG, ext: 'bmp' })).toMatchObject(refusal('invalid_params'))
  })

  it('refuses an image over 25 MiB', async () => {
    const { call } = await rawSocket()
    await call('session.resume', { session_id: SESSION })
    const big = Buffer.alloc(25 * 1024 * 1024 + 1)
    Buffer.from(PNG, 'base64').copy(big)
    expect(await call('image.attach_bytes', { session_id: SESSION, content_base64: big.toString('base64') })).toMatchObject(refusal('invalid_params'))
  })

  it('refuses a submit that names an image it did not stage', async () => {
    const { call } = await rawSocket()
    await call('session.resume', { session_id: SESSION })
    expect(await call('prompt.submit', { ...SUBMIT, attachments: [{ path: '/etc/passwd', mime: 'image/png' }] })).toMatchObject(refusal('invalid_params'))
  })

  it('answers a file with the reference the model reads', async () => {
    const { call } = await rawSocket()
    await call('session.resume', { session_id: SESSION })
    expect(await call('file.attach', { session_id: SESSION, name: 'notes.txt', data_url: `data:text/plain;base64,${Buffer.from('hi').toString('base64')}` }))
      .toMatchObject({ result: { attached: true, ref_text: '@file:/hermes/default/attachments/notes.txt' } })
    expect(await call('file.attach', { session_id: SESSION, name: 'notes.txt', data_url: 'not a data url' })).toMatchObject(refusal('invalid_params'))
  })
})

describe('the scripted gateway and what Hermes asks', () => {
  const story = (...steps: readonly Added[]): Fixture => ({ header: ERRAND.header, steps: steps.map((step): FixtureStep => ({ at: 0, ...step })) })
  const event = (seq: number, type: string, payload: Record<string, unknown>) =>
    ({ push: { jsonrpc: '2.0', method: 'event', params: { type, session_id: SESSION, replay_epoch: 'e', seq, payload } } })
  const CANCEL = event(1, 'request.cancel', { id: SUDO, method: 'sudo', reason: 'resolved' })
  const answer = (value: string) => ({ jsonrpc: '2.0', id: SUDO, result: { value } })
  const openRequests = async (call: Awaited<ReturnType<typeof rawSocket>>['call']) => (await call('session.resume', { session_id: SESSION })).result?.open_requests

  it('lists a request as open until its answer arrives, then plays the cancel that follows', async () => {
    const { call, send, script, frames, played } = await rawSocket({}, story(SUDO_ASK, { answer: SUDO, result: { value: MASKED } }, CANCEL))
    await call('session.resume', { session_id: SESSION })
    await played()
    expect(frames.find(frame => frame.method === 'sudo')).toMatchObject({ id: SUDO, params: { command: 'sudo true' } })
    expect(await openRequests(call)).toEqual([{ id: SUDO, method: 'sudo', params: SUDO_ASK.push.params }])
    send(answer('anything typed'))
    await played()
    expect(frames.filter(frame => frame.params?.type === 'request.cancel')).toHaveLength(1)
    expect(await openRequests(call)).toEqual([])
    expect(script.finished).toBe(true)
  })

  it('closes a request the story cancels, with no answer', async () => {
    const { call, played } = await rawSocket({}, story(SUDO_ASK, { ...CANCEL, push: { ...CANCEL.push, params: { ...CANCEL.push.params, payload: { id: SUDO, method: 'sudo', reason: 'timeout' } } } }))
    await call('session.resume', { session_id: SESSION })
    await played()
    expect(await openRequests(call)).toEqual([])
  })

  it.each([
    ['an answer while it waits for a call', { header: ERRAND.header, steps: [{ at: 0, ...SUDO_ASK }, { at: 0, await: 'prompt.submit', params: {}, reply: {} }] }, answer('x'), /it waits for no answer/],
    ['an answer to another request', story(SUDO_ASK, { answer: 'srq-other', result: {} }), answer('x'), /it waits for the answer to srq-other/],
    ['a result other than the recorded one', story(SUDO_ASK, { answer: SUDO, result: { value: '' } }), answer('x'), /it waits for the result \{"value":""\}/],
    ['an empty value where one was typed', story(SUDO_ASK, { answer: SUDO, result: { value: MASKED } }), answer(''), /it waits for the result/],
    ['a result where it waits for a decline', story(SUDO_ASK, { answer: SUDO, error: { code: -32601, message: 'no' } }), answer('x'), /it waits for error -32601/]
  ])('fails the story on %s', async (_name, fixture, sent, problem) => {
    const { call, send, script, played } = await rawSocket({}, fixture)
    await call('session.resume', { session_id: SESSION })
    await played()
    send(sent)
    await expect(script.done).rejects.toThrow(problem)
  })

  it("answers a connector card's Try again for the story session only, and only with reconnect, as Hermes does", async () => {
    const minted = { op_id: 'op-1', seq: 2, deadline_at: 0, settled: false, targets: [] }
    const retry = { owner: { type: 'session', session_id: SESSION }, connectors: ['github'], reconnect: true }
    const { call } = await rawSocket({}, { header: ERRAND.header, steps: [{ at: 0, await: 'connectors.connect', params: retry, reply: minted }] })
    expect(await call('connectors.connect', { ...retry, reconnect: false })).toMatchObject(refusal('invalid_params'))
    expect(await call('connectors.connect', { ...retry, owner: { type: 'session', session_id: 'another' } })).toMatchObject(refusal('invalid_params'))
    expect(await call('connectors.connect', { ...retry, connectors: 'github' })).toMatchObject(refusal('invalid_params'))
    expect(await call('connectors.connect', retry)).toEqual(expect.objectContaining({ result: minted }))
  })

  it('fails the story on an answer from a socket that has not attached the session', async () => {
    const { call, script, played } = await rawSocket({}, story(SUDO_ASK, { answer: SUDO, result: { value: MASKED } }))
    await call('session.resume', { session_id: SESSION })
    await played()
    const stranger = await script({ start: false })
    stranger.send(JSON.stringify(answer('x')))
    await expect(script.done).rejects.toThrow(/the socket has not attached the session/)
  })

  it('does not hand an automatic window request to a viewer that reconnects, and does hand it a card that waits', async () => {
    const read = { push: { jsonrpc: '2.0', id: 'srq-read', method: 'terminal.read', params: { session_id: SESSION } } }
    const { call, played } = await rawSocket({}, story(read, { answer: 'srq-read', error: { code: -32601, message: 'no' } }))
    await call('session.resume', { session_id: SESSION })
    await played()
    expect(await openRequests(call)).toEqual([])
    const picker = await rawSocket({}, story(PICK_ASK))
    await picker.call('session.resume', { session_id: SESSION })
    await picker.played()
    expect(await openRequests(picker.call)).toMatchObject([{ method: 'theme.pick' }])
  })

  it('serves the open connector card as pending_connection, with the targets of its latest update, until it settles', async () => {
    const card = { op_id: 'op1', seq: 1, deadline_at: 9, timeout_seconds: 300, targets: [{ name: 'github', kind: 'connector', action: 'connect', state: 'pending' }] }
    const moved = { op_id: 'op1', seq: 2, deadline_at: 9, owner: { type: 'session', session_id: SESSION }, targets: [{ name: 'github', kind: 'connector', action: 'connect', state: 'skipped' }] }
    const pending = async (fixture: Fixture) => {
      const { call, played } = await rawSocket({}, fixture)
      await call('session.resume', { session_id: SESSION })
      await played()
      return (await call('session.resume', { session_id: SESSION })).result?.pending_connection
    }
    expect(await pending(story(event(1, 'connection.request', card)))).toEqual(card)
    expect(await pending(story(event(1, 'connection.request', card), event(2, 'connection.update', { ...moved, settled: false })))).toEqual({ ...card, seq: 2, targets: moved.targets })
    expect(await pending(story(event(1, 'connection.request', card), event(2, 'connection.update', { ...moved, settled: true, settled_by: 'all_resolved' })))).toBeNull()
  })
})

describe("the scripted gateway and Hermes's queue", () => {
  const row = (admission_id: string, status: string, more: Record<string, unknown> = {}) => ({
    admission_id, ref: { profile_id: 'default', session_id: SESSION }, sequence: 1, status, outcome: null, authority_epoch: 2, execution_generation: null,
    input_id: `in-${admission_id}`, text: 'tidy the notes', controls: [], steering: false, ...more
  })
  const LOST = row('lost', 'unknown', { execution_generation: 1 })
  const receipt = { admission_id: 'lost', status: 'terminal', outcome: 'interrupted' }
  const RESTARTED: Fixture = {
    header: { ...ERRAND.header, pending: [LOST, row('behind', 'queued', { controls: ['steer', 'replace'] })], controls: { busy: 'interrupt' } },
    steps: [{ at: 0, await: 'prompt.resolve_unknown', params: {}, reply: receipt }, ...ERRAND.steps.filter(step => !('await' in step))]
  }
  const release = { session_id: SESSION, admission_id: 'lost', execution_generation: 1 }

  it('lists what was pending before the story starts in the attach reply', async () => {
    const { call } = await rawSocket({}, RESTARTED)
    expect((await call('session.resume', { session_id: SESSION })).result).toMatchObject({ running: false, pending: [{ admission_id: 'lost', status: 'unknown' }, { admission_id: 'behind' }] })
  })

  it('releases a lost row only by the generation it ran as, and knows only the rows it listed', async () => {
    const { call } = await rawSocket({}, RESTARTED)
    await call('session.resume', { session_id: SESSION })
    expect(await call('prompt.resolve_unknown', { ...release, execution_generation: 2 })).toMatchObject(refusal('stale_generation'))
    expect(await call('prompt.resolve_unknown', { ...release, admission_id: 'behind' })).toMatchObject(refusal('stale_generation'))
    expect(await call('prompt.resolve_unknown', without(release, 'execution_generation'))).toMatchObject(refusal('invalid_params', { fields: ['execution_generation'] }))
    expect(await call('prompt.cancel', { session_id: SESSION, admission_id: 'gone' })).toMatchObject(refusal('not_found'))
    expect(await call('prompt.steer_queued', { session_id: SESSION, admission_id: 'behind', text: 'now' })).toMatchObject(refusal('invalid_params', { fields: ['text'] }))
    expect((await call('prompt.resolve_unknown', release)).result).toEqual(receipt)
  })

  it('takes an edit only from a socket that attached the session, with an id for the new message', async () => {
    const { call } = await rawSocket({}, RESTARTED)
    const edit = { session_id: SESSION, admission_id: 'behind', submission_id: 'in-2', text: 'tidy the notes and the list' }
    expect(await call('prompt.replace_queued', edit)).toMatchObject(refusal('permission_denied'))
    await call('session.resume', { session_id: SESSION })
    expect(await call('prompt.replace_queued', { ...edit, submission_id: '' })).toMatchObject(refusal('invalid_params'))
    expect(await call('prompt.replace_queued', { ...edit, admission_id: 'gone' })).toMatchObject(refusal('not_found'))
  })

  it('refuses a steer with no words, an undeclared key, or the generation of a turn that is not running', async () => {
    const { call } = await rawSocket({}, RESTARTED)
    await call('session.resume', { session_id: SESSION })
    const steer = { session_id: SESSION, text: 'use the staging db', execution_generation: 1 }
    expect(await call('session.steer', { ...steer, text: '  ' })).toMatchObject(refusal('invalid_params'))
    expect(await call('session.redirect', { ...steer, now: true })).toMatchObject(refusal('invalid_params', { fields: ['now'] }))
    expect(await call('session.steer', steer)).toMatchObject(refusal('stale_generation'))
    expect(await call('session.redirect', steer)).toMatchObject(refusal('stale_generation'))
  })

  it('answers the busy mode only when the fixture has one, and takes only a mode Hermes has', async () => {
    const { call } = await rawSocket({}, RESTARTED)
    const busy = { session_id: SESSION, key: 'busy' }
    expect((await call('config.get', busy)).result).toEqual({ key: 'busy', value: 'interrupt', scope: 'session' })
    expect(await call('config.set', { ...busy, value: 'on' })).toMatchObject(refusal('invalid_params'))
    expect((await call('config.set', { ...busy, value: 'steer' })).result).toEqual({ key: 'busy', value: 'steer', scope: 'session' })
    expect((await call('config.get', busy)).result).toMatchObject({ value: 'steer' })

    const reasoningOnly = await rawSocket({}, { ...ERRAND, header: { ...ERRAND.header, controls: { show_reasoning: '0' } } })
    expect(await reasoningOnly.call('config.get', busy)).toMatchObject(refusal('invalid_params'))
    expect(await (await rawSocket()).call('config.get', busy)).toMatchObject({ error: { code: -32601 } })
  })
})

describe('the scripted gateway and the chat commands', () => {
  const STORY: Fixture = {
    header: { ...ERRAND.header, info: { cwd: '/work', reasoning_effort: '', fast: false, yolo: false } },
    steps: [
      { at: 0, await: 'prompt.btw', params: {}, reply: { task_id: 'btw_1' } },
      { at: 0, await: 'config.set', params: {}, reply: { key: 'yolo', value: '1', scope: 'session' } },
      { at: 0, await: 'session.mutate', params: {}, reply: { session_id: SESSION, operation: 'workspace' } },
      { at: 0, await: 'session.export', params: {}, reply: { format: 'md', filename: 'chat.md', content: '# Chat' } }
    ]
  }
  const fenced = { session_id: SESSION, request_id: 'r1', expected_revision: 0, expected_generation: 0 }

  it('repeats the header info in the attach reply, and a YOLO set the story records in the next one', async () => {
    const { call } = await rawSocket({}, STORY)
    expect((await call('session.resume', { session_id: SESSION })).result?.info).toMatchObject({ cwd: '/work', reasoning_effort: '', fast: false, yolo: false })
    await call('prompt.btw', { session_id: SESSION, text: 'why?' })
    expect((await call('config.set', { session_id: SESSION, key: 'yolo', value: 'on' })).result).toEqual({ key: 'yolo', value: '1', scope: 'session' })
    expect((await call('session.resume', { session_id: SESSION })).result?.info).toMatchObject({ yolo: true })
  })

  it('refuses each call outside the closed key set Hermes checks', async () => {
    const { call } = await rawSocket({}, STORY)
    await call('session.resume', { session_id: SESSION })
    expect(await call('prompt.btw', { session_id: SESSION, text: ' ' })).toMatchObject(refusal('invalid_params'))
    expect(await call('prompt.btw', { session_id: SESSION, text: 'why?', now: true })).toMatchObject(refusal('invalid_params'))
    await call('prompt.btw', { session_id: SESSION, text: 'why?' })
    expect(await call('config.set', { session_id: SESSION, key: 'yolo', value: 'on', scope: 'session' })).toMatchObject(refusal('invalid_params'))
    await call('config.set', { session_id: SESSION, key: 'yolo', value: 'on' })
    expect(await call('session.mutate', { ...fenced, operation: 'workspace', payload: { cwd: ' ' } })).toMatchObject(refusal('invalid_params'))
    expect(await call('session.mutate', { ...without(fenced, 'expected_generation'), operation: 'workspace', payload: { cwd: '/work/docs' } })).toMatchObject(refusal('invalid_params'))
    expect(await call('session.mutate', { ...fenced, operation: 'workspace', payload: { cwd: '/work/docs' } })).toMatchObject({ result: { operation: 'workspace' } })
    expect(await call('session.export', { session_id: SESSION, format: 'md', redact: 'no' })).toMatchObject(refusal('invalid_params'))
  })

  it('takes a side prompt only from a socket that attached the chat, since its answer rides that subscription', async () => {
    const { call } = await rawSocket({}, { ...STORY, steps: STORY.steps.slice(1) })
    expect(await call('prompt.btw', { session_id: SESSION, text: 'why?' })).toMatchObject(refusal('permission_denied'))
    expect(await call('prompt.background', { session_id: 'other', text: 'tidy' })).toMatchObject(refusal('not_found'))
  })

  it.each([
    ['an effort Hermes does not take', 'reasoning', { effort: 'turbo' }],
    ['an effort with a second key', 'reasoning', { effort: 'high', scope: 'global' }],
    ['a compression with a key Hermes does not parse', 'compress', { focus: 'x', keep: 2 }],
    ['a compression whose focus is not text', 'compress', { focus: 3 }]
  ])('refuses %s', async (_, operation, payload) => {
    const { call } = await rawSocket({}, STORY)
    expect(await call('session.mutate', { ...fenced, operation, payload })).toMatchObject(refusal('invalid_params'))
  })
})

describe('the scripted gateway and the session panels', () => {
  const PROCESSES = { processes: [{ session_id: 'proc_1', command: 'npm run build', status: 'running' }] }
  const KILLED = { processes: [{ session_id: 'proc_1', command: 'npm run build', status: 'exited', completion_reason: 'killed' }] }
  const CONTROL = { control: { goal: null, loop: null, heartbeat: null, revision: '', updated_at: 0 } }
  const STORY: Fixture = {
    header: { ...ERRAND.header, reads: { 'process.list': PROCESSES, 'session.control.read': CONTROL } },
    steps: [
      { at: 0, await: 'process.kill', params: {}, reply: { status: 'killed', session_id: 'proc_1' } },
      { at: 0, reads: { 'process.list': KILLED } },
      { at: 0, await: 'session.control', params: {}, reply: { ...CONTROL, dispatch: { type: 'exec', output: 'Goal paused.', notice: null, message: null, display: null } } },
      { at: 0, await: 'rollback.list', params: {}, reply: { enabled: true, checkpoints: [] } },
      { at: 0, await: 'rollback.diff', params: {}, reply: { stat: '', diff: '' } },
      { at: 0, await: 'rollback.restore', params: {}, reply: { success: true } },
      { at: 0, await: 'message.react', params: {}, reply: { row_id: 2, reactions: [] } }
    ]
  }

  it('answers each read as the story last said, and a read the story never names as an unknown method, as a Hermes without it does', async () => {
    const { call, played } = await rawSocket({}, STORY)
    await call('session.resume', { session_id: SESSION })
    expect((await call('process.list', { session_id: SESSION })).result).toEqual(PROCESSES)
    expect((await call('session.control.read', { session_id: SESSION })).result).toEqual(CONTROL)
    await call('process.kill', { session_id: SESSION, process_id: 'proc_1' })
    await played()
    expect((await call('process.list', { session_id: SESSION })).result).toEqual(KILLED)
    expect(await call('process.list', { session_id: SESSION, all: true })).toMatchObject(refusal('invalid_params'))
    expect(await call('process.list', { session_id: 'other' })).toMatchObject(refusal('not_found'))
    const errand = await rawSocket()
    expect(await errand.call('process.list', { session_id: SESSION })).toMatchObject({ error: { code: -32601 } })
    expect(await errand.call('session.control.read', { session_id: SESSION })).toMatchObject({ error: { code: -32601 } })
  })

  it('refuses each write outside the closed key set Hermes checks, and takes the story\'s own', async () => {
    const { call, played } = await rawSocket({}, STORY)
    await call('session.resume', { session_id: SESSION })
    expect(await call('process.kill', { session_id: SESSION, process_id: '' })).toMatchObject(refusal('invalid_params'))
    expect(await call('process.kill', { session_id: SESSION, process_id: 'proc_1', force: true })).toMatchObject(refusal('invalid_params'))
    expect(await call('process.kill', { session_id: SESSION, process_id: 'proc_1' })).toMatchObject({ result: { status: 'killed' } })
    await played()
    expect(await call('session.control', { session_id: SESSION, action: 'goal.delete', args: {} })).toMatchObject(refusal('invalid_params'))
    expect(await call('session.control', { session_id: SESSION, action: 'subgoal.add', args: { text: ' ' } })).toMatchObject(refusal('invalid_params'))
    expect(await call('session.control', { session_id: SESSION, action: 'subgoal.remove', args: { index: 0 } })).toMatchObject(refusal('invalid_params'))
    expect(await call('session.control', { session_id: SESSION, action: 'goal.pause', args: { why: 'x' } })).toMatchObject(refusal('invalid_params'))
    expect(await call('session.control', { session_id: SESSION, action: 'goal.pause', args: {} })).toMatchObject({ result: { dispatch: { output: 'Goal paused.' } } })
    expect(await call('rollback.list', { session_id: SESSION, hash: 'abc' })).toMatchObject(refusal('invalid_params'))
    await call('rollback.list', { session_id: SESSION })
    expect(await call('rollback.diff', { session_id: SESSION })).toMatchObject(refusal('invalid_params'))
    await call('rollback.diff', { session_id: SESSION, hash: 'abc' })
    expect(await call('rollback.restore', { session_id: SESSION, hash: 'abc', all: 'yes' })).toMatchObject(refusal('invalid_params'))
    expect(await call('rollback.restore', { session_id: SESSION, hash: 'abc', file_path: 'notes.md', all: false })).toMatchObject({ result: { success: true } })
    expect(await call('message.react', { session_id: SESSION, emoji: '👍' })).toMatchObject(refusal('invalid_params'))
    expect(await call('message.react', { session_id: SESSION, row_id: 2, emoji: ' ' })).toMatchObject(refusal('invalid_params'))
    expect(await call('message.react', { session_id: SESSION, row_id: 2, emoji: '👍', author: 'bot' })).toMatchObject(refusal('invalid_params'))
    expect(await call('message.react', { session_id: SESSION, row_id: 2, emoji: null })).toMatchObject({ result: { row_id: 2 } })
  })
})
