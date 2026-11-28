/**
 * Which chat is open, and every move it can make. Plain JSON data and pure functions, like
 * `session.ts`, because `OpenChat` crosses Electron IPC.
 */
import type { BotId, Bots } from './bots'
import type { GroupId } from './groups'
import type { SessionId } from './session'

/**
 * What a window can ask to have opened. One member per way to name a chat, and one case in
 * `nextDesk` per member.
 */
export type ChatRef =
  | { readonly kind: 'bot'; readonly bot: BotId }
  /** A new, empty chat in this bot's profile (null: the socket's own profile). The window mints `draftId`. */
  | { readonly kind: 'new'; readonly bot: BotId | null; readonly draftId: string }
  /** A chat picked from the list of a bot's chats. `bot`: the bot whose profile it lives in, from a caller that knows it when no list does, as the Tasks view does for a kanban worker's chat. */
  | { readonly kind: 'chat'; readonly sessionId: SessionId; readonly bot?: BotId }
  /** A routine's run, opened from its run history. Hermes refuses messages there, so it shows with no composer. */
  | { readonly kind: 'run'; readonly bot: BotId; readonly sessionId: SessionId }
  /** A chat named from outside Highwing by its session id alone. Hermes is asked where it lives before it opens. */
  | { readonly kind: 'link'; readonly sessionId: SessionId }
  /** A group chat from the sidebar's Group chats section. */
  | { readonly kind: 'group'; readonly group: GroupId }

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
  /** A routine's run, read-only. It stays shown until the user opens another chat. */
  | { readonly kind: 'run'; readonly bot: BotId; readonly sessionId: SessionId }

/**
 * A group chat in the pane. It has no bot and no session of its own, so it has neither field, and code that reads
 * `open.shown.bot` or `open.shown.sessionId` has to say what it means with a group open (`shownChat`, `shownBot`).
 */
export interface ShownGroup {
  readonly kind: 'group'
  readonly group: GroupId
  /**
   * The bot of the chat the group was opened over (null: the socket's own profile). The Chats column keeps listing that
   * bot's chats and New chat starts one with it, so opening a group moves neither.
   */
  readonly over: BotId | null
}

