import { describe, expect, it } from 'vitest'
import toolsets from '../../../fixtures/tools/three.json' with { type: 'json' }
import type { BotId } from '../src/domain/bots'
import { openHermes, type AskHermes, type HttpAnswer, type HttpAsk } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { fixtureAsk, scriptedDialer, type Fixture, type ToolsetSeed } from '../src/testing/fixture'
import { parseBotToolsets } from '../src/domain/toolsets'
import { parseToolsets } from '../src/wire/parse'
import { BOUND, callsIn, SESSION, WITH_BOTS } from './support/errand'

const SEEDS = toolsets as readonly ToolsetSeed[]
const RAE = 'rae' as BotId
const NO_ANSWER = new Error('connect ECONNREFUSED')
const CANT_SWITCH = "This Hermes can't switch toolsets from Highwing."
const UNREACHED = "Highwing couldn't reach Hermes's toolset settings, so it can't switch them now."

/** The rows `GET /api/tools/toolsets` answers (hermes_cli/web_routers/tools.py:224-271). */
const ROWS = [
  { name: 'web', label: 'Web Search & Scraping', description: 'Search the web.', platform: 'cli', platform_label: 'CLI', enabled: true, available: true, configured: true, tools: ['web_search', 'web_extract'] },
  { name: 'discord', label: 'Discord', description: 'Post to Discord.', platform: 'discord', platform_label: 'Discord', enabled: false, available: true, configured: true, tools: ['discord'] }
]

