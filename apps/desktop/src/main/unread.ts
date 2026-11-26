import type { BotId, SessionId, UnreadChat } from '@highwing/hermes/domain'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, open, rename } from 'node:fs/promises'
import { join } from 'node:path'

export const UNREAD_DIR = 'unread'
const VERSION = 1

export interface UnreadStore {
  /** The unread chats kept for a connection. Read at once: a Hermes opens with them. */
  load(place: string): readonly UnreadChat[]
  /** Applied in call order. */
  keep(place: string, chats: readonly UnreadChat[]): void
  /** Resolves once every `keep` so far has reached the disk or failed. */
  settled(): Promise<void>
}

const isName = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** A row this build cannot read is dropped, and the rest are kept. */
export function readUnread(text: string): readonly UnreadChat[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (raw === null || typeof raw !== 'object') return []
  const { version, chats } = raw as { readonly version?: unknown; readonly chats?: unknown }
  if (version !== VERSION || !Array.isArray(chats)) return []
  return chats.flatMap((row: unknown) => {
    const { chat, bot } = (row ?? {}) as { readonly chat?: unknown; readonly bot?: unknown }
    return isName(chat) && isName(bot) ? [{ chat: chat as SessionId, bot: bot as BotId }] : []
  })
}

const fileOf = (dir: string, place: string) => join(dir, `${createHash('sha256').update(place).digest('hex').slice(0, 32)}.json`)

async function write(file: string, chats: readonly UnreadChat[]): Promise<void> {
  const temp = await open(`${file}.tmp`, 'w', 0o600)
  try {
    await temp.writeFile(`${JSON.stringify({ version: VERSION, chats: chats.map(({ chat, bot }) => ({ chat, bot })) })}\n`)
    await temp.sync()
  } finally {
    await temp.close()
  }
  await rename(`${file}.tmp`, file)
}

/** `place` names a connection, so two Hermes never share a list. */
export function unreadStore(dir: string): UnreadStore {
  let chain: Promise<void> = Promise.resolve()
  /** What each place was last given, which a write still on its way has not put on the disk. */
  const kept = new Map<string, readonly UnreadChat[]>()
  return {
    load: place => {
      const held = kept.get(place)
      if (held !== undefined) return held
      try {
        return readUnread(readFileSync(fileOf(dir, place), 'utf8'))
      } catch {
        return []
      }
    },
    keep(place, chats) {
      kept.set(place, chats)
      chain = chain.then(async () => {
        await mkdir(dir, { recursive: true, mode: 0o700 })
        await write(fileOf(dir, place), chats)
      }).catch((error: unknown) => console.error('Highwing could not keep the unread chats:', error))
    },
    settled: () => chain
  }
}
