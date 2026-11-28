import { describe, expect, it } from 'vitest'
import catalog from '../../../fixtures/plugins/catalog.json' with { type: 'json' }
import { CATALOG_URL, fixtureCatalogDeps, KEEP_MS, pluginCatalog, type CatalogDeps } from '../src/main/plugin-catalog'

const ROWS = [{ name: 'mem0', tier: 'community', description: 'Memory.', stars: 3 }]
const NOT_LOADED = { ok: false, refusal: { kind: 'rejected', message: "Highwing couldn't load Hermes's plugin catalog." } }

function rig(answers: (() => Promise<Response>)[]) {
  let at = 0
  const asked: string[] = []
  const deps: CatalogDeps = {
    fetchWeb: async url => {
      asked.push(url)
      return answers.shift()!()
    },
    now: () => at,
    timeoutMs: 1000
  }
  return { catalog: pluginCatalog(deps), asked, later: (ms: number) => void (at += ms) }
}
const json = (body: unknown) => async () => new Response(JSON.stringify(body))

describe('the plugin catalog main reads', () => {
  it('reads Hermes desktop’s public snapshot and answers its rows', async () => {
    const { catalog: read, asked } = rig([json(ROWS)])
    expect(await read.read()).toMatchObject({ ok: true, value: [{ name: 'mem0', tier: 'community', description: 'Memory.', stars: 3 }] })
    expect(asked).toEqual([CATALOG_URL])
  })

  it('shares one read between windows that ask at once, and keeps it for 30 minutes', async () => {
    const { catalog: read, asked, later } = rig([json(ROWS), json([...ROWS, { name: 'spotify', tier: 'official' }])])
    const [first, second] = await Promise.all([read.read(), read.read()])
    expect(second).toEqual(first)
    later(KEEP_MS - 1)
    expect(await read.read()).toEqual(first)
    expect(asked).toHaveLength(1)
    later(1)
    expect(await read.read()).toMatchObject({ ok: true, value: [{ name: 'mem0' }, { name: 'spotify' }] })
    expect(asked).toHaveLength(2)
  })

  it.each([
    ['a failed status', async () => new Response('gone', { status: 503 })],
    ['a reply that is not a list', json({ plugins: [] })],
    ['a body that is not JSON', async () => new Response('<html>')],
    ['no network', async () => Promise.reject(new TypeError('net::ERR_INTERNET_DISCONNECTED'))]
  ])('refuses %s, keeps nothing, and reads again on the next ask', async (_, failed) => {
    const { catalog: read, asked } = rig([failed, json(ROWS)])
    expect(await read.read()).toEqual(NOT_LOADED)
    expect(await read.read()).toMatchObject({ ok: true, value: [{ name: 'mem0' }] })
    expect(asked).toHaveLength(2)
  })

  it('gives up on a read that hangs past its wait', async () => {
    const deps: CatalogDeps = {
      fetchWeb: (_, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
      now: () => 0,
      timeoutMs: 5
    }
    expect(await pluginCatalog(deps).read()).toEqual(NOT_LOADED)
  })

  it('answers a fixture run from the header, and fails when the header has none', async () => {
    const read = await pluginCatalog(fixtureCatalogDeps(catalog)).read()
    expect(read.ok && read.value.map(plugin => plugin.name)).toEqual(['hermes-achievements', 'spotify', 'browser-tools', 'linear-sync', 'apple-notes', 'mem0', 'weather-now', 'pomodoro'])
    expect(await pluginCatalog(fixtureCatalogDeps(undefined)).read()).toEqual(NOT_LOADED)
  })
})
