/**
 * Which chat is open, and every move it can make. Plain JSON data and pure functions, like
 * `session.ts`, because `OpenChat` crosses Electron IPC.
 */
import type { BotId, Bots } from './bots'
import type { SessionId } from './session'

/**
 * What a window can ask to have opened. One member per way to name a chat, and one case in
 * `nextDesk` per member.
 */
export type ChatRef = { readonly kind: 'bot'; readonly bot: BotId }

export type Shown =
  /** A bot's Bot Chat. */
  | { readonly bot: BotId; readonly sessionId: SessionId }
  /** The chat of a bot that has none yet. Its first message makes it. */
  | { readonly bot: BotId; readonly sessionId: null }
  /** The newest chat of the profile the socket runs in, on a Hermes that cannot tell Highwing which bot it belongs to. */
  | { readonly bot: null; readonly sessionId: SessionId }

/** The one answer to "which chat is open". Owned by the hub, read by every window as the `open` topic. */
export interface OpenChat {
  /** null: Hermes has not said enough to pick a chat yet, or it has none to show. */
  readonly shown: Shown | null
  /** The chat a click asked for and Hermes has not answered about. The pane keeps `shown` meanwhile. */
  readonly opening: ChatRef | null
}

/** bot -> its Bot Chat. */
export type BotChats = { readonly [bot: string]: SessionId }

export interface Desk {
  readonly open: OpenChat
  /** Each bot's Bot Chat as far as Highwing knows: named by the roster, found by its title, or made by a first message. */
  readonly chats: BotChats
  /**
   * session -> the bot whose profile it lives in. A session is entered here in the same step that
   * first puts it in `chats`, so its owner is known before `open` can name it to a window.
   */
  readonly owners: { readonly [sessionId: string]: BotId }
  /** The bots a title lookup is in flight for. Asking for one again starts no second lookup. */
  readonly finding: readonly BotId[]
}

export const EMPTY_DESK: Desk = { open: { shown: null, opening: null }, chats: {}, owners: {}, finding: [] }

/** Profile names are any word Hermes allows, `constructor` included, so a lookup reads the desk's own keys only. */
export const chatOf = (desk: Desk, bot: BotId): SessionId | undefined => Object.hasOwn(desk.chats, bot) ? desk.chats[bot] : undefined
export const ownerOf = (desk: Desk, sessionId: SessionId): BotId | undefined => Object.hasOwn(desk.owners, sessionId) ? desk.owners[sessionId] : undefined

export type DeskEvent =
  /** Hermes said more: the chat to show when none is, and the Bot Chats its roster names. */
  | { readonly on: 'facts'; readonly launch: Shown | null; readonly named: BotChats }
  | { readonly on: 'asked'; readonly ref: ChatRef }
  /** Hermes answered for one bot's Bot Chat: a lookup's reply, or the chat a first message made. null: it has none. */
  | { readonly on: 'found'; readonly bot: BotId; readonly sessionId: SessionId | null }
  /** The lookup for a bot was refused. */
  | { readonly on: 'failed'; readonly bot: BotId }

/** Look this bot's Bot Chat up by its title. */
export interface DeskEffect { readonly find: BotId }

function showing(desk: Desk, bot: BotId, sessionId: SessionId | null): Desk {
  const { opening } = desk.open
  return { ...desk, open: { shown: { bot, sessionId }, opening: opening?.bot === bot ? null : opening } }
}

function learned(desk: Desk, bot: BotId, sessionId: SessionId): Desk {
  const { shown, opening } = desk.open
  const known: Desk = chatOf(desk, bot) === sessionId
    ? desk
    : { ...desk, chats: { ...desk.chats, [bot]: sessionId }, owners: { ...desk.owners, [sessionId]: bot } }
  const answersLatestClick = opening?.bot === bot
  const followsShownBot = shown?.bot === bot && shown.sessionId !== sessionId
  return answersLatestClick || followsShownBot ? showing(known, bot, sessionId) : known
}

const done = (desk: Desk): { readonly desk: Desk; readonly effects: readonly DeskEffect[] } => ({ desk, effects: [] })

/**
 * Every change of the open chat. A click that needs Hermes sets `opening` and leaves `shown` alone
 * until the answer comes, so a refused or slow click never blanks a working chat. Only the latest
 * click's answer moves `shown`: an answer for an earlier one is recorded and shows nothing.
 */
export function nextDesk(desk: Desk, event: DeskEvent): { readonly desk: Desk; readonly effects: readonly DeskEffect[] } {
  switch (event.on) {
    case 'facts': {
      const named = Object.entries(event.named).reduce((held, [bot, sessionId]) => learned(held, bot as BotId, sessionId), desk)
      return done(named.open.shown === null && event.launch !== null ? { ...named, open: { ...named.open, shown: event.launch } } : named)
    }
    case 'asked': {
      const { bot } = event.ref
      const known = chatOf(desk, bot)
      if (known !== undefined) return done({ ...desk, open: { shown: { bot, sessionId: known }, opening: null } })
      const asked: Desk = { ...desk, open: { ...desk.open, opening: event.ref } }
      return desk.finding.includes(bot) ? done(asked) : { desk: { ...asked, finding: [...desk.finding, bot] }, effects: [{ find: bot }] }
    }
    case 'found': {
      const { bot, sessionId } = event
      const found: Desk = { ...desk, finding: desk.finding.filter(held => held !== bot) }
      if (sessionId !== null) return done(learned(found, bot, sessionId))
      return done(found.open.opening?.bot === bot ? showing(found, bot, null) : found)
    }
    case 'failed': {
      const { opening } = desk.open
      const finding = desk.finding.filter(held => held !== event.bot)
      return done({ ...desk, finding, open: opening?.bot === event.bot ? { ...desk.open, opening: null } : desk.open })
    }
  }
}

/**
 * The chat a connection shows before any click.
 * - A socket that reaches every profile, and a roster with a default bot: that bot's Bot Chat, or
 *   its unstarted chat when it has none.
 * - Not connected, or no answer about the bots yet: null, to wait.
 * - Otherwise (no roster, no default bot, or a socket bound to one profile): the newest chat of the
 *   list, which is what Highwing opened before it knew bots.
 */
export function launchChat(
  reach: 'host' | 'profile' | null,
  bots: Bots,
  named: BotChats,
  list: { readonly status: 'loading' | 'ready' | 'stale'; readonly newest: SessionId | null }
): Shown | null {
  if (reach === null || bots.state === 'loading' || bots.state === 'offline') return null
  const home = reach === 'host' && bots.state === 'listed' ? bots.roster.featured : null
  if (home !== null) return { bot: home.id, sessionId: named[home.id] ?? null }
  return list.status === 'loading' || list.newest === null ? null : { bot: null, sessionId: list.newest }
}
