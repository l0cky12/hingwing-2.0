import { refusalOf } from './actor'
import type { BotId } from './domain/bots'
import type { Outcome } from './domain/command'
import type { FoundMessage, MessagesRead } from './domain/messages'
import type { SessionId } from './domain/session'
import { RpcRefusal, type Calls } from './wire/link'
import { parseChatPage, parseWords, type StoredWords } from './wire/parse'

const CHATS_PER_STEP = 5
/** The largest `session.list` page the gateway serves. */
const LIST_ROWS = 200
/** The most rows a `session.transcript` page holds. */
const PAGE_ROWS = 500
const MOST_PAGES = 20

export interface Place { readonly bot: BotId | null; readonly via: Calls }

interface Listed { readonly id: SessionId; readonly title: string | null }

class Unreadable extends Error {}

/** The newest `count` chats of a place, in Hermes's stored order, and whether it holds more. */
async function chatsOf(via: Calls, count: number): Promise<{ readonly chats: readonly Listed[]; readonly more: boolean }> {
  const chats: Listed[] = []
  for (let cursor: string | null = null; ;) {
    const page = parseChatPage(await via.call('session.list', {
      scope: 'stored', include_hidden: true, limit: Math.min(LIST_ROWS, count + 1 - chats.length), ...(cursor === null ? {} : { cursor })
    }))
    chats.push(...page.chats.map(row => ({ id: row.id, title: row.title || null })))
    cursor = page.next
    if (chats.length > count || cursor === null) return { chats: chats.slice(0, count), more: chats.length > count }
  }
}

async function rowsOf(via: Calls, sessionId: SessionId): Promise<readonly StoredWords[]> {
  const pages: (readonly StoredWords[])[] = []
  for (let cursor: string | null = null; pages.length < MOST_PAGES;) {
    const page = parseWords(await via.call('session.transcript', {
      session_id: sessionId, order: 'latest', limit: PAGE_ROWS, inline_images: false, ...(cursor === null ? {} : { cursor })
    }))
    if (page === null) throw new Unreadable()
    if (page.reset) pages.splice(0)
    pages.push(page.rows)
    if (page.next === null) return pages.toReversed().flat()
    cursor = page.next
  }
  throw new Unreadable()
}

function messagesIn(rows: readonly StoredWords[], sessionId: SessionId, bot: BotId | null, chat: string | null): FoundMessage[] {
  let landing: number | null = null
  return rows.flatMap((row): FoundMessage[] => {
    if (row.opensTurn) landing = row.rowId
    return row.said === null || row.rowId === null ? [] : [{ sessionId, bot, chat, rowId: row.rowId, landing, text: row.said, at: row.at }]
  })
}

interface PlaceRead { readonly messages: readonly FoundMessage[]; readonly more: boolean; readonly unread: number }

type Owned = (bot: BotId, sessions: readonly SessionId[]) => void

const unlessRefused = <T>(read: Promise<T>): Promise<T | null> =>
  read.catch((error: unknown) => {
    if (error instanceof RpcRefusal || error instanceof Unreadable) return null
    throw error
  })

async function readPlace({ bot, via }: Place, step: number, owned: Owned): Promise<PlaceRead> {
  const listing = await unlessRefused(chatsOf(via, (step + 1) * CHATS_PER_STEP))
  if (listing === null) return { messages: [], more: false, unread: 1 }
  const chats = listing.chats.slice(step * CHATS_PER_STEP)
  if (bot !== null) owned(bot, chats.map(chat => chat.id))
  const messages: FoundMessage[] = []
  let unread = 0
  for (const chat of chats) {
    const rows = await unlessRefused(rowsOf(via, chat.id))
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
