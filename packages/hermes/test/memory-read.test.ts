import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import { botMemoryOf, memoryCapsPath, memoryEntryPath, memoryGraphPath, NO_MEMORY_CAPS, parseMemoryCaps, parseMemoryEntry, parseMemoryGraph } from '../src/domain/memory'
import type { MemoryScript } from '../src/testing/fixture'
import { fixtureRead } from '../src/testing/kanban'

const RAE = 'rae' as BotId
const BOTS = JSON.parse(readFileSync(fileURLToPath(new URL('../../../fixtures/memory/bots.json', import.meta.url)), 'utf8')) as MemoryScript

describe('the memory read paths', () => {
  it('name the profile, encoded', () => {
    expect(memoryGraphPath(RAE)).toBe('/api/learning/graph?profile=rae')
    expect(memoryCapsPath('a b' as BotId)).toBe('/api/config?profile=a%20b')
    expect(memoryEntryPath(RAE, 'memory:memory:0:abc')).toBe('/api/learning/node?id=memory%3Amemory%3A0%3Aabc&profile=rae')
  })
})

describe('parseMemoryGraph', () => {
  const graph = {
    memory: [
      { source: 'memory', timestamp: 1, title: 'a', body: 'one', fingerprint: 'f1' },
      { source: 'profile', timestamp: 2, title: 'b', body: 'two', fingerprint: 'f2' }
    ],
    nodes: [
      { id: 'skill:x', kind: 'skill', label: 'x' },
      { id: 'n1', kind: 'memory', memorySource: 'memory', label: 'a' },
      { id: 'n2', kind: 'memory', memorySource: 'profile', label: 'b' }
    ]
  }

  it('pairs each card with the memory node of the same position, past the skill nodes', () => {
    expect(parseMemoryGraph(graph)).toEqual([
      { file: 'MEMORY.md', text: 'one', fingerprint: 'f1', node: 'n1' },
      { file: 'USER.md', text: 'two', fingerprint: 'f2', node: 'n2' }
    ])
  })

  it('reads a graph with no memory as no cards', () => {
    expect(parseMemoryGraph({ memory: [], nodes: [{ id: 's', kind: 'skill' }] })).toEqual([])
  })

  it.each([
    ['not an object', 'x'],
    ['no memory array', { nodes: [] }],
    ['no nodes array', { memory: [] }],
    ['fewer nodes than cards', { ...graph, nodes: graph.nodes.slice(0, 2) }],
    ['nodes of the wrong file', { ...graph, nodes: [graph.nodes[0], { ...graph.nodes[1], memorySource: 'profile' }, graph.nodes[2]] }],
    ['a node with no id', { ...graph, nodes: [graph.nodes[0], { ...graph.nodes[1], id: '' }, graph.nodes[2]] }],
    ['a card of an unknown source', { ...graph, memory: [{ ...graph.memory[0], source: 'notes' }, graph.memory[1]] }],
    ['a card with no body', { ...graph, memory: [{ source: 'memory', fingerprint: 'f1' }, graph.memory[1]] }],
    ['a card with no fingerprint', { ...graph, memory: [{ source: 'memory', body: 'one' }, graph.memory[1]] }]
  ])('refuses %s', (_, raw) => {
    expect(parseMemoryGraph(raw)).toBeNull()
  })
})

describe('parseMemoryCaps', () => {
  it('reads each file its own cap', () => {
    expect(parseMemoryCaps({ memory: { memory_char_limit: 2200, user_char_limit: 1375 } })).toEqual({ 'MEMORY.md': 2200, 'USER.md': 1375 })
  })

  it('leaves a file with no positive whole number without a cap', () => {
    expect(parseMemoryCaps({ memory: { memory_char_limit: 0, user_char_limit: '1375' } })).toEqual(NO_MEMORY_CAPS)
    expect(parseMemoryCaps({ memory: { memory_char_limit: 1.5 } })).toEqual(NO_MEMORY_CAPS)
    expect(parseMemoryCaps({})).toEqual(NO_MEMORY_CAPS)
  })

  it('refuses a reply that is not an object', () => {
    expect(parseMemoryCaps(null)).toBeNull()
    expect(parseMemoryCaps([])).toBeNull()
  })
})

