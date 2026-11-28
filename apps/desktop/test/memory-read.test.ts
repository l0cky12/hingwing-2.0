import { createHash } from 'node:crypto'
import type { HttpAnswer, ReadHermes } from '@highwing/hermes'
import type { BotId } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { readBotMemory } from '../src/main/memory'

const RAE = 'rae' as BotId
const fingerprint = (text: string) => createHash('sha256').update(text.trim(), 'utf8').digest('hex').slice(0, 12)

const LONG = `${'x'.repeat(1200)}tail`
const SHORT = 'Keeps the budget in the shared drive.'
const PROFILE = 'Likes plain words.'
const GRAPH = {
  memory: [
    { source: 'memory', timestamp: 1, title: 'long', body: LONG.slice(0, 1200), fingerprint: fingerprint(LONG) },
    { source: 'memory', timestamp: 2, title: 'short', body: SHORT, fingerprint: fingerprint(SHORT) },
    { source: 'profile', timestamp: 3, title: 'plain', body: PROFILE, fingerprint: fingerprint(PROFILE) }
  ],
  nodes: [
    { id: 'skill:a', kind: 'skill', label: 'a' },
    { id: 'n:long', kind: 'memory', memorySource: 'memory', label: 'long' },
    { id: 'n:short', kind: 'memory', memorySource: 'memory', label: 'short' },
    { id: 'n:plain', kind: 'memory', memorySource: 'profile', label: 'plain' }
  ]
}
const CONFIG = { memory: { memory_char_limit: 2200, user_char_limit: 1375 } }
const GRAPH_PATH = '/api/learning/graph?profile=rae'
const CONFIG_PATH = '/api/config?profile=rae'
const LONG_PATH = '/api/learning/node?id=n%3Along&profile=rae'

type Replies = { readonly [path: string]: HttpAnswer | Error }
const OK: Replies = {
  [GRAPH_PATH]: { status: 200, body: GRAPH },
  [CONFIG_PATH]: { status: 200, body: CONFIG },
  [LONG_PATH]: { status: 200, body: { ok: true, kind: 'memory', id: 'n:long', label: 'long', content: LONG } }
}

function reading(replies: Replies) {
  const asked: string[] = []
  const read: ReadHermes = async path => {
    asked.push(path)
    const reply = replies[path] ?? { status: 404, body: null }
    if (reply instanceof Error) throw reply
    return reply
  }
  return { read, asked }
}

const REFUSALS = {
  none: { kind: 'unsupported', message: "This Hermes can't show memory yet." },
  unreached: { kind: 'offline', message: "Highwing couldn't read this bot's memory from Hermes." },
  unreadable: { kind: 'unsupported', message: "Hermes answered with memory Highwing can't read." }
} as const

describe('readBotMemory', () => {
  it('answers both files with their caps, reading a cut entry in full and no other', async () => {
    const { read, asked } = reading(OK)
    const outcome = await readBotMemory(read, RAE)
    expect(outcome).toEqual({
      ok: true,
      value: {
        files: [
          { name: 'MEMORY.md', entries: [LONG, SHORT], used: [LONG, SHORT].join('\n§\n').length, cap: 2200 },
          { name: 'USER.md', entries: [PROFILE], used: PROFILE.length, cap: 1375 }
        ]
      }
    })
    expect([...asked].sort()).toEqual([CONFIG_PATH, GRAPH_PATH, LONG_PATH].sort())
  })

  it('shows the entries without a cap when the config gives none', async () => {
    for (const config of [{ status: 500, body: null }, { status: 200, body: { memory: {} } }, new Error('gone')] as const) {
      const outcome = await readBotMemory(reading({ ...OK, [CONFIG_PATH]: config }).read, RAE)
      expect(outcome).toMatchObject({ ok: true, value: { files: [{ cap: null }, { cap: null }] } })
    }
  })

  it('answers empty files for a Hermes with no memory', async () => {
    const { read } = reading({ ...OK, [GRAPH_PATH]: { status: 200, body: { memory: [], nodes: [] } } })
    expect(await readBotMemory(read, RAE)).toEqual({
      ok: true,
      value: { files: [{ name: 'MEMORY.md', entries: [], used: 0, cap: 2200 }, { name: 'USER.md', entries: [], used: 0, cap: 1375 }] }
    })
  })

  it.each<[string, Replies, keyof typeof REFUSALS]>([
    ['a graph that is a 404, as an older Hermes answers', { ...OK, [GRAPH_PATH]: { status: 404, body: null } }, 'none'],
    ['a graph that is a 403', { ...OK, [GRAPH_PATH]: { status: 403, body: { detail: 'profile_scope_mismatch' } } }, 'unreached'],
    ['a graph that is a 500', { ...OK, [GRAPH_PATH]: { status: 500, body: null } }, 'unreached'],
    ['a graph that is no answer', { ...OK, [GRAPH_PATH]: new Error('connect ECONNREFUSED') }, 'unreached'],
    ['a graph that is no graph', { ...OK, [GRAPH_PATH]: { status: 200, body: { memory: 'x' } } }, 'unreadable'],
    ['a cut entry that cannot be read in full', { ...OK, [LONG_PATH]: { status: 404, body: null } }, 'unreadable'],
    ['a cut entry whose full text is not the one the card names', { ...OK, [LONG_PATH]: { status: 200, body: { ok: true, kind: 'memory', content: `${LONG} edited` } } }, 'unreadable'],
    ['a cut entry whose reply is garbage', { ...OK, [LONG_PATH]: { status: 200, body: 'x' } }, 'unreadable']
  ])('refuses %s in plain words', async (_what, replies, refusal) => {
    expect(await readBotMemory(reading(replies).read, RAE)).toEqual({ ok: false, refusal: REFUSALS[refusal] })
  })

  it('reads every entry in full when the digest is not the one Hermes names', async () => {
    const odd = { ...GRAPH, memory: GRAPH.memory.map(card => ({ ...card, fingerprint: 'other-digest' })) }
    const { read, asked } = reading({ ...OK, [GRAPH_PATH]: { status: 200, body: odd } })
    expect(await readBotMemory(read, RAE)).toEqual({ ok: false, refusal: REFUSALS.unreadable })
    expect(asked).toContain('/api/learning/node?id=n%3Ashort&profile=rae')
    expect(asked).toContain('/api/learning/node?id=n%3Aplain&profile=rae')
  })
})
