import type { CommandOutcome, LibraryItem, LibraryItemId, LibraryRead } from '@highwing/hermes/domain'
import { whenWords, joinLibrary, type ViewClock } from '@highwing/thread'

/** Every step read so far, as one list. `step`: the last step read. `chats`: how many chats the steps looked at. */
export interface LibraryPages { readonly step: number; readonly items: readonly LibraryItem[]; readonly chats: number; readonly reach: 'more' | 'all'; readonly unread: number }

export interface LibraryRow {
  readonly id: LibraryItemId
  readonly type: 'File' | 'Image' | 'Link'
  readonly name: string
  /** When the newest chat row that names it was stored. Empty when that chat stores no times. */
  readonly when: string
  /** A file of the Hermes machine, which can be saved here. */
  readonly saves: boolean
}

/** `reached`: how far back the list goes, when it is not every chat or a chat went unread. `older`: there are older chats to look in. */
export type LibraryView =
  | { readonly state: 'loading' }
  | { readonly state: 'refused'; readonly message: string }
  | { readonly state: 'empty'; readonly hint: string; readonly reached: string | null; readonly older: boolean }
  | { readonly state: 'listed'; readonly rows: readonly LibraryRow[]; readonly reached: string | null; readonly older: boolean }

const TYPES: { readonly [K in LibraryItem['kind']]: LibraryRow['type'] } = { file: 'File', image: 'Image', link: 'Link' }

export function afterStep(held: LibraryPages | null, step: number, read: LibraryRead): LibraryPages {
  return {
    step,
    items: joinLibrary(held?.items ?? [], read.items),
    chats: (held?.chats ?? 0) + read.chats,
    reach: read.reach,
    unread: (held?.unread ?? 0) + read.unread
  }
}

function reachedWords({ chats, reach, unread }: LibraryPages, bot: string): string | null {
  const missed = unread === 0 ? '' : `Highwing couldn't read ${unread} of `
  if (reach === 'all') return unread === 0 ? null : `${missed}${bot}'s chats.`
  return `From ${bot}'s ${chats} newest chats.${unread === 0 ? '' : ` ${missed}them.`}`
}

export function libraryViewOf(read: CommandOutcome<LibraryPages> | null, bot: string, clock: ViewClock): LibraryView {
  if (read === null) return { state: 'loading' }
  if (!read.ok) return { state: 'refused', message: read.refusal.message }
  const pages = read.value
  const [reached, older] = [reachedWords(pages, bot), pages.reach === 'more']
  if (pages.items.length === 0) return { state: 'empty', hint: `${bot}'s chats haven't made a file, an image or a link yet.`, reached, older }
  const rows = pages.items.map(item => ({ id: item.id, type: TYPES[item.kind], name: item.name, when: item.at === null ? '' : whenWords(item.at, clock), saves: item.where.on === 'hermes' }))
  return { state: 'listed', rows, reached, older }
}