async function launched(seeds: readonly ToolsetSeed[] | null, fixture: Fixture = WITH_BOTS, answer: HttpAnswer | Error | AskHermes = { status: 404, body: { detail: 'Not Found' } }) {
  const clock = manualClock()
  const script = scriptedDialer({ ...fixture, header: { ...fixture.header, ...(seeds === null ? {} : { tools: seeds }) } }, { clock })
  const asked: HttpAsk[] = []
  const ask: AskHermes = async request => {
    asked.push(request)
    if (typeof answer === 'function') return answer(request)
    if (answer instanceof Error) throw answer
    return answer
  }
  const hermes = openHermes({ ask, dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  const run: typeof hermes.run = async command => {
    const reply = hermes.run(command)
    await clock.advance(5_000)
    return reply
  }
  return { run, asked, calls: () => callsIn(script.received).filter(call => call.method === 'tools.list') }
}

describe('the toolsets of a bot', () => {
  it("lists what Hermes's route sends for the bot, with a switch each, and reads no chat", async () => {
    const { run, asked, calls } = await launched(SEEDS, WITH_BOTS, { status: 200, body: ROWS })
    expect(await run({ do: 'tools', bot: RAE, sessionId: SESSION })).toEqual({
      ok: true,
      value: {
        locked: null,
        toolsets: [
          { name: 'web', label: 'Web Search & Scraping', place: null, description: 'Search the web.', tools: ['web_search', 'web_extract'], toolCount: 2, enabled: true },
          { name: 'discord', label: 'Discord', place: 'Discord', description: 'Post to Discord.', tools: ['discord'], toolCount: 1, enabled: false }
        ]
      }
    })
    expect(asked).toEqual([{ method: 'GET', path: '/api/tools/toolsets', bot: RAE }])
    expect(calls()).toEqual([])
  })

  it('asks for the launch profile when no bot is named', async () => {
    const { run, asked } = await launched(SEEDS, WITH_BOTS, { status: 200, body: [] })
    expect(await run({ do: 'tools', bot: null, sessionId: null })).toEqual({ ok: true, value: { toolsets: [], locked: null } })
    expect(asked).toEqual([{ method: 'GET', path: '/api/tools/toolsets', bot: null }])
  })

  it.each<[string, HttpAnswer | Error, string]>([
    ['a Hermes without the route (404)', { status: 404, body: { detail: 'Not Found' } }, CANT_SWITCH],
    ['a route that refuses the method (405)', { status: 405, body: null }, CANT_SWITCH],
    ['a ticket bound to another profile (403)', { status: 403, body: { detail: 'profile_scope_mismatch' } }, CANT_SWITCH],
    ['a server error (500)', { status: 500, body: null }, UNREACHED],
    ['a sign-in that has ended (401)', { status: 401, body: null }, UNREACHED],
    ['a body that is no list', { status: 200, body: { toolsets: [] } }, UNREACHED],
    ['no answer', NO_ANSWER, UNREACHED]
  ])('lists the chat\'s toolsets with no switches for %s', async (_what, answer, locked) => {
    const { run, calls } = await launched(SEEDS, WITH_BOTS, answer)
    const listed = await run({ do: 'tools', bot: RAE, sessionId: SESSION })
    expect(listed).toMatchObject({ ok: true, value: { locked } })
    expect(listed.ok && listed.value.toolsets.map(({ name, label, place, toolCount, enabled }) => ({ name, label, place, toolCount, enabled }))).toEqual([
      { name: 'browser', label: 'browser', place: null, toolCount: 9, enabled: true },
      { name: 'file', label: 'file', place: null, toolCount: 4, enabled: true },
      { name: 'image_gen', label: 'image_gen', place: null, toolCount: 1, enabled: false }
    ])
    expect(listed.ok && listed.value.toolsets[1]).toEqual({
      name: 'file', label: 'file', place: null, description: 'Read, write, search and patch files.', tools: ['read_file', 'write_file', 'patch', 'search_files'], toolCount: 4, enabled: true
    })
    expect(calls()).toEqual([expect.objectContaining({ params: { session_id: SESSION } })])
  })

  it('names no chat in the older read when none is open, so Hermes reads the launch profile', async () => {
    const { run, calls } = await launched(SEEDS)
    expect(await run({ do: 'tools', bot: null, sessionId: null })).toMatchObject({ ok: true })
    expect(calls()).toEqual([expect.objectContaining({ params: {} })])
  })

  it.each([['a Hermes without the call', null, WITH_BOTS], ['a socket bound to one profile', SEEDS, BOUND]])('says %s can’t list tools, when the route is no help either', async (_, seeds, fixture) => {
    const { run } = await launched(seeds, fixture)
    expect(await run({ do: 'tools', bot: null, sessionId: null })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't list its tools." } })
  })
})

describe('switching a toolset, against the fixture’s Hermes', () => {
  it('shows the switch on the next read of the same bot only', async () => {
    const { run } = await launched(null, WITH_BOTS, fixtureAsk({ toolsets: ROWS }))
    const stateOf = async (bot: BotId | null) => {
      const read = await run({ do: 'tools', bot, sessionId: null })
      return read.ok ? read.value.toolsets.map(({ name, enabled }) => `${name}:${enabled ? 'on' : 'off'}`) : read.refusal.message
    }
    expect(await run({ do: 'setToolset', bot: RAE, name: 'web', enabled: false })).toEqual({ ok: true, value: { name: 'web', enabled: false } })
    expect(await stateOf(RAE)).toEqual(['web:off', 'discord:off'])
    expect(await stateOf(null)).toEqual(['web:on', 'discord:off'])
    expect(await run({ do: 'setToolset', bot: RAE, name: 'nope', enabled: true })).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'Unknown toolset: nope.' } })
  })
})