/** The one answer to "which chat is open". Owned by the hub, read by every window as the `open` topic. */
export interface OpenChat {
  /** null: Hermes has not said enough to pick a chat yet, or it has none to show. */
  readonly shown: Shown | ShownGroup | null
  /** The bot or linked chat a click asked for and Hermes has not answered about. The pane keeps `shown` meanwhile. */
  readonly opening: Extract<ChatRef, { kind: 'bot' | 'link' }> | null
  /** A link named this chat and Hermes has none by that id. The composer says so until the next ask. */
  readonly missing: SessionId | null
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

/** The chat with one bot that the pane shows. null: nothing is open, or a group chat is. */
export const shownChat = (open: OpenChat | undefined): Shown | null => (open?.shown?.kind === 'group' ? null : open?.shown ?? null)

/** The bot whose chats the Chats column lists and a new chat starts with. null: the socket's own profile. A group chat answers the bot it was opened over. */
export const shownBot = (open: OpenChat | undefined): BotId | null => {
  const shown = open?.shown ?? null
  return shown === null ? null : shown.kind === 'group' ? shown.over : shown.bot
}

/** The group chat the pane shows, or null. */
export const shownGroup = (open: OpenChat | undefined): GroupId | null => (open?.shown?.kind === 'group' ? open.shown.group : null)

export const EMPTY_DESK: Desk = { open: { shown: null, opening: null, missing: null }, chats: {}, owners: {}, finding: [] }

/** Profile names are any word Hermes allows, `constructor` included, so a lookup reads the desk's own keys only. */
export const chatOf = (desk: Desk, bot: BotId): SessionId | undefined => Object.hasOwn(desk.chats, bot) ? desk.chats[bot] : undefined
export const ownerOf = (desk: Desk, sessionId: SessionId): BotId | undefined => Object.hasOwn(desk.owners, sessionId) ? desk.owners[sessionId] : undefined

export type DeskEvent =
  | { readonly on: 'facts'; readonly launch: Shown | null; readonly named: BotChats; readonly roster: { readonly bots: readonly BotId[]; readonly home: BotId | null } | null }
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
  | { readonly on: 'sought'; readonly sessionId: SessionId; readonly found: Whereabouts }
  | { readonly on: 'unsought'; readonly sessionId: SessionId }
  /** Hermes archived or removed this chat. */
  | { readonly on: 'gone'; readonly sessionId: SessionId }
  /** The user deleted this group chat. */
  | { readonly on: 'disbanded'; readonly group: GroupId }

/** Where Hermes's lists put a session: in a bot's profile, in the socket's own, or in none it lists. */
export type Whereabouts = { readonly in: 'bot'; readonly bot: BotId } | { readonly in: 'own' } | { readonly in: 'none' }

export type DeskEffect =
  /** Look this bot's Bot Chat up by its title. */
  | { readonly find: BotId }
  | { readonly seek: SessionId }

const waitsForBot = (open: OpenChat, bot: BotId) => open.opening?.kind === 'bot' && open.opening.bot === bot
const waitsForLink = (open: OpenChat, sessionId: SessionId) => open.opening?.kind === 'link' && open.opening.sessionId === sessionId

function showing(desk: Desk, bot: BotId, sessionId: SessionId | null): Desk {
  const { open } = desk
  return { ...desk, open: { ...open, shown: { kind: 'bot', bot, sessionId }, opening: waitsForBot(open, bot) ? null : open.opening } }
}

function picking(desk: Desk, sessionId: SessionId): Desk {
  const shown = shownChat(desk.open)
  const keepsItsPaneAndDraft = shown?.sessionId === sessionId
  return { ...desk, open: { shown: keepsItsPaneAndDraft ? shown : { kind: 'chat', bot: ownerOf(desk, sessionId) ?? null, sessionId }, opening: null, missing: null } }
}

function learned(desk: Desk, bot: BotId, sessionId: SessionId): Desk {
  const { shown } = desk.open
  const known: Desk = chatOf(desk, bot) === sessionId
    ? desk
    : { ...desk, chats: { ...desk.chats, [bot]: sessionId }, owners: { ...desk.owners, [sessionId]: bot } }
  const answersLatestClick = waitsForBot(desk.open, bot)
  const followsShownBot = shown?.kind === 'bot' && shown.bot === bot && shown.sessionId !== sessionId
  return answersLatestClick || followsShownBot ? showing(known, bot, sessionId) : known
}

const done = (desk: Desk): { readonly desk: Desk; readonly effects: readonly DeskEffect[] } => ({ desk, effects: [] })

function asked(desk: Desk, ref: ChatRef): { readonly desk: Desk; readonly effects: readonly DeskEffect[] } {
  switch (ref.kind) {
    case 'bot': {
      const { bot } = ref
      const known = chatOf(desk, bot)
      if (known !== undefined) return done({ ...desk, open: { shown: { kind: 'bot', bot, sessionId: known }, opening: null, missing: null } })
      const waiting: Desk = { ...desk, open: { ...desk.open, opening: ref, missing: null } }
      return desk.finding.includes(bot) ? done(waiting) : { desk: { ...waiting, finding: [...desk.finding, bot] }, effects: [{ find: bot }] }
    }
    case 'new':
      return done({ ...desk, open: { shown: { kind: 'new', bot: ref.bot, draftId: ref.draftId, sessionId: null }, opening: null, missing: null } })
    case 'chat': {
      const { bot, sessionId } = ref
      const owned: Desk = bot === undefined || ownerOf(desk, sessionId) !== undefined ? desk : { ...desk, owners: { ...desk.owners, [sessionId]: bot } }
      return done(picking(owned, sessionId))
    }
    case 'run': {
      const { bot, sessionId } = ref
      const owned: Desk = ownerOf(desk, sessionId) === undefined ? { ...desk, owners: { ...desk.owners, [sessionId]: bot } } : desk
      return done({ ...owned, open: { shown: { kind: 'run', bot, sessionId }, opening: null, missing: null } })
    }
    case 'link': {
      const { sessionId } = ref
      if (shownChat(desk.open)?.sessionId === sessionId || ownerOf(desk, sessionId) !== undefined) return done(picking(desk, sessionId))
      return { desk: { ...desk, open: { ...desk.open, opening: ref, missing: null } }, effects: [{ seek: sessionId }] }
    }
    case 'group': {
      const { shown } = desk.open
      const same = shown?.kind === 'group' && shown.group === ref.group
      return done({ ...desk, open: { shown: same ? shown : { kind: 'group', group: ref.group, over: shownBot(desk.open) }, opening: null, missing: null } })
    }
  }
}

function withListedOverBot(open: OpenChat, roster: Extract<DeskEvent, { on: 'facts' }>['roster']): OpenChat {
  const { shown } = open
  if (shown?.kind !== 'group' || shown.over === null || roster === null || roster.bots.includes(shown.over)) return open
  return { ...open, shown: { ...shown, over: roster.home } }
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
      const open = withListedOverBot(named.open, event.roster)
      return done(open.shown === null && event.launch !== null ? { ...named, open: { ...open, shown: event.launch } } : { ...named, open })
    }
    case 'asked':
      return asked(desk, event.ref)
    case 'found': {
      const { bot, sessionId } = event
      const found: Desk = { ...desk, finding: desk.finding.filter(held => held !== bot) }
      if (sessionId !== null) return done(learned(found, bot, sessionId))
      return done(waitsForBot(found.open, bot) ? showing(found, bot, null) : found)
    }
    case 'failed': {
      const finding = desk.finding.filter(held => held !== event.bot)
      return done({ ...desk, finding, open: waitsForBot(desk.open, event.bot) ? { ...desk.open, opening: null } : desk.open })
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
      const stillThere = shownChat(desk.open)?.sessionId === event.from && desk.open.opening === null
      return done(stillThere ? { ...owned, open: { shown: { kind: 'branch', bot, sessionId: event.sessionId, text: event.text }, opening: null, missing: null } } : owned)
    }
    case 'sought': {
      const { sessionId, found } = event
      if (found.in === 'none') return done(waitsForLink(desk.open, sessionId) ? { ...desk, open: { ...desk.open, opening: null, missing: sessionId } } : desk)
      const owned: Desk = found.in === 'own' || ownerOf(desk, sessionId) !== undefined ? desk : { ...desk, owners: { ...desk.owners, [sessionId]: found.bot } }
      return done(waitsForLink(desk.open, sessionId) ? picking(owned, sessionId) : owned)
    }
    case 'unsought':
      return done(waitsForLink(desk.open, event.sessionId) ? { ...desk, open: { ...desk.open, opening: null } } : desk)
    case 'gone':
      return done(gone(desk, event.sessionId))
    case 'disbanded': {
      const { shown } = desk.open
      if (shown?.kind !== 'group' || shown.group !== event.group) return done(desk)
      const { over } = shown
      return done({ ...desk, open: { ...desk.open, shown: over === null ? null : { kind: 'bot', bot: over, sessionId: chatOf(desk, over) ?? null } } })
    }
  }
}

/**
 * The shown chat moves to its bot's own chat, started or not. With no bot it shows nothing, and the
 * next `facts` picks the newest chat left.
 */
function gone(desk: Desk, sessionId: SessionId): Desk {
  const bot = ownerOf(desk, sessionId)
  const owners = Object.fromEntries(Object.entries(desk.owners).filter(([held]) => held !== sessionId))
  const chats = bot !== undefined && chatOf(desk, bot) === sessionId ? Object.fromEntries(Object.entries(desk.chats).filter(([held]) => held !== bot)) : desk.chats
  const left: Desk = { ...desk, owners, chats }
  const shown = shownChat(desk.open)
  if (shown?.sessionId !== sessionId) return left
  const home = bot ?? shown.bot
  const next: Shown | null = home === null ? null : { kind: 'bot', bot: home, sessionId: chatOf(left, home) ?? null }
  return { ...left, open: { ...desk.open, shown: next } }
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
