import { refusalOf, refused } from './actor'
import { botsIn, type BotId, type Bots } from './domain/bots'
import type { Outcome } from './domain/command'
import { EMPTY_DESK, chatOf, launchChat, ownerOf, nextDesk, type BotChats, type ChatRef, type DeskEvent, type OpenChat, type Unstarted, type Whereabouts } from './domain/open'
import type { GroupId } from './domain/groups'
import type { SessionId } from './domain/session'
import { Offline, type Calls, type Connection } from './wire/link'
import { parseListPage, parseTitled } from './wire/parse'

/** The title Hermes gives the one chat a bot's row opens (Hermes's hermes-bots/canonical-chat.ts:50). */
const BOT_CHAT = 'Bot Chat'

export const NOT_CONNECTED = refused('offline', "Highwing isn't connected to Hermes right now.")
const CANT_START = refused('unsupported', "This Hermes can't start a chat from Highwing.")
const CANT_SWITCH = refused('unsupported', "This Hermes can't switch bots from Highwing yet. Update Hermes on that machine, then reconnect.")

type Creation = NonNullable<Connection['creation']>

/** The largest `session.list` page the gateway serves. */
const SEEK_ROWS = 200

class NotListed extends Error {}

const offered = (asked: { readonly [key: string]: unknown }, parameters: readonly string[]) =>
  Object.fromEntries(Object.entries(asked).filter(([key]) => parameters.includes(key)))

export interface ChatDesk {
  readonly open: OpenChat
  /**
   * Hermes said more about its bots or its chats. Picks the chat to show while none is, and follows
   * a shown bot to the Bot Chat the roster now names for it. It calls nothing, so launching Highwing
   * makes no session.
   */
  settle(facts: { readonly bots: Bots; readonly named: BotChats; readonly list: { readonly status: 'loading' | 'ready' | 'stale'; readonly newest: SessionId | null } }): void
  /**
   * A click. Looks a bot's chat up when Highwing does not know it, once however often it is asked
   * for. A new chat, a chat picked from the list, or a group chat is shown at once and asks Hermes nothing.
   */
  ask(ref: ChatRef): Promise<Outcome<SessionId | null>>
  askUpFront(ref: { readonly kind: 'new'; readonly bot: BotId; readonly draftId: string }): Promise<Outcome<null>>
  /**
   * The session a first message goes to. A bot's: the Bot Chat Hermes has by now, else a new one. A
   * new chat's: the session made with its `draftId`. Calls made while it is being made share it.
   */
  start(chat: Unstarted): Promise<Outcome<SessionId>>
  /** The bot whose profile a session lives in. undefined: the socket's own profile, so its calls carry no `profile`. */
  botOf(id: SessionId): BotId | undefined
  /** Whether this is some bot's own chat, as far as Highwing knows. */
  isBotChat(id: SessionId): boolean
  /** Hermes archived or removed this chat. A window that shows it moves to its bot's own chat. */
  gone(sessionId: SessionId): void
  /**
   * The user deleted this group chat. A window that shows it moves to the bot it was opened over, or, opened over the
   * socket's own profile, to nothing until the next `settle` picks a chat.
   */
  disbanded(group: GroupId): void
  /** Hermes listed these chats in the bot's profile, so a click on one opens it in that bot. */
  listed(bot: BotId, sessions: readonly SessionId[]): void
  branched(made: { readonly from: SessionId; readonly sessionId: SessionId; readonly text: string }): void
  /** The socket is online again. A linked chat whose search the drop cut short, and that is still the latest ask, is searched again. */
  online(): void
}

export interface DeskDeps {
  readonly conn: Pick<Connection, 'reach' | 'creation' | 'as' | 'call'>
  readonly client: { readonly name: string; readonly version: string }
  readonly mintId: () => string
  /** Runs after every change of `open`, and of the Bot Chats Highwing knows. */
  readonly changed: () => void
}

/**
 * The one owner of the open chat. Every change goes through `nextDesk`. This shell makes the calls
 * a change asks for, each through `conn.as(bot)` so it runs in that bot's profile, and feeds the
 * answers back. Only a socket that reaches every profile can open a bot's chat.
 */
