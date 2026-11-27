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

/**
 * Each row is a call and the answer of Hermes 0.23.3's own `canonical_param_problems`
 * (`tui_gateway/contracts/registry.py:154`), run with Hermes's interpreter.
 */
const DISPATCHER_VERDICTS: readonly (readonly [string, Record<string, unknown>, readonly string[]])[] = [
  ['prompt.submit', { session_id: 's' }, []],
  ['prompt.submit', {}, []],
  ['prompt.submit', { session_id: 's', text: 1 }, ['text']],
  ['prompt.submit', { session_id: 's', text: 'x', bogus: 1 }, ['bogus']],
  ['prompt.submit', { session_id: 's', text: 'x', queued: 'yes' }, []],
  ['prompt.submit', { session_id: 's', text: 'x', queued: 1 }, []],
  ['prompt.submit', { session_id: 's', text: 'x', attachments: [{ x: 1 }] }, ['attachments.0.x']],
  ['approval.respond', { session_id: 's' }, []],
  ['approval.respond', { session_id: 's', execution_generation: '1', prompt_id: 'p', choice: 'once' }, []],
  ['approval.respond', { session_id: 's', execution_generation: 'x', prompt_id: 'p', choice: 'once' }, ['execution_generation']],
  ['approval.respond', { session_id: 's', execution_generation: true, prompt_id: 'p', choice: 'once' }, []],
  ['approval.respond', { session_id: 's', execution_generation: 1.5, prompt_id: 'p', choice: 'once', all: true }, ['execution_generation', 'all']],
  ['session.create', { source: 'nope' }, ['source']],
  ['session.create', { source: 'gui', cwd: 3, cwd_explicit: true }, ['cwd']],
  ['session.create', {}, []],
  ['session.create', { client: { name: 'a', version: 'b' } }, []],
  ['session.create', { client: { name: 'a', version: 'b', zzz: 1 } }, ['client.zzz']],
  ['clarify.respond', { session_id: 's' }, ['execution_generation', 'prompt_id', 'answer']],
  ['clarify.respond', { session_id: 's', execution_generation: 'x', prompt_id: 'p', answer: 3 }, []],
  ['session.detach', { session_id: 's', subscription_id: 5, x: 1 }, ['x']],
  ['session.resume', { session_id: 5 }, ['session_id']],
  ['session.resume', {}, []],
  ['session.events.since', { last_seen: 1 }, []],
  ['session.events.since', { session_id: 's', last_seen: '1' }, []],
  ['session.interrupt', { session_id: 's' }, []],
  ['runtime.describe', { a: 1 }, ['a']]
]

