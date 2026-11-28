import { createHash } from 'node:crypto'
import { pythonStrip } from '../domain/memory'
import type { MemoryFiles, MemoryScript } from './fixture'

const DELIMITER = '\n§\n'
/** The most of an entry the graph's cards carry: `chunk[:1200]` in agent/learning_graph.py. */
const CARD_BODY_MAX = 1200
const DEFAULT_LIMITS = { memory: 2200, user: 1375 } as const
const FILES = { memory: 'MEMORY.md', profile: 'USER.md' } as const
type Source = keyof typeof FILES

const grouped = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const fingerprint = (text: string) => createHash('sha256').update(pythonStrip(text), 'utf8').digest('hex').slice(0, 12)

export interface MemoryBook {
  /** The dashboard API's `GET /api/learning/graph`. */
  graph(): unknown
  /** The dashboard API's `GET /api/config`, as far as the memory caps. */
  config(): unknown
  frames(): unknown
  detail(id: string): unknown
  edit(id: string, content: string): unknown
  remove(id: string): unknown
}

/** The memory files a fixture holds, written the way agent/learning_mutations.py writes them. */
export function memoryBook(script: MemoryFiles): MemoryBook {
  const entries: { readonly [S in Source]: string[] } = {
    memory: script.entries.flatMap(entry => entry.file === 'MEMORY.md' ? [entry.text.trim()] : []),
    profile: script.entries.flatMap(entry => entry.file === 'USER.md' ? [entry.text.trim()] : [])
  }
  const limitOf = (source: Source) => (source === 'profile' ? script.limits?.user ?? DEFAULT_LIMITS.user : script.limits?.memory ?? DEFAULT_LIMITS.memory)
  const cards = () => [...entries.memory.map(text => ({ source: 'memory' as const, text })), ...entries.profile.map(text => ({ source: 'profile' as const, text }))]
  const idOf = (source: Source, index: number, text: string) => `memory:${source}:${index}:${fingerprint(text)}`

  const locate = (nodeId: string): { readonly source: Source; readonly local: number } | { readonly message: string } => {
    const parts = nodeId.split(':')
    const source = parts[1]
    if ((parts.length !== 3 && parts.length !== 4) || parts[0] !== 'memory' || (source !== 'memory' && source !== 'profile') || !/^\d+$/.test(parts[2] ?? '')) {
      return { message: `bad memory node id: '${nodeId}'` }
    }
    const list = entries[source]
    const fingerprintPart = parts[3] ?? ''
    if (fingerprintPart !== '') {
      const local = list.findIndex(text => fingerprint(text) === fingerprintPart)
      return local < 0 ? { message: 'memory node id is stale — refresh the graph' } : { source, local }
    }
    const gidx = Number(parts[2])
    const all = cards()
    if (gidx >= all.length) return { message: `memory index ${gidx} out of range` }
    if (all[gidx]?.source !== source) return { message: 'memory node id is stale — refresh the graph' }
    const local = source === 'memory' ? gidx : gidx - entries.memory.length
    return local < 0 || local >= list.length ? { message: 'memory node id is stale — refresh the graph' } : { source, local }
  }

  const node = (source: Source, index: number, text: string) => {
    const line = text.split('\n')[0] ?? ''
    return { id: idOf(source, index, text), glyph: 'M', label: line.slice(0, 80), fullLabel: line, meta: FILES[source], body: text, style: 'memory' }
  }

  return {
    graph() {
      const all = cards()
      return {
        memory: all.map(card => ({ source: card.source, timestamp: 0, title: (card.text.split('\n')[0] ?? '').slice(0, 80), body: [...card.text].slice(0, CARD_BODY_MAX).join(''), fingerprint: fingerprint(card.text) })),
        nodes: all.map((card, index) => ({ id: idOf(card.source, index, card.text), kind: 'memory', memorySource: card.source, label: (card.text.split('\n')[0] ?? '').slice(0, 80) }))
      }
    },
    config() {
      return { memory: { memory_char_limit: limitOf('memory'), user_char_limit: limitOf('profile') } }
    },
    frames() {
      const nodes = cards().map((card, index) => node(card.source, index, card.text))
      return {
        frames: [], legend: [], categories: [],
        buckets: [{ index: 0, label: 'Memory', date: '', skills: 0, memories: nodes.length, total: nodes.length, nodes }],
        summary: [], axis: { start: '', end: '' }, count: nodes.length, cols: 1, rows: 1
      }
    },
    detail(id) {
      const found = locate(id)
      if ('message' in found) return { ok: false, message: found.message }
      const text = entries[found.source][found.local] ?? ''
      return { ok: true, kind: 'memory', id, label: (text.split('\n')[0] ?? '').slice(0, 80), content: text }
    },
    edit(id, content) {
      const found = locate(id)
      if ('message' in found) return { ok: false, message: found.message }
      const body = content.trim()
      if (body === '') return { ok: false, message: 'empty memory — use delete to remove it' }
      const next = entries[found.source].slice()
      next[found.local] = body
      const total = next.join(DELIMITER).length
      const limit = limitOf(found.source)
      if (total > limit) return { ok: false, message: `Replacement would put memory at ${grouped(total)}/${grouped(limit)} chars. Shorten the new content.` }
      entries[found.source][found.local] = body
      return { ok: true, message: `updated memory in ${FILES[found.source]}` }
    },
    remove(id) {
      const found = locate(id)
      if ('message' in found) return { ok: false, message: found.message }
      entries[found.source].splice(found.local, 1)
      return { ok: true, message: `deleted memory from ${FILES[found.source]}` }
    }
  }
}

function bookFor(script: MemoryScript, profile: string): MemoryFiles {
  if (profile === 'default') return script
  const own = script.profiles?.[profile]
  return { entries: own?.entries ?? [], ...(own?.limits === undefined ? {} : { limits: own.limits }) }
}

export const GRAPH_ROUTE = '/api/learning/graph'
export const CONFIG_ROUTE = '/api/config'
export const NODE_ROUTE = '/api/learning/node'

/**
 * The dashboard API's memory reads of a fixture's Hermes, one book per profile asked. null: not a memory route.
 * Without a script every memory route is a 404, as on a Hermes that lacks them.
 */
export function memoryReads(script: MemoryScript | undefined): (path: string) => { readonly status: number; readonly body: unknown } | null {
  const books = new Map<string, MemoryBook>()
  const bookOf = (held: MemoryScript, profile: string) => {
    const book = books.get(profile) ?? memoryBook(bookFor(held, profile))
    books.set(profile, book)
    return book
  }
  return path => {
    const url = new URL(path, 'http://hermes.invalid')
    if (url.pathname !== GRAPH_ROUTE && url.pathname !== CONFIG_ROUTE && url.pathname !== NODE_ROUTE) return null
    if (script === undefined) return { status: 404, body: { detail: 'Not Found' } }
    const book = bookOf(script, url.searchParams.get('profile') ?? 'default')
    if (url.pathname === GRAPH_ROUTE) return { status: 200, body: book.graph() }
    if (url.pathname === CONFIG_ROUTE) return { status: 200, body: book.config() }
    const detail = book.detail(url.searchParams.get('id') ?? '') as { readonly ok: boolean }
    return { status: detail.ok ? 200 : 404, body: detail }
  }
}