export function chatDesk(deps: DeskDeps): ChatDesk {
  const { conn } = deps
  let desk = EMPTY_DESK
  const finds = new Map<BotId, Promise<Outcome<SessionId | null>>>()
  const starts = new Map<BotId, Promise<Outcome<SessionId>>>()
  const draftSessions = new Map<string, Promise<Outcome<SessionId>>>()
  /** One per bot for the whole connection, so a create that is retried names the session the first one made. */
  const requestIds = new Map<BotId, string>()
  const seeks = new Map<SessionId, Promise<Outcome<SessionId | null>>>()
  let bots: Bots = { state: 'loading' }
  let rosterKnown = () => {}
  const firstRoster = new Promise<void>(resolve => { rosterKnown = resolve })
  let backOnline: readonly (() => void)[] = []
  const nextOnline = () => new Promise<void>(resolve => { backOnline = [...backOnline, resolve] })

  const take = (event: DeskEvent) => {
    const before = desk
    const next = nextDesk(desk, event)
    desk = next.desk
    if (desk.open !== before.open || desk.chats !== before.chats) deps.changed()
    return next.effects
  }

  const titled = async (bot: BotId) => parseTitled(await conn.as(bot).call('session.list', { title: BOT_CHAT, include_hidden: true }))

  const find = (bot: BotId) => {
    const found = titled(bot).then(
      (sessionId): Outcome<SessionId | null> => {
        finds.delete(bot)
        take({ on: 'found', bot, sessionId })
        return { ok: true, value: sessionId }
      },
      (error: unknown): Outcome<never> => {
        finds.delete(bot)
        take({ on: 'failed', bot })
        return { ok: false, refusal: refusalOf(error) }
      }
    )
    finds.set(bot, found)
  }

  /**
   * Every stored row, hidden ones included, and not only the user's chats: a link to a scheduled job's
   * chat opens it, though the list shows it no row. A session `session.list` never names, such as a
   * helper's, reads as missing.
   */
  const lists = async (via: Pick<Calls, 'call'>, sessionId: SessionId): Promise<void> => {
    for (let cursor: string | null = null; ;) {
      const page = parseListPage(await via.call('session.list', { scope: 'stored', include_hidden: true, limit: SEEK_ROWS, ...(cursor === null ? {} : { cursor }) }))
      if (page.sessions.includes(sessionId)) return
      cursor = page.next
      if (cursor === null || page.sessions.length === 0) throw new NotListed()
    }
  }

  const whereIs = async (sessionId: SessionId): Promise<Whereabouts> => {
    const known = ownerOf(desk, sessionId)
    if (known !== undefined) return { in: 'bot', bot: known }
    const places = conn.reach === 'host' && bots.state === 'listed' ? botsIn(bots.roster).map(bot => bot.id) : [null]
    try {
      return await Promise.any(places.map(bot => lists(bot === null ? conn : conn.as(bot), sessionId).then((): Whereabouts => (bot === null ? { in: 'own' } : { in: 'bot', bot }))))
    } catch (error) {
      const failure = (error as AggregateError).errors.find(each => !(each instanceof NotListed))
      if (failure === undefined) return { in: 'none' }
      throw failure
    }
  }

  const stillAsked = (sessionId: SessionId) => desk.open.opening?.kind === 'link' && desk.open.opening.sessionId === sessionId

  const search = async (sessionId: SessionId): Promise<Whereabouts> => {
    await firstRoster
    for (;;) {
      try {
        return await whereIs(sessionId)
      } catch (error) {
        if (!(error instanceof Offline) || !stillAsked(sessionId)) throw error
      }
      await nextOnline()
    }
  }

  const seek = (sessionId: SessionId) => {
    if (seeks.has(sessionId)) return
    const sought = search(sessionId).then(
      (found): Outcome<SessionId | null> => {
        seeks.delete(sessionId)
        take({ on: 'sought', sessionId, found })
        return { ok: true, value: found.in === 'none' ? null : sessionId }
      },
      (error: unknown): Outcome<never> => {
        seeks.delete(sessionId)
        take({ on: 'unsought', sessionId })
        return { ok: false, refusal: refusalOf(error) }
      }
    )
    seeks.set(sessionId, sought)
  }

  /** As Hermes Desktop makes one (hermes-bots/canonical-chat.ts:538-556). A titled create is get-or-create on the gateway (gateway/session_controls.py:505-531). */
  const create = async (bot: BotId, parameters: readonly string[]): Promise<SessionId> => {
    const asked = { source: 'gui', title: BOT_CHAT, follow_profile_config: true, request_id: requestIds.get(bot) ?? deps.mintId(), client: deps.client }
    requestIds.set(bot, asked.request_id)
    // `hidden` is in no `runtime.describe`: the gateway takes it off before its field check (gateway/session_controls.py:527).
    return (await conn.as(bot).call('session.create', { ...offered(asked, parameters), hidden: true })).session_id as SessionId
  }

  /** Hermes answers an exact retry of a `request_id` with the session it made (gateway/session_local.py:308, :365), so the draft's `draftId` is the `request_id`. */
  const makeNew = async (bot: BotId | null, draftId: string, creation: Creation): Promise<Outcome<SessionId>> => {
    const asked = { source: 'gui', request_id: draftId, follow_profile_config: true, client: deps.client }
    try {
      const made = await (bot === null ? conn : conn.as(bot)).call('session.create', offered(asked, creation.parameters))
      const sessionId = made.session_id as SessionId
      take({ on: 'made', bot, draftId, sessionId })
      return { ok: true, value: sessionId }
    } catch (error) {
      return { ok: false, refusal: refusalOf(error) }
    }
  }

  const begin = async (bot: BotId): Promise<Outcome<SessionId>> => {
    const { creation } = conn
    if (creation === null) return NOT_CONNECTED
    try {
      const createsTitled = creation.sources.includes('gui') && creation.parameters.includes('title')
      const sessionId = createsTitled ? await create(bot, creation.parameters) : await titled(bot)
      if (sessionId === null) return CANT_START
      take({ on: 'found', bot, sessionId })
      return { ok: true, value: sessionId }
    } catch (error) {
      return { ok: false, refusal: refusalOf(error) }
    }
  }

  const reachable = (): Outcome<never> | null => (conn.reach === 'host' ? null : conn.reach === null ? NOT_CONNECTED : CANT_SWITCH)

  const startable = (bot: BotId | null): Outcome<Creation> => {
    const unreachable = bot === null ? null : reachable()
    if (unreachable !== null) return unreachable
    const { creation } = conn
    if (creation === null) return NOT_CONNECTED
    return creation.sources.includes('gui') ? { ok: true, value: creation } : CANT_START
  }

  const startBot = (bot: BotId): Promise<Outcome<SessionId>> => {
    const unreachable = reachable()
    if (unreachable !== null) return Promise.resolve(unreachable)
    const known = chatOf(desk, bot)
    if (known !== undefined) return Promise.resolve({ ok: true, value: known })
    const held = starts.get(bot)
    if (held !== undefined) return held
    const started = begin(bot).finally(() => starts.delete(bot))
    starts.set(bot, started)
    return started
  }

  const startNew = (bot: BotId | null, draftId: string): Promise<Outcome<SessionId>> => {
    const able = startable(bot)
    if (!able.ok) return Promise.resolve(able)
    const held = draftSessions.get(draftId)
    if (held !== undefined) return held
    const started = makeNew(bot, draftId, able.value).then(outcome => {
      if (!outcome.ok) draftSessions.delete(draftId)
      return outcome
    })
    draftSessions.set(draftId, started)
    return started
  }

  return {
    get open() { return desk.open },
    settle: facts => {
      bots = facts.bots
      const roster = bots.state === 'listed' ? { bots: botsIn(bots.roster).map(bot => bot.id), home: bots.roster.featured?.id ?? null } : null
      take({ on: 'facts', named: facts.named, launch: launchChat(conn.reach, bots, facts.named, facts.list), roster })
      if (bots.state !== 'loading' && bots.state !== 'offline') rosterKnown()
    },
    ask: async ref => {
      if (ref.kind === 'new') {
        take({ on: 'asked', ref })
        return { ok: true, value: null }
      }
      if (ref.kind === 'chat') {
        take({ on: 'asked', ref })
        return { ok: true, value: ref.sessionId }
      }
      if (ref.kind === 'group') {
        take({ on: 'asked', ref })
        return { ok: true, value: null }
      }
      if (ref.kind === 'link') {
        for (const effect of take({ on: 'asked', ref })) if ('seek' in effect) seek(effect.seek)
        return seeks.get(ref.sessionId) ?? { ok: true, value: ref.sessionId }
      }
      const unreachable = reachable()
      if (unreachable !== null) return unreachable
      for (const effect of take({ on: 'asked', ref })) if ('find' in effect) find(effect.find)
      return finds.get(ref.bot) ?? { ok: true, value: chatOf(desk, ref.bot) ?? null }
    },
    askUpFront: async ref => {
      const able = startable(ref.bot)
      if (!able.ok) return able
      take({ on: 'asked', ref })
      return { ok: true, value: null }
    },
    start: chat => (chat.kind === 'bot' ? startBot(chat.bot) : startNew(chat.bot, chat.draftId)),
    botOf: id => ownerOf(desk, id),
    isBotChat: id => Object.values(desk.chats).includes(id),
    gone: sessionId => void take({ on: 'gone', sessionId }),
    disbanded: group => void take({ on: 'disbanded', group }),
    listed: (bot, sessions) => void take({ on: 'listed', bot, sessions }),
    branched: made => void take({ on: 'branched', ...made }),
    online: () => {
      const waiting = backOnline
      backOnline = []
      for (const wake of waiting) wake()
    }
  }
}
