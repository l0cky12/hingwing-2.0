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
export type ChatRef =
  | { readonly kind: 'bot'; readonly bot: BotId }
  /** A new, empty chat in this bot's profile (null: the socket's own profile). The window mints `draftId`. */
  | { readonly kind: 'new'; readonly bot: BotId | null; readonly draftId: string }
  /** A chat picked from the list of a bot's chats. */
  | { readonly kind: 'chat'; readonly sessionId: SessionId }

/** A chat no message has made yet. Its first message makes it. */
export type Unstarted =
  | { readonly kind: 'bot'; readonly bot: BotId; readonly sessionId: null }
  | { readonly kind: 'new'; readonly bot: BotId | null; readonly draftId: string; readonly sessionId: null }

export type Shown =
  | Unstarted
  /** A bot's Bot Chat. */
  | { readonly kind: 'bot'; readonly bot: BotId; readonly sessionId: SessionId }
  /** A new chat the user started, once its first message made it. It stays shown until the user opens another chat. */
  | { readonly kind: 'new'; readonly bot: BotId | null; readonly draftId: string; readonly sessionId: SessionId }
  /**
   * A chat picked from the list, in the bot whose profile it lives in. Or the newest chat of the
   * socket's own profile, on a Hermes that can't say which bot it belongs to (bot null).
   */
  | { readonly kind: 'chat'; readonly bot: BotId | null; readonly sessionId: SessionId }
  /**
   * A chat a branch made, shown by that branch. `text` is the message it was branched from. The window puts it in
   * the new chat's draft once, so it stays with that chat like typed text. Picked from the list once another chat
   * is open, it opens as a plain `chat`.
   */
  | { readonly kind: 'branch'; readonly bot: BotId | null; readonly sessionId: SessionId; readonly text: string }

/** The one answer to "which chat is open". Owned by the hub, read by every window as the `open` topic. */
export interface OpenChat {
  /** null: Hermes has not said enough to pick a chat yet, or it has none to show. */
  readonly shown: Shown | null
  /** The bot a click asked for and Hermes has not answered about. The pane keeps `shown` meanwhile. */
  readonly opening: Extract<ChatRef, { kind: 'bot' }> | null
}

/** bot -> its Bot Chat. */
export type BotChats = { readonly [bot: string]: SessionId }

