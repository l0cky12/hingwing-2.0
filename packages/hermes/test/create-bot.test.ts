import { describe, expect, it } from 'vitest'
import three from '../../../fixtures/models/three.json' with { type: 'json' }
import { botModels, createBot } from '../src/bot-admin'
import type { BotDraft, BotId } from '../src/domain/bots'
import type { ModelOption } from '../src/domain/session'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { scriptedDialer, type Fixture } from '../src/testing/fixture'
import { Offline, RpcRefusal, type Connection } from '../src/wire/link'
import { parseCreated } from '../src/wire/parse'
import { BOUND, callsIn, ERRAND, WITH_BOTS } from './support/errand'

const CAREFUL: ModelOption = { id: 'careful-large' as ModelOption['id'], provider: 'acme', providerName: 'Acme' }
const RAE: BotDraft = { name: 'Rae', description: 'Writes the weekly report', model: CAREFUL, persona: 'You write short, plain reports for the team.' }
const WITH_MODELS: Fixture = { ...WITH_BOTS, header: { ...WITH_BOTS.header, models: three } }

async function launched(fixture: Fixture) {
  const clock = manualClock()
  const script = scriptedDialer(fixture, { clock })
  const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  const calls = (method: string) => callsIn(script.received).filter(call => call.method === method)
  const names = () => {
    const bots = hermes.bots.get()
    return bots.state === 'listed' ? [bots.roster.featured, ...bots.roster.sections.flatMap(section => section.bots)].flatMap(bot => bot?.id ?? []) : bots.state
  }
  return { clock, hermes, calls, names }
}

describe('createBot through the hub', () => {
  it('sends the typed name, description, persona and model, then lists the new bot and opens it', async () => {
    const { clock, hermes, calls, names } = await launched(WITH_BOTS)
    const reads = calls('profiles.list').length
    expect(await hermes.run({ do: 'createBot', draft: RAE })).toEqual({ ok: true, value: { bot: 'rae', warnings: [] } })
    expect(calls('profiles.create')).toEqual([{
      method: 'profiles.create',
      params: { name: 'Rae', description: 'Writes the weekly report', soul: 'You write short, plain reports for the team.', model: 'careful-large', provider: 'acme' }
    }])
    await clock.advance(0)
    expect(calls('profiles.list').length, 'the roster is asked for again').toBe(reads + 1)
    expect(names()).toContain('rae')
    expect(hermes.open.get()).toEqual({ shown: { kind: 'bot', bot: 'rae', sessionId: null }, opening: null })
    expect(calls('session.list').filter(call => call.params?.profile === 'rae').map(call => call.params?.title), "the new bot's chat is looked up in its own profile").toContain('Bot Chat')
  })

  it('leaves out what was not typed', async () => {
    const { calls, hermes } = await launched(WITH_BOTS)
    await hermes.run({ do: 'createBot', draft: { name: ' rae ', description: '  ', model: null, persona: ' \n ' } })
    expect(calls('profiles.create')).toEqual([{ method: 'profiles.create', params: { name: 'rae' } }])
  })

  it("passes the persona as typed, not trimmed, because it is the bot's SOUL.md", async () => {
    const { calls, hermes } = await launched(WITH_BOTS)
    await hermes.run({ do: 'createBot', draft: { ...RAE, persona: '  Plain.\n' } })
    expect(calls('profiles.create')[0]?.params?.soul).toBe('  Plain.\n')
  })

  it("returns Hermes's warnings, and the bot is listed and open all the same", async () => {
    const warning = 'subscription logins not carried over (acme): the profile uses the default profile\'s.'
    const { clock, hermes, names } = await launched({ ...WITH_BOTS, header: { ...WITH_BOTS.header, createWarnings: [warning] } })
    expect(await hermes.run({ do: 'createBot', draft: RAE })).toEqual({ ok: true, value: { bot: 'rae', warnings: [warning] } })
    await clock.advance(0)
    expect(names()).toContain('rae')
    expect(hermes.open.get().shown).toMatchObject({ bot: 'rae' })
  })

  it("refuses with Hermes's reason for the name, and opens nothing", async () => {
    const { clock, hermes, calls, names } = await launched(WITH_BOTS)
    const shown = hermes.open.get()
    const taken = await hermes.run({ do: 'createBot', draft: { ...RAE, name: 'Research' } })
    expect(taken).toEqual({
      ok: false,
      refusal: {
        kind: 'rejected', field: 'name',
        message: "A profile named 'research' already exists. Switch to it with `hermes profile use research`, see all profiles with `hermes profile list`, or choose a different name."
      }
    })
    await clock.advance(0)
    expect(hermes.open.get()).toEqual(shown)
    expect(names()).toHaveLength(6)
    expect(calls('profiles.create')).toHaveLength(1)
  })

  it('is unsupported on a Hermes with no profiles, and on a socket with no interactive grant', async () => {
    const refusal = { kind: 'unsupported', message: "This Hermes can't create bots from Highwing." }
    expect(await (await launched(ERRAND)).hermes.run({ do: 'createBot', draft: RAE })).toEqual({ ok: false, refusal })
    expect(await (await launched(BOUND)).hermes.run({ do: 'createBot', draft: RAE })).toEqual({ ok: false, refusal })
  })

  it('is offline, with nothing sent, while the link is down', async () => {
    const clock = manualClock()
    const hermes = openHermes({ dial: () => Promise.reject(new Error('down')), clock, client: { name: 'highwing-test', version: '0.0.0' } })
    expect(await hermes.run({ do: 'createBot', draft: RAE })).toEqual({ ok: false, refusal: { kind: 'offline', message: "Highwing isn't connected to Hermes right now." } })
  })
})