describe('parseMemoryEntry', () => {
  it('reads the full text of a memory entry', () => {
    expect(parseMemoryEntry({ ok: true, kind: 'memory', id: 'n1', label: 'a', content: 'the whole\nentry' })).toBe('the whole\nentry')
  })

  it.each([[{ ok: false, message: 'stale' }], [{ ok: true, kind: 'skill', content: 'x' }], [{ ok: true, kind: 'memory' }], [null]])('refuses %j', raw => {
    expect(parseMemoryEntry(raw)).toBeNull()
  })
})

describe('botMemoryOf', () => {
  it('counts each file as Hermes sizes it, its entries joined by its separator', () => {
    const memory = botMemoryOf([{ file: 'MEMORY.md', text: 'abc' }, { file: 'MEMORY.md', text: 'de' }, { file: 'USER.md', text: 'x' }], { 'MEMORY.md': 2200, 'USER.md': null })
    expect(memory.files).toEqual([
      { name: 'MEMORY.md', entries: ['abc', 'de'], used: 'abc\n§\nde'.length, cap: 2200 },
      { name: 'USER.md', entries: ['x'], used: 1, cap: null }
    ])
  })

  it('counts code points, not UTF-16 units', () => {
    const [memory] = botMemoryOf([{ file: 'MEMORY.md', text: 'été 🙂' }], NO_MEMORY_CAPS).files
    expect(memory.used).toBe(5)
  })

  it('holds both files, empty when Hermes has no entries for one', () => {
    expect(botMemoryOf([], NO_MEMORY_CAPS).files).toEqual([
      { name: 'MEMORY.md', entries: [], used: 0, cap: null },
      { name: 'USER.md', entries: [], used: 0, cap: null }
    ])
  })
})

describe("the fixture's memory routes", () => {
  const read = fixtureRead({ memory: BOTS })

  it('answer 404 on every memory route when the fixture has no memory, as an older Hermes does', async () => {
    const none = fixtureRead({})
    for (const path of [memoryGraphPath(RAE), memoryCapsPath(RAE), memoryEntryPath(RAE, 'x')]) expect(await none(path)).toMatchObject({ status: 404 })
  })

  it("answer a profile's graph in the shape the parser reads, with a long entry cut", async () => {
    const answer = await read(memoryGraphPath(RAE))
    expect(answer.status).toBe(200)
    const cards = parseMemoryGraph(answer.body)
    expect(cards?.map(card => card.file)).toEqual(['MEMORY.md', 'MEMORY.md', 'MEMORY.md', 'USER.md'])
    const long = BOTS.profiles!.rae!.entries[0]!.text
    expect(long.length).toBeGreaterThan(1200)
    expect(cards![0]!.text).toBe(long.slice(0, 1200))
    expect(cards![1]!.text).toBe(BOTS.profiles!.rae!.entries[1]!.text)
  })

  it('answer a cut entry in full through its node, and a stale node as a 404', async () => {
    const cards = parseMemoryGraph((await read(memoryGraphPath(RAE))).body)!
    const full = await read(memoryEntryPath(RAE, cards[0]!.node))
    expect(parseMemoryEntry(full.body)).toBe(BOTS.profiles!.rae!.entries[0]!.text)
    expect(await read(memoryEntryPath(RAE, 'memory:memory:9:nope'))).toMatchObject({ status: 404 })
  })

  it('answer the launch profile from the top level, and a profile not listed with no entries under the top level limits', async () => {
    expect(parseMemoryGraph((await read(memoryGraphPath('default' as BotId))).body)?.map(card => card.text)).toEqual(['Prefers short answers.', 'Lives in Lisbon.'])
    expect(parseMemoryGraph((await read(memoryGraphPath('zed' as BotId))).body)).toEqual([])
    expect(parseMemoryCaps((await read(memoryCapsPath('zed' as BotId))).body)).toEqual({ 'MEMORY.md': 2200, 'USER.md': 1375 })
  })

  it("answer a profile's own limits, which leave its MEMORY.md past nine tenths of its cap", async () => {
    const caps = parseMemoryCaps((await read(memoryCapsPath(RAE))).body)!
    expect(caps['MEMORY.md']).toBe(1500)
    const cards = parseMemoryGraph((await read(memoryGraphPath(RAE))).body)!
    const full = await Promise.all(cards.map(async card => ({ file: card.file, text: parseMemoryEntry((await read(memoryEntryPath(RAE, card.node))).body)! })))
    const [memory] = botMemoryOf(full, caps).files
    expect(memory.used / memory.cap!).toBeGreaterThanOrEqual(0.9)
  })
})
