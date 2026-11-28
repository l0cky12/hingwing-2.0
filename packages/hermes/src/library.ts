import { refusalOf } from './actor'
import type { BotId } from './domain/bots'
import type { Outcome } from './domain/command'
import { LIBRARY_STEP_CHATS, type ChatMade, type MadeRead, type MadeRow } from './domain/library'
import type { Owned } from './messages'
import { chatsOf, rowsOf, unlessRefused } from './stored'
import type { Calls } from './wire/link'
import { parseMade, type StoredMade } from './wire/parse'

/** The rows that made something, each with the time of the newest row at or before it, else the chat's last activity. */
function stamped(rows: readonly StoredMade[], lastActiveAt: number | null): readonly MadeRow[] {
  let seen: number | null = null
  return rows.flatMap((row): MadeRow[] => {
    seen = row.at ?? seen
    const at = seen ?? lastActiveAt
    if (row.wrote.length > 0) return [{ at, wrote: row.wrote }]
    return row.said === null ? [] : [{ at, said: row.said }]
  })
}

/** One step of a bot's chats, `LIBRARY_STEP_CHATS` at a time, as their stored rows say. A chat Hermes refuses counts as unread. */
export async function readMade({ bot, via }: { readonly bot: BotId; readonly via: Calls }, step: number, owned: Owned): Promise<Outcome<MadeRead>> {
  try {
    const listing = await chatsOf(via, (step + 1) * LIBRARY_STEP_CHATS)
    const chats = listing.chats.slice(step * LIBRARY_STEP_CHATS)
    owned(bot, chats.map(chat => chat.id))
    const made: ChatMade[] = []
    let unread = 0
    for (const chat of chats) {
      const rows = await unlessRefused(rowsOf(via, chat.id, parseMade))
      if (rows === null) unread++
      else made.push({ sessionId: chat.id, title: chat.title, rows: stamped(rows, chat.lastActiveAt) })
    }
    return { ok: true, value: { chats: made, reach: listing.more ? 'more' : 'all', unread } }
  } catch (error) {
    return { ok: false, refusal: refusalOf(error) }
  }
}
