import type { BotId } from './bots'
import type { SessionId } from './session'

declare const brand: unique symbol
/** Names one thing in a bot's Library. Main mints it and reads it back. The window only hands it back. */
export type LibraryItemId = string & { readonly [brand]: 'LibraryItemId' }

/** A file on the machine Hermes runs on, as a finished step named it. It names a file on this computer only when Hermes runs here. */
export interface OnHermes { readonly on: 'hermes'; readonly path: string }
/** An http or https address. */
export interface OnWeb { readonly on: 'web'; readonly url: string }

interface Listed {
  readonly id: LibraryItemId
  /** The file's name, the link's words, or the image's alt text. */
  readonly name: string
  /** When the newest row that names it was stored, in ms. null: the chat stores no times. */
  readonly at: number | null
  readonly chat: { readonly sessionId: SessionId; readonly title: string | null }
}

/** One thing a bot's chats made. A link is never on the Hermes machine and a file never on the web. An image may be either. */
export type LibraryItem = Listed & (
  | { readonly kind: 'file'; readonly where: OnHermes }
  | { readonly kind: 'image'; readonly where: OnHermes | OnWeb }
  | { readonly kind: 'link'; readonly where: OnWeb })

/**
 * What one stored row of a chat made: the absolute paths a write_file or patch that worked reported, or a reply's markdown.
 * `at` is the row's own time, else the nearest earlier row's, else the chat's last activity.
 */
export type MadeRow =
  | { readonly at: number | null; readonly wrote: readonly string[] }
  | { readonly at: number | null; readonly said: string }

/** `rows`: oldest first. */
export interface ChatMade { readonly sessionId: SessionId; readonly title: string | null; readonly rows: readonly MadeRow[] }

/** How many of a bot's chats one step of its Library reads. Small, so the first look over ssh is quick. */
export const LIBRARY_STEP_CHATS = 10

/** One step back through a bot's chats, newest chats first. `unread`: the chats of this step Hermes refused or sent unreadable. */
export interface MadeRead { readonly chats: readonly ChatMade[]; readonly reach: 'more' | 'all'; readonly unread: number }

/** What the window gets for one step: that step's items, how many chats it read, and how far it reached. */
export interface LibraryRead { readonly items: readonly LibraryItem[]; readonly chats: number; readonly reach: 'more' | 'all'; readonly unread: number }

/** The last part of a path, on either separator, so a Windows Hermes's file has its own name here too. */
export const fileNameOf = (path: string): string => path.replaceAll('\\', '/').split('/').findLast(part => part !== '') ?? path

/** A file of one bot's chat on the Hermes machine: what `/api/fs/download` takes as `path`, `profile` and `session_id`. */
export interface FarFile { readonly bot: BotId; readonly sessionId: SessionId; readonly path: string }