export interface Desk {
  readonly open: OpenChat
  /** Each bot's Bot Chat as far as Highwing knows: named by the roster, found by its title, or made by a first message. */
  readonly chats: BotChats
  /**
   * session -> the bot whose profile it lives in. A session is entered here in the same step that
   * first puts it in `chats`, records the new chat it is, or lists it among a bot's chats, so its
   * owner is known before `open` can name it to a window.
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
  /** A new chat's first message made its session. */
  | { readonly on: 'made'; readonly bot: BotId | null; readonly draftId: string; readonly sessionId: SessionId }
  /** Hermes listed these chats in the bot's profile. Records their owner, and opens nothing. */
  | { readonly on: 'listed'; readonly bot: BotId; readonly sessions: readonly SessionId[] }
  | { readonly on: 'branched'; readonly from: SessionId; readonly sessionId: SessionId; readonly text: string }

/** Look this bot's Bot Chat up by its title. */
export interface DeskEffect { readonly find: BotId }

function showing(desk: Desk, bot: BotId, sessionId: SessionId | null): Desk {
  const { opening } = desk.open
  return { ...desk, open: { shown: { kind: 'bot', bot, sessionId }, opening: opening?.bot === bot ? null : opening } }
}

function learned(desk: Desk, bot: BotId, sessionId: SessionId): Desk {
  const { shown, opening } = desk.open
  const known: Desk = chatOf(desk, bot) === sessionId
    ? desk
    : { ...desk, chats: { ...desk.chats, [bot]: sessionId }, owners: { ...desk.owners, [sessionId]: bot } }
  const answersLatestClick = opening?.bot === bot
  const followsShownBot = shown?.kind === 'bot' && shown.bot === bot && shown.sessionId !== sessionId
  return answersLatestClick || followsShownBot ? showing(known, bot, sessionId) : known
}

const done = (desk: Desk): { readonly desk: Desk; readonly effects: readonly DeskEffect[] } => ({ desk, effects: [] })

function asked(desk: Desk, ref: ChatRef): { readonly desk: Desk; readonly effects: readonly DeskEffect[] } {
  switch (ref.kind) {
    case 'bot': {
      const { bot } = ref
      const known = chatOf(desk, bot)
      if (known !== undefined) return done({ ...desk, open: { shown: { kind: 'bot', bot, sessionId: known }, opening: null } })
      const waiting: Desk = { ...desk, open: { ...desk.open, opening: ref } }
      return desk.finding.includes(bot) ? done(waiting) : { desk: { ...waiting, finding: [...desk.finding, bot] }, effects: [{ find: bot }] }
    }
    case 'new':
      return done({ ...desk, open: { shown: { kind: 'new', bot: ref.bot, draftId: ref.draftId, sessionId: null }, opening: null } })
    case 'chat': {
      // The chat shown already keeps its kind, and so its pane and any unsent draft.
      const { shown } = desk.open
      return done({ ...desk, open: { shown: shown?.sessionId === ref.sessionId ? shown : { kind: 'chat', bot: ownerOf(desk, ref.sessionId) ?? null, sessionId: ref.sessionId }, opening: null } })
    }
  }
}

/**
 * Every change of the open chat. A click that needs Hermes sets `opening` and leaves `shown` alone
 * until the answer comes, so a refused or slow click never blanks a working chat. Only the latest
 * click's answer moves `shown`: an answer for an earlier one is recorded and shows nothing. Only a
 * Bot Chat follows what Hermes says. A new chat or a chat picked from the list stays until the user
 * opens another.
 */
export function nextDesk(desk: Desk, event: DeskEvent): { readonly desk: Desk; readonly effects: readonly DeskEffect[] } {
  switch (event.on) {
    case 'facts': {
      const named = Object.entries(event.named).reduce((held, [bot, sessionId]) => learned(held, bot as BotId, sessionId), desk)
      return done(named.open.shown === null && event.launch !== null ? { ...named, open: { ...named.open, shown: event.launch } } : named)
    }
    case 'asked':
      return asked(desk, event.ref)
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
    case 'made': {
      const { bot, draftId, sessionId } = event
      const owned: Desk = bot === null ? desk : { ...desk, owners: { ...desk.owners, [sessionId]: bot } }
      const { shown } = desk.open
      return done(shown?.kind === 'new' && shown.draftId === draftId ? { ...owned, open: { ...owned.open, shown: { ...shown, sessionId } } } : owned)
    }
    case 'listed': {
      const unowned = event.sessions.filter(sessionId => ownerOf(desk, sessionId) === undefined)
      if (unowned.length === 0) return done(desk)
      return done({ ...desk, owners: { ...desk.owners, ...Object.fromEntries(unowned.map(sessionId => [sessionId, event.bot])) } })
    }
    case 'branched': {
      const bot = ownerOf(desk, event.from) ?? null
      const owned: Desk = bot === null ? desk : { ...desk, owners: { ...desk.owners, [event.sessionId]: bot } }
      const { shown, opening } = desk.open
      const stillThere = shown?.sessionId === event.from && opening === null
      return done(stillThere ? { ...owned, open: { shown: { kind: 'branch', bot, sessionId: event.sessionId, text: event.text }, opening: null } } : owned)
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
  if (home !== null) return { kind: 'bot', bot: home.id, sessionId: named[home.id] ?? null }
  return list.status === 'loading' || list.newest === null ? null : { kind: 'chat', bot: null, sessionId: list.newest }
}
