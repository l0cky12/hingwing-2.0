import { describe, expect, it } from 'vitest'
import backups from '../../../fixtures/models/backups.json' with { type: 'json' }
import three from '../../../fixtures/models/three.json' with { type: 'json' }
import type { BotId } from '../src/domain/bots'
import type { ModelOption } from '../src/domain/session'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { noAsk, scriptedDialer, type Fixture } from '../src/testing/fixture'
import { parseBackupChain, parseCliFailure, parseConfigValue } from '../src/wire/parse'
import { BOUND, callsIn, WITH_BOTS } from './support/errand'

const option = (id: string, provider: string, providerName: string): ModelOption => ({ id: id as ModelOption['id'], provider, providerName })
const FAST = option('fast-small', 'acme', 'Acme')
const CAREFUL = option('careful-large', 'acme', 'Acme')
const LOCAL = option('local-7b', 'local', 'Local')
const ref = ({ id, provider }: ModelOption) => ({ id, provider })

const EGGBOT = 'dr-eggbot' as BotId
const RESEARCH = 'research' as BotId
const TIMOTHY = 'timothy' as BotId

const withBackups = (held: Fixture['header']['backups']): Fixture =>
  ({ ...WITH_BOTS, header: { ...WITH_BOTS.header, models: three, guarded: ['careful-large'], ...(held === undefined ? {} : { backups: held }) } })
const MODELS = withBackups(backups)