describe('botModels through the hub', () => {
  it("lists the socket's own profile's models with no session, and a bot's with its profile", async () => {
    const { hermes, calls } = await launched(WITH_MODELS)
    const own = await hermes.run({ do: 'botModels', bot: null })
    expect(own.ok && own.value.options.map(option => `${option.providerName} ${option.id}`)).toEqual(['Acme fast-small', 'Acme careful-large', 'Local local-7b'])
    await hermes.run({ do: 'botModels', bot: 'research' as BotId })
    expect(calls('model.options')).toEqual([
      { method: 'model.options', params: { explicit_only: true } },
      { method: 'model.options', params: { explicit_only: true, profile: 'research' } }
    ])
  })

  it('is refused as unsupported by a Hermes that does not list models', async () => {
    const { hermes } = await launched(WITH_BOTS)
    expect(await hermes.run({ do: 'botModels', bot: null })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes doesn't support that." } })
  })
})

describe('createBot refusals', () => {
  const failing = (error: Error) => ({ call: () => Promise.reject(error), as: () => { throw new Error('not routed') } }) as unknown as Pick<Connection, 'call' | 'as'>
  const refusing = (code: number, message: string) => failing(new RpcRefusal(code, null, message))

  it.each([
    [4061, 'name required', { kind: 'rejected', message: 'name required', field: 'name' }],
    [4062, 'Some reason.', { kind: 'rejected', message: 'Some reason.', field: 'name' }],
    [5062, 'disk full', { kind: 'rejected', message: 'Hermes may not have finished making the bot: disk full' }],
    [-32601, 'unknown method: profiles.create', { kind: 'unsupported', message: "This Hermes can't create bots from Highwing." }],
    [4001, 'invalid_params', { kind: 'rejected', message: 'Hermes refused: invalid_params' }]
  ])('maps code %i', async (code, message, refusal) => {
    expect(await createBot(refusing(code, message), RAE)).toEqual({ ok: false, refusal })
  })

  it('maps a dropped socket to the offline refusal', async () => {
    expect(await createBot(failing(new Offline('gone')), RAE)).toMatchObject({ ok: false, refusal: { kind: 'offline' } })
    expect(await botModels(failing(new Offline('gone')), null)).toMatchObject({ ok: false, refusal: { kind: 'offline' } })
  })
})

describe('parseCreated', () => {
  const reply = (more: object) => ({ ok: true, name: 'Rae', path: '/h/profiles/rae', mirrored: {}, ...more })

  it('names the bot by the last segment of the path, whichever way it is split', () => {
    expect(parseCreated(reply({ path: '/h/profiles/rae/' })).bot).toBe('rae')
    expect(parseCreated(reply({ path: 'C:\\Users\\me\\.hermes\\profiles\\rae' })).bot).toBe('rae')
  })

  it('falls back to the canonical form of the name when the path says nothing', () => {
    expect(parseCreated(reply({ path: '' })).bot).toBe('rae')
    expect(parseCreated(reply({ path: undefined, name: ' RAE ' })).bot).toBe('rae')
  })

  it('keeps only the warnings that hold words', () => {
    expect(parseCreated(reply({ warnings: ['A.', '', '  ', 7, null, ' B. '] })).warnings).toEqual(['A.', 'B.'])
    expect(parseCreated(reply({ warnings: undefined })).warnings).toEqual([])
  })
})
