import { refusalOf } from './actor'
import type { BotId } from './domain/bots'
import type { Outcome } from './domain/command'
import type { FoundMessage, MessagesRead } from './domain/messages'
import type { SessionId } from './domain/session'
import { chatsOf, rowsOf, unlessRefused } from './stored'
import type { Calls } from './wire/link'
import { parseWords, type StoredWords } from './wire/parse'

const CHATS_PER_STEP = 5

export interface Place { readonly bot: BotId | null; readonly via: Calls }

function messagesIn(rows: readonly StoredWords[], sessionId: SessionId, bot: BotId | null, chat: string | null): FoundMessage[] {
  let landing: number | null = null
  return rows.flatMap((row): FoundMessage[] => {
    if (row.opensTurn) landing = row.rowId
    return row.said === null || row.rowId === null ? [] : [{ sessionId, bot, chat, rowId: row.rowId, landing, text: row.said, at: row.at }]
  })
}

interface PlaceRead { readonly messages: readonly FoundMessage[]; readonly more: boolean; readonly unread: number }

export type Owned = (bot: BotId, sessions: readonly SessionId[]) => void

async function readPlace({ bot, via }: Place, step: number, owned: Owned): Promise<PlaceRead> {
  const listing = await unlessRefused(chatsOf(via, (step + 1) * CHATS_PER_STEP))
  if (listing === null) return { messages: [], more: false, unread: 1 }
  const chats = listing.chats.slice(step * CHATS_PER_STEP)
  if (bot !== null) owned(bot, chats.map(chat => chat.id))
  const messages: FoundMessage[] = []
  let unread = 0
  for (const chat of chats) {
    const rows = await unlessRefused(rowsOf(via, chat.id, parseWords))
    if (rows === null) unread++
    else messages.push(...messagesIn(rows, chat.id, bot, chat.title))
  }
  return { messages, more: listing.more, unread }
}

export async function readMessages(places: readonly Place[], step: number, owned: Owned): Promise<Outcome<MessagesRead>> {
  try {
    const reads = await Promise.all(places.map(place => readPlace(place, step, owned)))
    return {
      ok: true,
      value: {
        messages: reads.flatMap(read => read.messages),
        reach: reads.some(read => read.more) ? 'more' : 'all',
        unread: reads.reduce((sum, read) => sum + read.unread, 0)
      }
    }
  } catch (error) {
    return { ok: false, refusal: refusalOf(error) }
  }
}