describe('switching a toolset', () => {
  const SWITCHED = { ok: true, name: 'web', platform: 'cli', enabled: false, post_setup_started: null }

  it("sends the state to Hermes's route for the bot, and answers the state Hermes wrote", async () => {
    const { run, asked } = await launched(SEEDS, WITH_BOTS, { status: 200, body: SWITCHED })
    expect(await run({ do: 'setToolset', bot: RAE, name: 'web', enabled: false })).toEqual({ ok: true, value: { name: 'web', enabled: false } })
    expect(asked).toEqual([{ method: 'PUT', path: '/api/tools/toolsets/web', bot: RAE, json: { enabled: false } }])
  })

  it('names the toolset in the path as one segment, and the launch profile as no bot', async () => {
    const { run, asked } = await launched(SEEDS, WITH_BOTS, { status: 200, body: { ...SWITCHED, name: 'a/b', enabled: true } })
    expect(await run({ do: 'setToolset', bot: null, name: 'a/b', enabled: true })).toEqual({ ok: true, value: { name: 'a/b', enabled: true } })
    expect(asked).toEqual([{ method: 'PUT', path: '/api/tools/toolsets/a%2Fb', bot: null, json: { enabled: true } }])
  })

  it.each<[string, HttpAnswer | Error, { readonly kind: string; readonly message: string }]>([
    ['a Hermes without the route (404)', { status: 404, body: null }, { kind: 'unsupported', message: CANT_SWITCH }],
    ['a route that refuses the method (405)', { status: 405, body: null }, { kind: 'unsupported', message: CANT_SWITCH }],
    ['a ticket bound to another profile (403)', { status: 403, body: { detail: 'profile_scope_mismatch' } }, { kind: 'unsupported', message: CANT_SWITCH }],
    ['a toolset Hermes does not know (400)', { status: 400, body: { detail: 'Unknown toolset: web' } }, { kind: 'rejected', message: 'Unknown toolset: web.' }],
    ['a 400 with no words', { status: 400, body: null }, { kind: 'rejected', message: "Hermes wouldn't switch web." }],
    ['a server error (500)', { status: 500, body: null }, { kind: 'offline', message: "Highwing couldn't reach Hermes, so web wasn't switched." }],
    ['a 200 that does not say ok', { status: 200, body: { ok: false } }, { kind: 'offline', message: "Highwing couldn't reach Hermes, so web wasn't switched." }],
    ['no answer', NO_ANSWER, { kind: 'offline', message: "Highwing couldn't reach Hermes, so web wasn't switched." }]
  ])('refuses in plain words for %s', async (_what, answer, refusal) => {
    const { run } = await launched(SEEDS, WITH_BOTS, answer)
    expect(await run({ do: 'setToolset', bot: RAE, name: 'web', enabled: false })).toEqual({ ok: false, refusal })
  })
})

describe('parseToolsets', () => {
  it('keeps Hermes’s count when it lists fewer tools, drops a row with no name, and reads only true as on', () => {
    expect(parseToolsets({
      toolsets: [
        { name: 'web', description: ' Search. ', tool_count: 3, enabled: true, tools: ['web_search', ' '] },
        { name: '', description: 'x', tool_count: 1, enabled: true },
        { name: 'code', description: '', tool_count: -1, enabled: 'yes' as never }
      ]
    })).toEqual([
      { name: 'web', label: 'web', place: null, description: 'Search.', tools: ['web_search'], toolCount: 3, enabled: true },
      { name: 'code', label: 'code', place: null, description: '', tools: [], toolCount: 0, enabled: false }
    ])
    expect(parseToolsets({} as never)).toEqual([])
  })
})

describe('parseBotToolsets', () => {
  it('reads Hermes’s label, names a platform that is not the chat, counts the tools it lists, and drops a row with no name', () => {
    expect(parseBotToolsets([
      { name: 'web', label: ' Web Search ', description: ' Search. ', platform: 'cli', platform_label: 'CLI', enabled: true, tools: ['web_search', ' '] },
      { name: 'discord', platform: 'discord', platform_label: 'Discord', enabled: false },
      { name: 'slack', platform: 'slack', enabled: 'yes' },
      { name: ' ', label: 'x' },
      'x'
    ])).toEqual([
      { name: 'web', label: 'Web Search', place: null, description: 'Search.', tools: ['web_search'], toolCount: 1, enabled: true },
      { name: 'discord', label: 'discord', place: 'Discord', description: '', tools: [], toolCount: 0, enabled: false },
      { name: 'slack', label: 'slack', place: 'slack', description: '', tools: [], toolCount: 0, enabled: false }
    ])
  })

  it.each([[{}], ['x'], [null], [{ toolsets: [] }]])('refuses %j, which is no list', body => {
    expect(parseBotToolsets(body)).toBeNull()
  })
})
