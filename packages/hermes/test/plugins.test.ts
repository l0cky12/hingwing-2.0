import { describe, expect, it } from 'vitest'
import plugins from '../../../fixtures/plugins/two.json' with { type: 'json' }
import type { BotId } from '../src/domain/bots'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { scriptedDialer, type Fixture, type PluginSeed } from '../src/testing/fixture'
import { parsePlugins } from '../src/wire/parse'
import { BOUND, callsIn, WITH_BOTS } from './support/errand'

const SEEDS = plugins as readonly PluginSeed[]

async function launched(seeds: readonly PluginSeed[] | null, fixture: Fixture = WITH_BOTS) {
  const clock = manualClock()
  const script = scriptedDialer({ ...fixture, header: { ...fixture.header, ...(seeds === null ? {} : { plugins: seeds }) } }, { clock })
  const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
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
        { name: 'kanban', key: 'kanban', version: '1.2.0', description: 'A task board the bot and you share.', source: 'bundled', enabled: true },
        { name: 'browser-tools', key: 'browser-tools', version: '0.4.1', description: 'Gives the bot a Playwright browser.', source: 'user', enabled: false }
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

describe('parsePlugins', () => {
  it('reads a disabled plugin as off, drops a row with no name, keys a row by its name when Hermes gives no key, and fills what a row leaves out', () => {
    expect(parsePlugins({
      plugins: [
        { name: 'a', key: 'a', version: '', description: '', source: 'user', status: 'disabled', portable: false, install_dir: '', has_desktop_half: false, servers: [] },
        { name: ' ', key: 'b', version: '1', description: 'x', source: 'user', status: 'enabled', portable: false, install_dir: '', has_desktop_half: false, servers: [] },
        { name: 'c', status: 'enabled' } as never
      ]
    })).toEqual([
      { name: 'a', key: 'a', version: '', description: '', source: 'user', enabled: false },
      { name: 'c', key: 'c', version: '', description: '', source: '', enabled: true }
    ])
    expect(parsePlugins({})).toEqual([])
  })
})
