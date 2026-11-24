import { refusalOf, refused } from './actor'
import type { BotId, Bots } from './domain/bots'
import type { Outcome } from './domain/command'
import { EMPTY_DESK, launchChat, nextDesk, type BotChats, type ChatRef, type DeskEvent, type OpenChat } from './domain/open'
import type { SessionId } from './domain/session'
import type { Connection } from './wire/link'
import { parseTitled } from './wire/parse'

/** The title Hermes gives the one chat a bot's row opens (Hermes's hermes-bots/canonical-chat.ts:50). */
const BOT_CHAT = 'Bot Chat'

export const NOT_CONNECTED = refused('offline', "Highwing isn't connected to Hermes right now.")
export const CANT_START = refused('unsupported', "This Hermes can't start a chat from Highwing.")
const CANT_SWITCH = refused('unsupported', "This Hermes can't switch bots from Highwing yet. Update Hermes on that machine, then reconnect.")

export interface ChatDesk {
  readonly open: OpenChat
  /**
   * Hermes said more about its bots or its chats. Picks the chat to show while none is, and follows
   * a shown bot to the Bot Chat the roster now names for it. It calls nothing, so launching Highwing
   * makes no session.
   */
  settle(facts: { readonly bots: Bots; readonly named: BotChats; readonly list: { readonly status: 'loading' | 'ready' | 'stale'; readonly newest: SessionId | null } }): void
  /** A click. Looks the chat up when Highwing does not know it, once however often it is asked for. */
  ask(ref: ChatRef): Promise<Outcome<SessionId | null>>
  /** The Bot Chat a first message goes to: the one Hermes has by now, else a new one. Calls made while it is being made share it. */
  start(bot: BotId): Promise<Outcome<SessionId>>
  /** The bot whose profile a session lives in. undefined: the socket's own profile, so its calls carry no `profile`. */
  botOf(id: SessionId): BotId | undefined
}

export interface DeskDeps {
  readonly conn: Pick<Connection, 'reach' | 'creation' | 'as'>
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
    const params = Object.fromEntries(Object.entries(asked).filter(([key]) => parameters.includes(key)))
    // `hidden` is in no `runtime.describe`: the gateway takes it off before its field check (gateway/session_controls.py:527).
    return (await conn.as(bot).call('session.create', { ...params, hidden: true })).session_id as SessionId
  }

  const begin = async (bot: BotId): Promise<Outcome<SessionId>> => {
    const { creation } = conn
    if (creation === null) return NOT_CONNECTED
    try {
      // Another device may have made the chat since the click that found none.
      const found = await titled(bot)
      if (found === null && !(creation.sources.includes('gui') && creation.parameters.includes('title'))) return CANT_START
      const sessionId = found ?? await create(bot, creation.parameters)
      take({ on: 'found', bot, sessionId })
      return { ok: true, value: sessionId }
    } catch (error) {
      return { ok: false, refusal: refusalOf(error) }
    }
  }

  const reachable = (): Outcome<never> | null => (conn.reach === 'host' ? null : conn.reach === null ? NOT_CONNECTED : CANT_SWITCH)

  return {
    get open() { return desk.open },
    settle: ({ bots, named, list }) => void take({ on: 'facts', named, launch: launchChat(conn.reach, bots, named, list) }),
    ask: async ref => {
      const unreachable = reachable()
      if (unreachable !== null) return unreachable
      for (const effect of take({ on: 'asked', ref })) find(effect.find)
      return finds.get(ref.bot) ?? { ok: true, value: desk.chats[ref.bot] ?? null }
    },
    start: bot => {
      const unreachable = reachable()
      if (unreachable !== null) return Promise.resolve(unreachable)
      const known = desk.chats[bot]
      if (known !== undefined) return Promise.resolve({ ok: true, value: known })
      const held = starts.get(bot)
      if (held !== undefined) return held
      const started = begin(bot).finally(() => starts.delete(bot))
      starts.set(bot, started)
      return started
    },
    botOf: id => desk.owners[id]
  }
}
