/** A message the user handed to another bot from a chat, and what came back. */
import type { AvatarTone, BotId } from './bots'
import type { TurnId } from './session'

declare const brand: unique symbol

/** The delivery id sent to Hermes: 32 lowercase hex characters. */
export type RelayId = string & { readonly [brand]: 'RelayId' }

export type RelayState =
  | { readonly s: 'waiting' }
  | { readonly s: 'answered'; readonly reply: string }
  /** `words`: plain words for the user. */
  | { readonly s: 'failed'; readonly words: string }

export interface Relay {
  readonly id: RelayId
  readonly to: BotId
  /** The bot's shown name and tone when the message was sent. */
  readonly name: string
  readonly tone: AvatarTone
  /** What the user sent. */
  readonly text: string
  /** The newest turn the chat held when this was sent, settled or running. null: it held none. */
  readonly after: TurnId | null
  readonly state: RelayState
}

export interface RelayDesk {
  /** Whether this Hermes can hand a message to another bot. False until it says so. */
  readonly supported: boolean
  /** Oldest first. A chat nothing was relayed from has no key. */
  readonly bySession: { readonly [session: string]: readonly Relay[] }
}
