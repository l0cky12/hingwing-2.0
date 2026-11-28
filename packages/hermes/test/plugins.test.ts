import { describe, expect, it } from 'vitest'
import catalog from '../../../fixtures/plugins/catalog.json' with { type: 'json' }
import plugins from '../../../fixtures/plugins/two.json' with { type: 'json' }
import type { BotId } from '../src/domain/bots'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { noAsk, scriptedDialer, type Fixture, type PluginSeed } from '../src/testing/fixture'
import { parsePluginInstalled, parsePlugins } from '../src/wire/parse'
import { BOUND, callsIn, WITH_BOTS } from './support/errand'

const SEEDS = plugins as readonly PluginSeed[]

async function launched(seeds: readonly PluginSeed[] | null, fixture: Fixture = WITH_BOTS, more: Partial<Fixture['header']> = {}) {
  const clock = manualClock()
  const script = scriptedDialer({ ...fixture, header: { ...fixture.header, ...(seeds === null ? {} : { plugins: seeds }), ...more } }, { clock })
  const hermes = openHermes({ ask: noAsk, dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  const run: typeof hermes.run = async command => {
    const answer = hermes.run(command)
    await clock.advance(5_000)
    return answer
  }
  return { run, calls: () => callsIn(script.received).filter(call => call.method === 'plugins.manage') }
}

describe('plugins', () => {
  it('lists a bot’s plugins, on only when Hermes says enabled', async () => {
    const { run, calls } = await launched(SEEDS)
    expect(await run({ do: 'plugins', bot: 'research' as BotId })).toEqual({
      ok: true, value: [
        { name: 'kanban', key: 'kanban', version: '1.2.0', description: 'A task board the bot and you share.', source: 'bundled', enabled: true, catalogName: null },
        { name: 'browser-tools', key: 'browser-tools', version: '0.4.1', description: 'Gives the bot a Playwright browser.', source: 'user', enabled: false, catalogName: null }
      ]
    })
    expect(calls()).toEqual([expect.objectContaining({ params: { action: 'list', profile: 'research' } })])
  })

  it('asks the launch profile when no bot is named', async () => {
    const { run, calls } = await launched(SEEDS)
    expect(await run({ do: 'plugins', bot: null })).toMatchObject({ ok: true })
    expect(calls()).toEqual([expect.objectContaining({ params: { action: 'list' } })])
  })

  it.each([['a Hermes without the call', null, WITH_BOTS], ['a socket bound to one profile', SEEDS, BOUND]])('says %s can’t list plugins', async (_, seeds, fixture) => {
    const { run } = await launched(seeds, fixture)
    expect(await run({ do: 'plugins', bot: null })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't list its plugins." } })
  })
})

describe('setPlugin', () => {
  it('switches the plugin by its key and answers the list as Hermes reads it after', async () => {
    const { run, calls } = await launched([...SEEDS, { name: 'openai', key: 'image_gen/openai', version: '', description: '', source: 'bundled', status: 'not enabled' }])
    const switched = await run({ do: 'setPlugin', bot: 'research' as BotId, key: 'image_gen/openai', enabled: true })
    expect(switched).toEqual({ ok: true, value: { restart: false, plugins: expect.arrayContaining([expect.objectContaining({ key: 'image_gen/openai', enabled: true })]) } })
    expect(calls().map(call => call.params)).toEqual([{ action: 'toggle', key: 'image_gen/openai', enable: true, profile: 'research' }, { action: 'list', profile: 'research' }])
  })

  it('says when the change waits for Hermes to restart', async () => {
    const { run } = await launched(SEEDS)
    const switched = await run({ do: 'setPlugin', bot: null, key: 'kanban', enabled: false })
    expect(switched.ok && switched.value).toMatchObject({ restart: true, plugins: [{ key: 'kanban', enabled: false }, { key: 'browser-tools', enabled: false }] })
  })

  it('gives Hermes’s words when it refuses', async () => {
    const { run } = await launched(SEEDS)
    expect(await run({ do: 'setPlugin', bot: null, key: 'gone', enabled: true })).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Plugin 'gone' is not installed or bundled." } })
  })


  it.each([
    ['a Hermes without the call', null, WITH_BOTS],
    ['a Hermes that only lists plugins', SEEDS, { ...WITH_BOTS, header: { ...WITH_BOTS.header, listOnly: true } }]
  ])('says %s can’t turn plugins on or off', async (_, seeds, fixture) => {
    const { run } = await launched(seeds, fixture)
    expect(await run({ do: 'setPlugin', bot: null, key: 'kanban', enabled: false })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't turn plugins on or off." } })
  })
})

describe('installing a catalog plugin', () => {
  const RESEARCH = 'research' as BotId
  const withCatalog = (pluginRefusals?: Record<string, string>) => launched(SEEDS, WITH_BOTS, { pluginCatalog: catalog, ...(pluginRefusals === undefined ? {} : { pluginRefusals }) })

  it('asks Hermes for the catalog entry by name in the bot’s profile, and the bot then lists it on', async () => {
    const { run, calls } = await withCatalog()
    expect(await run({ do: 'installPlugin', bot: RESEARCH, name: 'mem0' })).toEqual({
      ok: true, value: { name: 'mem0', enabled: true, restartRequired: false, missingEnv: [], warnings: [] }
    })
    expect(calls()).toEqual([expect.objectContaining({ params: { action: 'install', catalog_name: 'mem0', enable: true, profile: 'research' } })])
    const listed = await run({ do: 'plugins', bot: RESEARCH })
    expect(listed.ok && listed.value.at(-1)).toEqual({ name: 'mem0', key: 'mem0', version: '1.3.0', description: 'Mem0 memory provider with semantic search.', source: 'user', enabled: true, catalogName: 'mem0' })
  })

  it('installs into the bot it names and no other', async () => {
    const { run } = await withCatalog()
    await run({ do: 'installPlugin', bot: RESEARCH, name: 'mem0' })
    const home = await run({ do: 'plugins', bot: null })
    expect(home.ok && home.value.map(plugin => plugin.name)).toEqual(['kanban', 'browser-tools'])
  })

  it('answers Hermes’s words when it refuses the install', async () => {
    const { run } = await withCatalog({ pomodoro: 'Security scan blocked the install: the plugin runs a shell at import.' })
    expect(await run({ do: 'installPlugin', bot: RESEARCH, name: 'pomodoro' })).toEqual({
      ok: false, refusal: { kind: 'rejected', message: 'Security scan blocked the install: the plugin runs a shell at import.' }
    })
    expect(await run({ do: 'installPlugin', bot: RESEARCH, name: 'not-listed' })).toEqual({
      ok: false, refusal: { kind: 'rejected', message: "'not-listed' is not in the Hermes plugin catalog." }
    })
  })

  it.each([['a Hermes without the call', null, WITH_BOTS], ['a socket bound to one profile', SEEDS, BOUND]])('says %s can’t install plugins', async (_, seeds, fixture) => {
    const { run } = await launched(seeds, fixture, { pluginCatalog: catalog })
    expect(await run({ do: 'installPlugin', bot: null, name: 'mem0' })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't install plugins." } })
  })
})

describe('parsePluginInstalled', () => {
  it('reads what Hermes says after an install, and refuses a reply that does not say ok', () => {
    expect(parsePluginInstalled({ ok: true, plugin_name: 'spotify-hermes', enabled: true, restart_required: true, missing_env: ['SPOTIFY_CLIENT_ID', ' '], warnings: ['Known issue: slow first start.'] }, 'spotify')).toEqual({
      ok: true, value: { name: 'spotify-hermes', enabled: true, restartRequired: true, missingEnv: ['SPOTIFY_CLIENT_ID'], warnings: ['Known issue: slow first start.'] }
    })
    expect(parsePluginInstalled({ ok: true }, 'spotify')).toEqual({ ok: true, value: { name: 'spotify', enabled: false, restartRequired: false, missingEnv: [], warnings: [] } })
    expect(parsePluginInstalled({ ok: false, error: 'clone failed' }, 'spotify')).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'clone failed' } })
    expect(parsePluginInstalled({}, 'spotify')).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes didn't install spotify." } })
  })
})

describe('parsePlugins', () => {
  it('reads a disabled plugin as off, drops a row with no name, keys a row by its name when Hermes gives no key, and fills what a row leaves out', () => {
    expect(parsePlugins({
      plugins: [
        { name: 'a', key: 'a', version: '', description: '', source: 'user', status: 'disabled', portable: false, install_dir: '', has_desktop_half: false, servers: [] },
        { name: ' ', key: 'b', version: '1', description: 'x', source: 'user', status: 'enabled', portable: false, install_dir: '', has_desktop_half: false, servers: [] },
        { name: 'c', status: 'enabled', catalog_name: ' hermes-c ' } as never
      ]
    })).toEqual([
      { name: 'a', key: 'a', version: '', description: '', source: 'user', enabled: false, catalogName: null },
      { name: 'c', key: 'c', version: '', description: '', source: '', enabled: true, catalogName: 'hermes-c' }
    ])
    expect(parsePlugins({})).toEqual([])
  })
})
