import { refusalOf, refused } from './actor'
import type { BotId, Bots } from './domain/bots'
import type { Outcome } from './domain/command'
import { EMPTY_DESK, chatOf, launchChat, ownerOf, nextDesk, type BotChats, type ChatRef, type DeskEvent, type OpenChat, type Unstarted } from './domain/open'
import type { SessionId } from './domain/session'
import type { Connection } from './wire/link'
import { parseTitled } from './wire/parse'

/** The title Hermes gives the one chat a bot's row opens (Hermes's hermes-bots/canonical-chat.ts:50). */
const BOT_CHAT = 'Bot Chat'

const NOT_CONNECTED = refused('offline', "Highwing isn't connected to Hermes right now.")
const CANT_START = refused('unsupported', "This Hermes can't start a chat from Highwing.")
const CANT_SWITCH = refused('unsupported', "This Hermes can't switch bots from Highwing yet. Update Hermes on that machine, then reconnect.")

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
  /** A click. Looks a bot's chat up when Highwing does not know it, once however often it is asked for. A new chat is shown at once and asks Hermes nothing. */
  ask(ref: ChatRef): Promise<Outcome<SessionId | null>>
  /**
   * The session a first message goes to. A bot's: the Bot Chat Hermes has by now, else a new one. A
   * new chat's: the session made with its `draftId`. Calls made while it is being made share it.
   */
  start(chat: Unstarted): Promise<Outcome<SessionId>>
  /** The bot whose profile a session lives in. undefined: the socket's own profile, so its calls carry no `profile`. */
  botOf(id: SessionId): BotId | undefined
}

export interface DeskDeps {
  readonly conn: Pick<Connection, 'reach' | 'creation' | 'as' | 'call'>
  readonly client: { readonly name: string; readonly version: string }
  readonly mintId: () => string
  /** Runs after every change of `open`. */
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

  const take = (event: DeskEvent) => {
    const before = desk.open
    const next = nextDesk(desk, event)
    desk = next.desk
    if (desk.open !== before) deps.changed()
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

  /** As Hermes Desktop makes one (hermes-bots/canonical-chat.ts:538-556). A titled create is get-or-create on the gateway (gateway/session_controls.py:505-531). */
  const create = async (bot: BotId, parameters: readonly string[]): Promise<SessionId> => {
    const asked = { source: 'gui', title: BOT_CHAT, follow_profile_config: true, request_id: requestIds.get(bot) ?? deps.mintId(), client: deps.client }
    requestIds.set(bot, asked.request_id)
    // `hidden` is in no `runtime.describe`: the gateway takes it off before its field check (gateway/session_controls.py:527).
    return (await conn.as(bot).call('session.create', { ...offered(asked, parameters), hidden: true })).session_id as SessionId
  }

  /** Hermes answers an exact retry of a `request_id` with the session it made (gateway/session_local.py:308, :365), so the draft's `draftId` is the `request_id`. */
  const makeNew = async (bot: BotId | null, draftId: string): Promise<Outcome<SessionId>> => {
    const { creation } = conn
    if (creation === null) return NOT_CONNECTED
    if (!creation.sources.includes('gui')) return CANT_START
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
    const unreachable = bot === null ? null : reachable()
    if (unreachable !== null) return Promise.resolve(unreachable)
    const held = draftSessions.get(draftId)
    if (held !== undefined) return held
    const started = makeNew(bot, draftId).then(outcome => {
      if (!outcome.ok) draftSessions.delete(draftId)
      return outcome
    })
    draftSessions.set(draftId, started)
    return started
  }

  return {
    get open() { return desk.open },
    settle: ({ bots, named, list }) => void take({ on: 'facts', named, launch: launchChat(conn.reach, bots, named, list) }),
    ask: async ref => {
      if (ref.kind === 'new') {
        take({ on: 'asked', ref })
        return { ok: true, value: null }
      }
      const unreachable = reachable()
      if (unreachable !== null) return unreachable
      for (const effect of take({ on: 'asked', ref })) find(effect.find)
      return finds.get(ref.bot) ?? { ok: true, value: chatOf(desk, ref.bot) ?? null }
    },
    start: chat => (chat.kind === 'bot' ? startBot(chat.bot) : startNew(chat.bot, chat.draftId)),
    botOf: id => ownerOf(desk, id)
  }
}
