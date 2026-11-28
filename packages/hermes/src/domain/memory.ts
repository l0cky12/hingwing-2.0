/** Hermes's memory replies as the dashboard API sends them (hermes_cli/web_routers/status.py, config_env.py), read into what the Memory tab draws. */
import type { BotId } from './bots'
import type { MemoryEntry } from './command'

export type MemoryFileName = MemoryEntry['file']

/** `used`: characters the file holds, counted as Hermes counts them. `cap`: null when Hermes's config gave none. */
export interface MemoryFile {
  readonly name: MemoryFileName
  readonly entries: readonly string[]
  readonly used: number
  readonly cap: number | null
}
/** MEMORY.md then USER.md, both always there. */
export interface BotMemory { readonly files: readonly [MemoryFile, MemoryFile] }
/** One card of the graph reply. `text` is cut where Hermes cut it, `fingerprint` names the whole entry, and `node` is Hermes's opaque id for reading it in full. */
export interface MemoryCard { readonly file: MemoryFileName; readonly text: string; readonly fingerprint: string; readonly node: string }
export type MemoryCaps = { readonly [F in MemoryFileName]: number | null }

export const NO_MEMORY_CAPS: MemoryCaps = { 'MEMORY.md': null, 'USER.md': null }

/** What Hermes writes between a file's entries (tools/memory_tool_store.py), and so what its size counts. */
const HERMES_ENTRY_SEPARATOR = '\n§\n'

/** Python's `str.strip()`, which Hermes trims an entry with before it digests it. JavaScript's `trim()` also drops U+FEFF and keeps U+001C to U+001F and U+0085. */
const PYTHON_SPACE = '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]'
const PYTHON_ENDS = new RegExp(`^${PYTHON_SPACE}+|${PYTHON_SPACE}+$`, 'g')
export const pythonStrip = (text: string): string => text.replace(PYTHON_ENDS, '')

export const memoryGraphPath = (bot: BotId): string => `/api/learning/graph?profile=${encodeURIComponent(bot)}`
export const memoryCapsPath = (bot: BotId): string => `/api/config?profile=${encodeURIComponent(bot)}`
export const memoryEntryPath = (bot: BotId, node: string): string => `/api/learning/node?id=${encodeURIComponent(node)}&profile=${encodeURIComponent(bot)}`

type Obj = Readonly<Record<string, unknown>>
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)
const filled = (value: unknown): value is string => typeof value === 'string' && value !== ''

const fileOf = (source: unknown): MemoryFileName | null => (source === 'memory' ? 'MEMORY.md' : source === 'profile' ? 'USER.md' : null)

/** null: the reply is not Hermes's memory graph, or its cards and memory nodes do not pair. */
export function parseMemoryGraph(raw: unknown): readonly MemoryCard[] | null {
  if (!isObject(raw) || !Array.isArray(raw.memory) || !Array.isArray(raw.nodes)) return null
  const nodes = raw.nodes.filter((node): node is Obj => isObject(node) && node.kind === 'memory')
  if (nodes.length !== raw.memory.length) return null
  const cards: MemoryCard[] = []
  for (const [index, card] of raw.memory.entries()) {
    const node = nodes[index]
    const file = isObject(card) ? fileOf(card.source) : null
    if (!isObject(card) || node === undefined || file === null || fileOf(node.memorySource) !== file) return null
    if (typeof card.body !== 'string' || !filled(card.fingerprint) || !filled(node.id)) return null
    cards.push({ file, text: card.body, fingerprint: card.fingerprint, node: node.id })
  }
  return cards
}

const capOf = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null)

/** null: the reply is not a config. A file whose cap is not a whole number of zero or more has none. Hermes keeps a cap of 0, which lets nothing in. */
export function parseMemoryCaps(raw: unknown): MemoryCaps | null {
  if (!isObject(raw)) return null
  const memory = isObject(raw.memory) ? raw.memory : {}
  return { 'MEMORY.md': capOf(memory.memory_char_limit), 'USER.md': capOf(memory.user_char_limit) }
}

/** The whole text of an entry from a node reply. null: not Hermes's reply for a memory entry. */
export function parseMemoryEntry(raw: unknown): string | null {
  return isObject(raw) && raw.ok === true && raw.kind === 'memory' && typeof raw.content === 'string' ? raw.content : null
}

const fileOfEntries = (name: MemoryFileName, entries: readonly string[], cap: number | null): MemoryFile =>
  ({ name, entries, used: [...entries.join(HERMES_ENTRY_SEPARATOR)].length, cap })

export function botMemoryOf(cards: readonly { readonly file: MemoryFileName; readonly text: string }[], caps: MemoryCaps): BotMemory {
  const textsOf = (name: MemoryFileName) => cards.filter(card => card.file === name).map(card => card.text)
  return { files: [fileOfEntries('MEMORY.md', textsOf('MEMORY.md'), caps['MEMORY.md']), fileOfEntries('USER.md', textsOf('USER.md'), caps['USER.md'])] }
}