describe('checkParams', () => {
  it.each(DISPATCHER_VERDICTS)('%s %j is refused for %j, as the gateway\'s dispatcher refuses it', (method, params, refused) => {
    expect([...(checkParams(method, params) ?? ['undeclared'])].sort()).toEqual([...refused].sort())
  })

  it('leaves a missing key on a method the sidecar shares to the handler, and refuses a bad value', () => {
    expect(checkParams('prompt.submit', { session_id: 's' })).toEqual([])
    expect(checkParams('approval.respond', { session_id: 's', choice: 7 })).toEqual(['choice'])
  })

  it('refuses params that are not an object', () => {
    expect(checkParams('session.resume', ['s'])).toEqual(['params'])
  })

  it('checks nothing on a method only the sidecar declares, and knows no method the contract does not declare', () => {
    expect(checkParams('client.capabilities', { server_requests: true, anything: 1 })).toEqual([])
    expect(checkParams('approval.answer', {})).toBeUndefined()
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

  it('takes the warnings a create answers with as a list of strings', () => {
    expect(loadFixture(write([{ ...header, createWarnings: ['A step failed.'] }])).header.createWarnings).toEqual(['A step failed.'])
    expect(loadFixture(write([header])).header).not.toHaveProperty('createWarnings')
    const path = write([{ ...header, createWarnings: 'A step failed.' }])
    expect(() => loadFixture(path)).toThrow(`${path}:1: "createWarnings" must be a list of strings`)
  })

  it("takes every bot's deny rules as a list of strings", () => {
    expect(loadFixture(write([{ ...header, deny: ['git push --force*'] }])).header.deny).toEqual(['git push --force*'])
    expect(loadFixture(write([header])).header).not.toHaveProperty('deny')
    const path = write([{ ...header, deny: [7] }])
    expect(() => loadFixture(path)).toThrow(`${path}:1: "deny" must be a list of strings`)
  })

  it("takes each bot's persona as text, and the title of a clash as words", () => {
    const loaded = loadFixture(write([{ ...header, souls: { rae: 'You write.' }, configureClash: 'Robin' }])).header
    expect([loaded.souls, loaded.configureClash]).toEqual([{ rae: 'You write.' }, 'Robin'])
    const souls = write([{ ...header, souls: { rae: 7 } }])
    expect(() => loadFixture(souls)).toThrow(`${souls}:1: "souls" must map a profile to its persona`)
    const clash = write([{ ...header, configureClash: ' ' }])
    expect(() => loadFixture(clash)).toThrow(`${clash}:1: "configureClash" must be the title another client writes`)
  })

  it('reads what image.generate, llm.oneshot and the pet calls answer and the words a picture write fails with, and refuses any other shape', () => {
    const images = { available: true, picture: 'data:image/png;base64,iVBORw0K', delay_ms: 1200 }
    const pets = { pets: [{ slug: 'tabby' }], thumbs: { tabby: 'data:image/png;base64,iVBORw0K' } }
    const oneshot = { text: 'Invoices sorted', delay_ms: 800 }
    expect(loadFixture(write([{ ...header, images, pets, oneshot, assetFails: 'disk full' }])).header).toMatchObject({ images, pets, oneshot, assetFails: 'disk full' })
    expect(Object.keys(loadFixture(write([header])).header)).not.toContain('images')
    for (const [key, value, words] of [
      ['images', { picture: 'x' }, '"images" must be { available, picture?, error?, delay_ms? }'],
      ['images', { available: true, delay_ms: -1 }, '"images" must be { available, picture?, error?, delay_ms? }'],
      ['pets', { pets: [], thumbs: {}, refused_once: 'tabby' }, '"pets" must be { pets, thumbs, delay_ms?, refused_once? } with "thumbs" mapping a slug to a data URL'],
      ['pets', { pets: [], thumbs: { tabby: 7 } }, '"pets" must be { pets, thumbs, delay_ms?, refused_once? } with "thumbs" mapping a slug to a data URL'],
      ['assetFails', ' ', '"assetFails" must be the words a failed write gives'],
      ['oneshot', { text: 7 }, '"oneshot" must be { text?, error?, delay_ms? }'],
      ['oneshot', { delay_ms: 'soon' }, '"oneshot" must be { text?, error?, delay_ms? }']
    ] as const) {
      const path = write([{ ...header, [key]: value }])
      expect(() => loadFixture(path)).toThrow(`${path}:1: ${words}`)
    }
  })

  it("reads each profile's password managers, and refuses a manager it does not know or a seed of another shape", () => {
    const vault = { default: { bitwarden: { installed: true, password: 'pw', logins: ['github.com'] } }, research: {} }
    expect(loadFixture(write([{ ...header, vault }])).header.vault).toEqual(vault)
    const words = '"vault" must map a profile to { onepassword?, bitwarden? }, each { installed, enabled?, unlocked?, logins?, password?, refuses?, token?, listFails? }'
    for (const value of [{ default: { keeper: { installed: true } } }, { default: { bitwarden: { enabled: true } } }, { default: { bitwarden: { installed: true, master: 'pw' } } }]) {
      const path = write([{ ...header, vault: value }])
      expect(() => loadFixture(path)).toThrow(`${path}:1: ${words}`)
    }
  })

  it('refuses a header whose profiles are not a profiles.list reply', () => {
    const path = write([{ ...header, profiles: [{ name: 'default' }] }])
    expect(() => loadFixture(path)).toThrow(`${path}:1: "profiles" must be a profiles.list reply with "profiles"`)
    expect(loadFixture(write([{ ...header, profiles: { profiles: [] } }])).header.profiles).toEqual({ profiles: [] })
  })

  it('reads what the sockets reach and whether the home bot has a Bot Chat, and refuses any other value', () => {
    expect(loadFixture(write([{ ...header, reach: 'profile', homeBotChat: false }])).header).toMatchObject({ reach: 'profile', homeBotChat: false })
    expect(loadFixture(write([header])).header).not.toHaveProperty('reach')
    const reach = write([{ ...header, reach: 'everything' }])
    expect(() => loadFixture(reach)).toThrow(`${reach}:1: "reach" must be "host" or "profile"`)
    const chat = write([{ ...header, homeBotChat: 'no' }])
    expect(() => loadFixture(chat)).toThrow(`${chat}:1: "homeBotChat" must be true or false`)
  })

  it('reads the media an image loader answers with, and refuses a value that is not base64 text', () => {
    expect(loadFixture(write([{ ...header, media: { 'https://example.com/c.png': 'iVBORw0K' } }])).header.media).toEqual({ 'https://example.com/c.png': 'iVBORw0K' })
    expect(loadFixture(write([header])).header).not.toHaveProperty('media')
    for (const media of [['x'], 'x', { '/tmp/a.png': 1 }]) {
      const path = write([{ ...header, media }])
      expect(() => loadFixture(path)).toThrow(`${path}:1: "media" must map a url or path to base64 bytes`)
    }
  })

  it('reads the attachment limits a run sets, and refuses a limit that is not a number of bytes', () => {
    expect(loadFixture(write([{ ...header, attachLimits: { image: 20000 } }])).header.attachLimits).toEqual({ image: 20000 })
    expect(loadFixture(write([header])).header).not.toHaveProperty('attachLimits')
    for (const attachLimits of [{ image: 0 }, { file: '1' }, { pdf: 10 }, 20000]) {
      const path = write([{ ...header, attachLimits }])
      expect(() => loadFixture(path)).toThrow(`${path}:1: "attachLimits" may hold only "image" and "file", each a number of bytes above 0`)
    }
  })

  it('reads the to-do list the session starts with, and refuses one that is not a list at a revision', () => {
    const todoState = { todos: [{ id: '1', content: 'Check disk', status: 'pending' }], revision: 2 }
    expect(loadFixture(write([{ ...header, todo_state: todoState }])).header.todo_state).toEqual(todoState)
    expect(loadFixture(write([header])).header).not.toHaveProperty('todo_state')
    for (const todo_state of [{ todos: [] }, { todos: 'none', revision: 1 }, { todos: [], revision: -1 }, null]) {
      const path = write([{ ...header, todo_state }])
      expect(() => loadFixture(path)).toThrow(`${path}:1: "todo_state" must be { todos, revision } with "revision" a whole number`)
    }
  })

  it("reads a profile's seeded chats, and refuses a chat with no rows", () => {
    const chats = { research: [{ id: 'r1', title: 'Sort', last_active: 1, rows: [{ role: 'user', text: 'hi' }], asking: { command: 'ls', description: 'list' } }] }
    expect(loadFixture(write([{ ...header, chats }])).header.chats).toEqual(chats)
    const bad = write([{ ...header, chats: { research: [{ id: 'r1', title: 'Sort', last_active: 1 }] } }])
    expect(() => loadFixture(bad)).toThrow(`${bad}:1: "chats" must map a profile to its chats, each with id, title, last_active and rows`)
    const branched = { research: [...chats.research, { id: 'r2', title: 'Sort #2', last_active: 2, rows: [], branched_from: 'r1' }] }
    expect(loadFixture(write([{ ...header, chats: branched, tree: true }])).header).toMatchObject({ chats: branched, tree: true })
    const orphan = write([{ ...header, chats: { research: [{ id: 'r2', title: 'Sort #2', last_active: 2, rows: [], branched_from: 'r1' }] } }])
    expect(() => loadFixture(orphan)).toThrow(`${orphan}:1: "branched_from" must name another chat of the same profile`)
  })

  it('reads the YOLO the chat starts in and whether Hermes refuses a switch, and refuses any other value', () => {
    expect(loadFixture(write([{ ...header, yolo: true, yoloDenied: true }])).header).toMatchObject({ yolo: true, yoloDenied: true })
    expect(loadFixture(write([header])).header).not.toHaveProperty('yolo')
    const yolo = write([{ ...header, yolo: 'on' }])
    expect(() => loadFixture(yolo)).toThrow(`${yolo}:1: "yolo" must be true or false`)
    const denied = write([{ ...header, yoloDenied: 1 }])
    expect(() => loadFixture(denied)).toThrow(`${denied}:1: "yoloDenied" must be true or false`)
  })

  it('reads what each bot does with a message handed to it, and refuses an entry that is neither a reply nor a refusal', () => {
    const relay = { rae: { reply: 'Done.', delay_ms: 1500 }, sam: { refuse: 'runtime_unavailable' }, ada: { reply: 'Yes.' } }
    expect(loadFixture(write([{ ...header, relay }])).header.relay).toEqual(relay)
    expect(loadFixture(write([header])).header).not.toHaveProperty('relay')
    for (const entry of [{}, { reply: 7 }, { reply: 'Done.', delay_ms: -1 }, { reply: 'Done.', refuse: 'busy' }, { refuse: '' }, 'Done.']) {
      const bad = write([{ ...header, relay: { rae: entry } }])
      expect(() => loadFixture(bad), JSON.stringify(entry)).toThrow(`${bad}:1: "relay" must map a profile to { reply, delay_ms? } or { refuse }`)
    }
  })

  it("reads how long each profile's turns take and whether Hermes lists live chats, and refuses a time or a flag of another kind", () => {
    const turnMs = { 'dr-eggbot': 6000, research: 0 }
    expect(loadFixture(write([{ ...header, turnMs, activeList: false }])).header).toMatchObject({ turnMs, activeList: false })
    expect(loadFixture(write([header])).header).not.toHaveProperty('turnMs')
    for (const ms of [-1, 1.5, '6000']) {
      const bad = write([{ ...header, turnMs: { 'dr-eggbot': ms } }])
      expect(() => loadFixture(bad), JSON.stringify(ms)).toThrow(`${bad}:1: "turnMs" must map a profile to a whole number of ms`)
    }
    const flag = write([{ ...header, activeList: 'no' }])
    expect(() => loadFixture(flag)).toThrow(`${flag}:1: "activeList" must be true or false`)
  })

  it('reads the group chats of the home profile, and refuses a room that seats too few, too many or an unlisted profile, or a turn of no known shape', () => {
    const profiles = { profiles: [{ name: 'default', is_default: true }, { name: 'sam' }, { name: 'juno' }] }
    const seats = (...names: string[]) => names.map(profile => ({ profile, handle: profile }))
    const groups = {
      driver: false, seatable: ['default', 'sam'], change_events: false,
      rooms: [{ id: 'launch-plan', name: 'Launch plan', members: seats('default', 'sam', 'juno'), epoch: 2, log: [{ user: 'Ship it?' }, { member: 'sam', text: 'Yes.' }] }],
      turns: { sam: [{ reply: 'Close.', delay_ms: 900 }, { hold: true }], juno: [{ fail: 'No model.' }] }
    }
    expect(loadFixture(write([{ ...header, profiles, groups }])).header.groups).toEqual(groups)
    expect(loadFixture(write([{ ...header, profiles, groups: {} }])).header.groups).toEqual({})
    expect(loadFixture(write([header])).header).not.toHaveProperty('groups')
    const shape = '"groups" may hold only "driver", "seatable", "rooms", "change_events" and "turns": each room { id, name, members, epoch?, log? } seating 2 to 6 { profile, handle }, and each turn { reply, delay_ms? }, { fail, delay_ms? } or { hold: true }'
    for (const entry of [
      { talk: {} }, { driver: 'yes' }, { seatable: 'sam' }, { rooms: [{ id: 'a', name: 'A', members: seats('sam') }] }, { rooms: [{ id: 'a', name: 'A', members: [{ profile: 'sam' }, { profile: 'juno' }] }] },
      { turns: { sam: [{ reply: 'Hi', fail: 'No' }] } }, { turns: { sam: [{ hold: false }] } }, { turns: { sam: [{ reply: 'Hi', delay_ms: -1 }] } }, { rooms: [{ id: 'a', name: 'A', members: seats('sam', 'juno'), log: [{ said: 'Hi' }] }] }
    ]) {
      const bad = write([{ ...header, profiles, groups: entry }])
      expect(() => loadFixture(bad), JSON.stringify(entry)).toThrow(`${bad}:1: ${shape}`)
    }
    const stray = write([{ ...header, profiles, groups: { rooms: [{ id: 'a', name: 'A', members: seats('sam', 'zed') }] } }])
    expect(() => loadFixture(stray)).toThrow(`${stray}:1: "groups" names profiles the header's "profiles" does not list (a: zed)`)
    const strayTurn = write([{ ...header, profiles, groups: { turns: { zed: [{ hold: true }] } } }])
    expect(() => loadFixture(strayTurn)).toThrow(`${strayTurn}:1: "groups" names profiles the header's "profiles" does not list (turns: zed)`)
  })

  it('reads the words complete.path answers and the folder, and refuses a header that holds neither', () => {
    const paths = { cwd: '/home/sam/errands', words: { '@not': { items: [{ text: '@file:notes.md' }] } } }
    expect(loadFixture(write([{ ...header, paths }])).header.paths).toEqual(paths)
    expect(loadFixture(write([header])).header).not.toHaveProperty('paths')
    for (const entry of ['notes', { cwd: 7, words: {} }, { cwd: '/x' }, { words: [] }]) {
      const bad = write([{ ...header, paths: entry }])
      expect(() => loadFixture(bad), JSON.stringify(entry)).toThrow(`${bad}:1: "paths" must be { cwd?, words } with "words" mapping a typed word to its complete.path reply`)
    }
  })

  it('reads the attach info the chat starts with, and refuses one that is not an object', () => {
    expect(loadFixture(write([{ ...header, info: { cwd: '/work', fast: false } }])).header.info).toEqual({ cwd: '/work', fast: false })
    expect(loadFixture(write([header])).header).not.toHaveProperty('info')
    const info = write([{ ...header, info: ['cwd'] }])
    expect(() => loadFixture(info)).toThrow(`${info}:1: "info" must be an object of attach info fields`)
  })

  it('reads the panel reads the chat starts with and a step that changes them, and refuses a read Hermes does not have', () => {
    const reads = { 'process.list': { processes: [] } }
    const loaded = loadFixture(write([{ ...header, reads }, { at: 0, reads: { 'session.control.read': { control: null } } }]))
    expect(loaded.header.reads).toEqual(reads)
    expect(loaded.steps).toEqual([{ at: 0, reads: { 'session.control.read': { control: null } } }])
    const unknown = write([{ ...header, reads: { 'process.tail': {} } }])
    expect(() => loadFixture(unknown)).toThrow(`${unknown}:1: "reads" must map process.list or session.control.read to a reply`)
    const step = write([header, { at: 0, reads: { 'config.get': {} } }])
    expect(() => loadFixture(step)).toThrow(`${step}:2: "reads" must map process.list or session.control.read to a reply`)
  })

  it('names the line of the prototype\'s envelope', () => {
    const path = write([header, { at: 0, push: { kind: 'event', type: 'message.delta', session_id: 's', seq: 1, payload: {} } }])
    expect(() => loadFixture(path)).toThrow(`${path}:2: "push" must be a JSON-RPC 2.0 frame with a method`)
  })
})
