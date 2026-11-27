import { refusalOf } from './actor'
import type { MemoryEntry, Outcome } from './domain/command'
import { NOT_CONNECTED } from './open'
import { METHOD_NOT_FOUND, Offline, RpcRefusal, type Connection } from './wire/link'

/**
 * Hermes edits MEMORY.md and USER.md through `learning.edit` and `learning.delete`
 * (agent/learning_mutations.py). Those calls take no `profile` key. Hermes rejects one, and the
 * write lands in the home the socket was launched with. A -32601 means this Hermes has no learning calls.
 * `ok: false` carries the reason in `message`, including a save past the file's size cap.
 */
type Wire = Pick<Connection, 'call'>

const CANT: Outcome<never> = { ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't edit memory yet." } }
const DONE: Outcome = { ok: true, value: undefined }
const FILES = { memory: 'MEMORY.md', profile: 'USER.md' } as const

const fileOf = (id: string): MemoryEntry['file'] | null => {
  const [, source] = id.split(':')
  return id.startsWith('memory:') && (source === 'memory' || source === 'profile') ? FILES[source] : null
}

const words = (message: string | null | undefined, fallback: string) => {
  const trimmed = message?.trim() ?? ''
  return trimmed === '' ? fallback : trimmed
}

async function guarded<T>(work: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof Offline) return NOT_CONNECTED
    if (error instanceof RpcRefusal && error.code === METHOD_NOT_FOUND) return CANT
    return { ok: false, refusal: refusalOf(error) }
  }
}

export const listMemory = (conn: Wire): Promise<Outcome<readonly MemoryEntry[]>> =>
  guarded(async () => {
    const frames = await conn.call('learning.frames', {})
    const nodes = frames.buckets.flatMap(bucket => bucket.nodes).flatMap(node => {
      const file = fileOf(node.id)
      return file === null ? [] : [{ id: node.id, file }]
    })
    const entries: MemoryEntry[] = []
    for (const node of nodes) {
      const detail = await conn.call('learning.detail', { id: node.id })
      if (!detail.ok) return { ok: false, refusal: { kind: 'rejected', message: words(detail.message, "Hermes couldn't read that memory.") } }
      entries.push({ id: node.id, file: node.file, text: detail.content ?? '' })
    }
    return { ok: true, value: entries }
  })

export const saveMemory = (conn: Wire, id: string, text: string): Promise<Outcome> =>
  guarded(async () => {
    const saved = await conn.call('learning.edit', { id, content: text })
    return saved.ok ? DONE : { ok: false, refusal: { kind: 'rejected', message: words(saved.message, "Hermes couldn't save that memory.") } }
  })

export const removeMemory = (conn: Wire, id: string): Promise<Outcome> =>
  guarded(async () => {
    const removed = await conn.call('learning.delete', { id })
    return removed.ok ? DONE : { ok: false, refusal: { kind: 'rejected', message: words(removed.message, "Hermes couldn't remove that memory.") } }
  })
