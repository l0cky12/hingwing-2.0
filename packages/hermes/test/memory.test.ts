import { describe, expect, it } from 'vitest'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { noAsk, scriptedDialer, type Fixture, type MemoryScript } from '../src/testing/fixture'
import { BOUND, callsIn, WITH_BOTS } from './support/errand'

const HOME: MemoryScript = {
  entries: [
    { file: 'MEMORY.md', text: 'Prefers short answers.' },
    { file: 'USER.md', text: 'Lives in Lisbon.' }
  ],
  limits: { memory: 30 }
}

const CANT = { ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't edit memory yet." } }

async function launched(more: Partial<Fixture['header']>, fixture: Fixture = WITH_BOTS) {
  const clock = manualClock()
  const script = scriptedDialer({ ...fixture, header: { ...fixture.header, ...more } }, { clock })
  const hermes = openHermes({ ask: noAsk, dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  const run: typeof hermes.run = async command => {
    const answer = hermes.run(command)
    await clock.advance(5_000)
    return answer
  }
  return { run, calls: (method: string) => callsIn(script.received).filter(call => call.method === method) }
}

const listed = async (run: Awaited<ReturnType<typeof launched>>['run']) => {
  const outcome = await run({ do: 'memory' })
  if (!outcome.ok) throw new Error(outcome.refusal.message)
  return outcome.value
}

describe('memory through the hub', () => {
  it('lists MEMORY.md and then USER.md, and sends no profile', async () => {
    const { run, calls } = await launched({ memory: HOME })
    const entries = await listed(run)
    expect(entries.map(entry => ({ file: entry.file, text: entry.text }))).toEqual([
      { file: 'MEMORY.md', text: 'Prefers short answers.' },
      { file: 'USER.md', text: 'Lives in Lisbon.' }
    ])
    expect(calls('learning.frames').map(call => call.params)).toEqual([{}])
    expect(calls('learning.detail').map(call => call.params)).toEqual(entries.map(entry => ({ id: entry.id })))
    for (const call of [...calls('learning.frames'), ...calls('learning.detail')]) expect(call.params).not.toHaveProperty('profile')
  })

  it("refuses a save past the cap, and an empty one, in Hermes's words, and keeps the entry", async () => {
    const { run, calls } = await launched({ memory: { entries: [{ file: 'MEMORY.md', text: 'Hello' }], limits: { memory: 1000 } } })
    const [entry] = await listed(run)
    const over = 'x'.repeat(1001)
    expect(await run({ do: 'saveMemory', id: entry!.id, text: over })).toEqual({
      ok: false, refusal: { kind: 'rejected', message: 'Replacement would put memory at 1,001/1,000 chars. Shorten the new content.' }
    })
    expect(await run({ do: 'saveMemory', id: entry!.id, text: '   ' })).toEqual({
      ok: false, refusal: { kind: 'rejected', message: 'empty memory — use delete to remove it' }
    })
    expect(await run({ do: 'saveMemory', id: 'nope', text: 'Hello' })).toEqual({
      ok: false, refusal: { kind: 'rejected', message: "bad memory node id: 'nope'" }
    })
    expect((await listed(run)).map(held => held.text)).toEqual(['Hello'])
    expect(calls('learning.edit').map(call => call.params)).toEqual([
      { id: entry!.id, content: over },
      { id: entry!.id, content: '   ' },
      { id: 'nope', content: 'Hello' }
    ])
    expect(calls('learning.edit').every(call => !Object.hasOwn(call.params ?? {}, 'profile'))).toBe(true)
  })

  it('replaces an entry, then refuses the id from before the save', async () => {
    const { run } = await launched({ memory: HOME })
    const before = await listed(run)
    const user = before.find(entry => entry.file === 'USER.md')!
    expect(await run({ do: 'saveMemory', id: user.id, text: 'Lives in Porto.' })).toEqual({ ok: true, value: undefined })
    const after = await listed(run)
    expect(after.map(entry => entry.text)).toEqual(['Prefers short answers.', 'Lives in Porto.'])
    expect(after.find(entry => entry.file === 'USER.md')!.id).not.toBe(user.id)
    expect(await run({ do: 'saveMemory', id: user.id, text: 'Lives in Porto.' })).toEqual({
      ok: false, refusal: { kind: 'rejected', message: 'memory node id is stale — refresh the graph' }
    })
  })

  it('removes an entry that is already over the cap, which is how a file gets back under it', async () => {
    const { run, calls } = await launched({ memory: { entries: [{ file: 'MEMORY.md', text: 'x'.repeat(40) }], limits: { memory: 10 } } })
    const [entry] = await listed(run)
    expect(await run({ do: 'removeMemory', id: entry!.id })).toEqual({ ok: true, value: undefined })
    expect(await listed(run)).toEqual([])
    expect(calls('learning.delete').map(call => call.params)).toEqual([{ id: entry!.id }])
    expect(calls('learning.delete')[0]?.params).not.toHaveProperty('profile')
  })

  it('says this Hermes cannot edit memory when the calls are missing, or the socket cannot reach them', async () => {
    const missing = await launched({})
    expect(await missing.run({ do: 'memory' })).toEqual(CANT)
    expect(await missing.run({ do: 'saveMemory', id: 'memory:memory:0:abc', text: 'Hello' })).toEqual(CANT)
    expect(await missing.run({ do: 'removeMemory', id: 'memory:memory:0:abc' })).toEqual(CANT)
    const bound = await launched({ memory: HOME }, BOUND)
    expect(await bound.run({ do: 'memory' })).toEqual(CANT)
  })
})
