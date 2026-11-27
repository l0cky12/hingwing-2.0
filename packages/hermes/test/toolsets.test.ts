import { describe, expect, it } from 'vitest'
import toolsets from '../../../fixtures/tools/three.json' with { type: 'json' }
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { scriptedDialer, type Fixture, type ToolsetSeed } from '../src/testing/fixture'
import { parseToolsets } from '../src/wire/parse'
import { BOUND, callsIn, SESSION, WITH_BOTS } from './support/errand'

const SEEDS = toolsets as readonly ToolsetSeed[]

async function launched(seeds: readonly ToolsetSeed[] | null, fixture: Fixture = WITH_BOTS) {
  const clock = manualClock()
  const script = scriptedDialer({ ...fixture, header: { ...fixture.header, ...(seeds === null ? {} : { tools: seeds }) } }, { clock })
  const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  const run: typeof hermes.run = async command => {
    const answer = hermes.run(command)
    await clock.advance(5_000)
    return answer
  }
  return { run, calls: () => callsIn(script.received).filter(call => call.method === 'tools.list') }
}

describe('toolsets', () => {
  it('lists each toolset with its tools, on or off for the chat named', async () => {
    const { run, calls } = await launched(SEEDS)
    const listed = await run({ do: 'tools', sessionId: SESSION })
    expect(listed.ok && listed.value.map(({ name, toolCount, enabled }) => ({ name, toolCount, enabled }))).toEqual([
      { name: 'browser', toolCount: 9, enabled: true },
      { name: 'file', toolCount: 4, enabled: true },
      { name: 'image_gen', toolCount: 1, enabled: false }
    ])
    expect(listed.ok && listed.value[1]).toEqual({ name: 'file', description: 'Read, write, search and patch files.', tools: ['read_file', 'write_file', 'patch', 'search_files'], toolCount: 4, enabled: true })
    expect(calls()).toEqual([expect.objectContaining({ params: { session_id: SESSION } })])
  })

  it('names no chat when none is open, so Hermes reads the launch profile', async () => {
    const { run, calls } = await launched(SEEDS)
    expect(await run({ do: 'tools', sessionId: null })).toMatchObject({ ok: true })
    expect(calls()).toEqual([expect.objectContaining({ params: {} })])
  })

  it.each([['a Hermes without the call', null, WITH_BOTS], ['a socket bound to one profile', SEEDS, BOUND]])('says %s can’t list tools', async (_, seeds, fixture) => {
    const { run } = await launched(seeds, fixture)
    expect(await run({ do: 'tools', sessionId: null })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't list its tools." } })
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
      { name: 'web', description: 'Search.', tools: ['web_search'], toolCount: 3, enabled: true },
      { name: 'code', description: '', tools: [], toolCount: 0, enabled: false }
    ])
    expect(parseToolsets({} as never)).toEqual([])
  })
})
