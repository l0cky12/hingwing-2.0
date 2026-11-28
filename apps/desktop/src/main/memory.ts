import { createHash } from 'node:crypto'
import type { ReadHermes } from '@highwing/hermes'
import {
  botMemoryOf, memoryCapsPath, memoryEntryPath, memoryGraphPath, NO_MEMORY_CAPS, parseMemoryCaps, parseMemoryEntry, parseMemoryGraph, pythonStrip, type BotId, type BotMemory, type CommandOutcome, type MemoryCard, type Refusal
} from '@highwing/hermes/domain'

const refused = (kind: Refusal['kind'], message: string) => ({ ok: false, refusal: { kind, message } }) as const
const NO_MEMORY = refused('unsupported', "This Hermes can't show memory yet.")
const UNREACHABLE = refused('offline', "Highwing couldn't read this bot's memory from Hermes.")
const UNREADABLE = refused('unsupported', "Hermes answered with memory Highwing can't read.")

const answered = (read: ReadHermes, path: string) => read(path).catch(() => null)

/** Hermes's name for a whole entry: the first 12 hex digits of the SHA-256 of its trimmed text (agent/learning_graph.py). */
const fingerprintOf = (text: string) => createHash('sha256').update(pythonStrip(text), 'utf8').digest('hex').slice(0, 12)

/** A card whose text no longer matches its fingerprint was cut, so the entry is read in full. null: that read failed or is not the entry the card names. */
async function entryOf(read: ReadHermes, bot: BotId, card: MemoryCard): Promise<{ readonly file: MemoryCard['file']; readonly text: string } | null> {
  if (fingerprintOf(card.text) === card.fingerprint) return card
  const answer = await answered(read, memoryEntryPath(bot, card.node))
  const text = answer?.status === 200 ? parseMemoryEntry(answer.body) : null
  return text !== null && fingerprintOf(text) === card.fingerprint ? { file: card.file, text } : null
}

export async function readBotMemory(read: ReadHermes, bot: BotId): Promise<CommandOutcome<BotMemory>> {
  const [graph, config] = await Promise.all([answered(read, memoryGraphPath(bot)), answered(read, memoryCapsPath(bot))])
  if (graph?.status === 404) return NO_MEMORY
  if (graph?.status !== 200) return UNREACHABLE
  const cards = parseMemoryGraph(graph.body)
  if (cards === null) return UNREADABLE
  const entries = await Promise.all(cards.map(card => entryOf(read, bot, card)))
  if (entries.includes(null)) return UNREADABLE
  const caps = (config?.status === 200 ? parseMemoryCaps(config.body) : null) ?? NO_MEMORY_CAPS
  return { ok: true, value: botMemoryOf(entries as { file: MemoryCard['file']; text: string }[], caps) }
}
