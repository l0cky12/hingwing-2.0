import type { BotId } from './bots'
import type { SessionId } from './session'

export interface FoundMessage {
  readonly sessionId: SessionId
  /** null: the chat is in the socket's own profile. */
  readonly bot: BotId | null
  readonly chat: string | null
  readonly rowId: number
  /** The row of the message that opens its turn, where the chat lands. null before the chat's first message. */
  readonly landing: number | null
  readonly text: string
  readonly at: number | null
}

/**
 * One step back through every bot's chats, newest chats first. `reach` is `all` once no bot has a chat past this step.
 * `unread` counts the bots and chats of this step Highwing could not read.
 */
export interface MessagesRead {
  readonly messages: readonly FoundMessage[]
  readonly reach: 'more' | 'all'
  readonly unread: number
}