async function launched(fixture: Fixture) {
  const clock = manualClock()
  const script = scriptedDialer(fixture, { clock })
  const hermes = openHermes({ ask: noAsk, dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  const calls = (method: string) => callsIn(script.received).filter(call => call.method === method)
  const argvs = () => calls('cli.exec').map(call => (call.params as { argv: string[] }).argv)
  return { hermes, calls, argvs }
}

describe('botModelSettings', () => {
  it("answers the bot's default, its models and the first of its backups", async () => {
    const { hermes } = await launched(MODELS)
    expect(await hermes.run({ do: 'botModelSettings', bot: EGGBOT })).toEqual({
      ok: true, value: { options: [FAST, CAREFUL, LOCAL], main: ref(FAST), backup: { state: 'set', model: ref(LOCAL), more: 0 } }
    })
    expect(await hermes.run({ do: 'botModelSettings', bot: TIMOTHY })).toMatchObject({ ok: true, value: { backup: { state: 'none' } } })
  })

  it('counts the legacy fallback_model after fallback_providers, as Hermes tries it', async () => {
    const { hermes } = await launched(MODELS)
    expect(await hermes.run({ do: 'botModelSettings', bot: RESEARCH })).toMatchObject({ ok: true, value: { backup: { state: 'set', model: ref(CAREFUL), more: 1 } } })
  })

  it('names the bot first in every hermes command, and routes each call to it', async () => {
    const { hermes, calls, argvs } = await launched(MODELS)
    await hermes.run({ do: 'botModelSettings', bot: RESEARCH })
    expect(argvs()).toEqual([['-p', 'research', 'config', 'get', 'fallback_providers', '--json'], ['-p', 'research', 'config', 'get', 'fallback_model', '--json']])
    expect([...calls('cli.exec'), ...calls('model.options')].map(call => (call.params as { profile?: string }).profile)).toEqual(['research', 'research', 'research'])
  })

  it('still answers the default and the models when this Hermes cannot say the backup', async () => {
    const { hermes } = await launched(withBackups(undefined))
    expect(await hermes.run({ do: 'botModelSettings', bot: EGGBOT })).toEqual({
      ok: true, value: { options: [FAST, CAREFUL, LOCAL], main: ref(FAST), backup: { state: 'unknown', words: "This Hermes can't change backup models from Highwing." } }
    })
  })
})

describe('setBotModel', () => {
  it('pins the model, and the bot reads it back as its default', async () => {
    const { hermes, calls } = await launched(MODELS)
    expect(await hermes.run({ do: 'setBotModel', bot: EGGBOT, model: LOCAL })).toEqual({ ok: true, value: { saved: true } })
    expect(calls('profiles.configure')).toEqual([{ method: 'profiles.configure', params: { name: 'dr-eggbot', model: 'local-7b', provider: 'local' } }])
    expect(await hermes.run({ do: 'botModelSettings', bot: EGGBOT })).toMatchObject({ ok: true, value: { main: ref(LOCAL) } })
    expect(await hermes.run({ do: 'botModelSettings', bot: TIMOTHY })).toMatchObject({ ok: true, value: { main: ref(FAST) } })
  })

  it('saves nothing for a costly model until it is sent again with confirm', async () => {
    const { hermes, calls } = await launched(MODELS)
    expect(await hermes.run({ do: 'setBotModel', bot: EGGBOT, model: CAREFUL })).toEqual({ ok: true, value: { saved: false, confirm: 'careful-large costs more per message.' } })
    expect(await hermes.run({ do: 'botModelSettings', bot: EGGBOT })).toMatchObject({ ok: true, value: { main: ref(FAST) } })
    expect(await hermes.run({ do: 'setBotModel', bot: EGGBOT, model: CAREFUL, confirm: true })).toEqual({ ok: true, value: { saved: true } })
    expect(calls('profiles.configure').at(-1)?.params).toEqual({ name: 'dr-eggbot', model: 'careful-large', provider: 'acme', confirm_expensive_model: true })
    expect(await hermes.run({ do: 'botModelSettings', bot: EGGBOT })).toMatchObject({ ok: true, value: { main: ref(CAREFUL) } })
  })

  it('is refused as unsupported by a socket bound to one profile', async () => {
    const { hermes } = await launched({ ...BOUND, header: { ...BOUND.header, models: three } })
    expect(await hermes.run({ do: 'setBotModel', bot: EGGBOT, model: LOCAL })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't edit bots from Highwing." } })
  })
})

describe('setBotBackup', () => {
  it('puts the pick first, keeps the backups after the old first one, and moves a legacy fallback_model into the list', async () => {
    const { hermes, argvs } = await launched(MODELS)
    expect(await hermes.run({ do: 'setBotBackup', bot: RESEARCH, model: LOCAL })).toEqual({ ok: true, value: undefined })
    expect(argvs().slice(2)).toEqual([
      ['-p', 'research', 'config', 'set', '--force', 'fallback_providers', JSON.stringify([{ provider: 'local', model: 'local-7b' }, { provider: 'acme', model: 'fast-small' }])],
      ['-p', 'research', 'config', 'unset', 'fallback_model']
    ])
    expect(await hermes.run({ do: 'botModelSettings', bot: RESEARCH })).toMatchObject({ ok: true, value: { backup: { state: 'set', model: ref(LOCAL), more: 1 } } })
  })

  it('moves a model the list already holds to the front with the fields Highwing does not show', async () => {
    const held = { provider: 'local', model: 'local-7b', base_url: 'http://gpu-box:8080/v1' }
    const { hermes, argvs } = await launched(withBackups({ timothy: { fallback_providers: [{ provider: 'acme', model: 'fast-small' }, held] } }))
    await hermes.run({ do: 'setBotBackup', bot: TIMOTHY, model: LOCAL })
    expect(argvs().at(-1)).toEqual(['-p', 'timothy', 'config', 'set', '--force', 'fallback_providers', JSON.stringify([held])])
  })

  it('keeps a later backup on another endpoint of the same model', async () => {
    const first = { provider: 'local', model: 'local-7b', base_url: 'http://gpu-a:8080/v1' }
    const second = { provider: 'local', model: 'local-7b', base_url: 'http://gpu-b:8080/v1' }
    const { hermes, argvs } = await launched(withBackups({ timothy: { fallback_providers: [{ provider: 'acme', model: 'fast-small' }, first, second] } }))
    await hermes.run({ do: 'setBotBackup', bot: TIMOTHY, model: LOCAL })
    expect(argvs().at(-1)).toEqual(['-p', 'timothy', 'config', 'set', '--force', 'fallback_providers', JSON.stringify([first, second])])
  })

  it('replaces a fallback_providers Hermes holds as one mapping', async () => {
    const { hermes } = await launched(withBackups({ timothy: { fallback_providers: { provider: 'acme', model: 'fast-small' } } }))
    expect(await hermes.run({ do: 'setBotBackup', bot: TIMOTHY, model: LOCAL })).toEqual({ ok: true, value: undefined })
    expect(await hermes.run({ do: 'botModelSettings', bot: TIMOTHY })).toMatchObject({ ok: true, value: { backup: { state: 'set', model: ref(LOCAL), more: 0 } } })
  })

  it('writes an empty list for No backup, and unsets fallback_model only when the config holds one', async () => {
    const { hermes, argvs } = await launched(MODELS)
    await hermes.run({ do: 'setBotBackup', bot: EGGBOT, model: null })
    expect(argvs().slice(2)).toEqual([['-p', 'dr-eggbot', 'config', 'set', '--force', 'fallback_providers', '[]']])
    await hermes.run({ do: 'setBotBackup', bot: RESEARCH, model: null })
    expect(argvs().slice(5)).toEqual([['-p', 'research', 'config', 'set', '--force', 'fallback_providers', '[]'], ['-p', 'research', 'config', 'unset', 'fallback_model']])
    expect(await hermes.run({ do: 'botModelSettings', bot: RESEARCH })).toMatchObject({ ok: true, value: { backup: { state: 'none' } } })
  })

  it('writes nothing when a backup it would keep holds its own key, which Hermes shows only masked', async () => {
    const keyed = { provider: 'acme', model: 'fast-small', api_key: 'sk-l...7890' }
    const { hermes, argvs } = await launched(withBackups({ timothy: { fallback_providers: [{ provider: 'local', model: 'local-7b' }, keyed] } }))
    expect(await hermes.run({ do: 'setBotBackup', bot: TIMOTHY, model: CAREFUL })).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(argvs().every(argv => argv[3] === 'get')).toBe(true)
  })

  it('keeps an entry whose key is read from the environment', async () => {
    const keyed = { provider: 'acme', model: 'fast-small', api_key: '${ACME_KEY}' }
    const { hermes } = await launched(withBackups({ timothy: { fallback_providers: [{ provider: 'local', model: 'local-7b' }, keyed] } }))
    expect(await hermes.run({ do: 'setBotBackup', bot: TIMOTHY, model: CAREFUL })).toEqual({ ok: true, value: undefined })
  })

  it('is refused as unsupported by a Hermes without cli.exec', async () => {
    const { hermes } = await launched(withBackups(undefined))
    expect(await hermes.run({ do: 'setBotBackup', bot: EGGBOT, model: LOCAL })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't change backup models from Highwing." } })
  })
})

describe('reading what a hermes command printed', () => {
  it("reads the JSON line past a notice Hermes printed on stderr, and an unset key as absent", () => {
    expect(parseConfigValue({ blocked: false, code: 0, output: '[{"provider": "acme", "model": "x"}]\n⚠ a notice' })).toEqual({ is: 'value', value: [{ provider: 'acme', model: 'x' }] })
    expect(parseConfigValue({ blocked: false, code: 1, output: 'Config key not set: fallback_model' })).toEqual({ is: 'absent' })
    expect(parseConfigValue({ blocked: false, code: 1, output: 'A newer Hermes is available.\nConfig key not set: fallback_model' })).toEqual({ is: 'absent' })
    expect(parseConfigValue({ blocked: false, code: 0, output: 'not json' })).toEqual({ is: 'failed', words: 'not json' })
  })

  it('says why a command failed in the first line it printed, or the hint of a blocked one', () => {
    expect(parseCliFailure({ blocked: false, code: 0, output: '✓ Set' })).toBeNull()
    expect(parseCliFailure({ blocked: false, code: 1, output: "\nCannot set 'fallback_providers': it is managed by your administrator\nmore" }))
      .toBe("Cannot set 'fallback_providers': it is managed by your administrator")
    expect(parseCliFailure({ blocked: true, code: -1, output: '', hint: 'run it in a terminal' })).toBe('run it in a terminal')
  })

  it('keeps only entries naming a provider and a model, and drops one repeating an earlier route', () => {
    const chain = parseBackupChain([{ provider: ' acme ', model: 'Fast' }, { provider: 'acme' }, 'local-7b', null], [{ provider: 'acme', model: 'fast' }, { provider: 'local', model: 'local-7b' }])
    expect(chain.map(({ provider, model }) => `${provider}/${model}`)).toEqual(['acme/Fast', 'local/local-7b'])
  })
})
