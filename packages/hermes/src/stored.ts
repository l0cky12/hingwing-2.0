import type { SessionId } from './domain/session'
import { RpcRefusal, type Calls } from './wire/link'
import { parseChatPage, type parseWords } from './wire/parse'

/** The largest `session.list` page the gateway serves. */
const LIST_ROWS = 200
/** The most rows a `session.transcript` page holds. */
const PAGE_ROWS = 500
const MOST_PAGES = 20

export interface Listed { readonly id: SessionId; readonly title: string | null; readonly lastActiveAt: number | null }

class Unreadable extends Error {}

/** The newest `count` chats of a place, in Hermes's stored order, and whether it holds more. */
export async function chatsOf(via: Calls, count: number): Promise<{ readonly chats: readonly Listed[]; readonly more: boolean }> {
  const chats: Listed[] = []
  for (let cursor: string | null = null; ;) {
    const page = parseChatPage(await via.call('session.list', {
      scope: 'stored', include_hidden: true, limit: Math.min(LIST_ROWS, count + 1 - chats.length), ...(cursor === null ? {} : { cursor })
    }))
    chats.push(...page.chats.map(row => ({ id: row.id, title: row.title || null, lastActiveAt: row.lastActiveAt })))
    cursor = page.next
    if (chats.length > count || cursor === null) return { chats: chats.slice(0, count), more: chats.length > count }
  }
}

interface Page<R> { readonly rows: readonly R[]; readonly next: string | null; readonly reset: boolean }
type TranscriptPage = Parameters<typeof parseWords>[0]

/** Every stored row of a chat, oldest first, as `parse` reads each page. Rejects as unreadable past `MOST_PAGES` pages. */
export async function rowsOf<R>(via: Calls, sessionId: SessionId, parse: (reply: TranscriptPage) => Page<R> | null): Promise<readonly R[]> {
  const pages: (readonly R[])[] = []
  for (let cursor: string | null = null; pages.length < MOST_PAGES;) {
    const page = parse(await via.call('session.transcript', {
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

/** null: Hermes refused the read, or sent what Highwing can't read. */
export const unlessRefused = <T>(read: Promise<T>): Promise<T | null> =>
  read.catch((error: unknown) => {
    if (error instanceof RpcRefusal || error instanceof Unreadable) return null
    throw error
  })
