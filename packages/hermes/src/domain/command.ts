import type { BotId } from './bots'
import type { ChatRef } from './open'
import type { InputId, ModelOption, ModelRef, PromptId, PromptReply, SessionId } from './session'

export type Command =
  /**
   * Show this chat. Answers the session shown, or null for a bot that has no chat yet. It never
   * makes a session, and a refusal leaves the open chat as it was.
   */
  | { readonly do: 'open'; readonly ref: ChatRef }
  /**
   * The first message to a bot that has no chat yet: makes its Bot Chat, shows it and sends `text`
   * there. Messages sent while the chat is being made go to that one chat, in the order sent.
   */
  | { readonly do: 'start'; readonly bot: BotId; readonly text: string }
  /** A line that starts with a listed `/name` runs that Hermes command or skill instead of going to the agent as text. */
  | { readonly do: 'send'; readonly sessionId: SessionId; readonly text: string }
  | { readonly do: 'stop'; readonly sessionId: SessionId }
  | { readonly do: 'answer'; readonly sessionId: SessionId; readonly promptId: PromptId; readonly reply: PromptReply }
  | { readonly do: 'discard'; readonly sessionId: SessionId; readonly inputId: InputId }
  | { readonly do: 'rename'; readonly sessionId: SessionId; readonly title: string }
  | { readonly do: 'archive'; readonly sessionId: SessionId; readonly archived: boolean }
  | { readonly do: 'loadEarlier'; readonly sessionId: SessionId }
  | { readonly do: 'models'; readonly sessionId: SessionId }
  /** `confirm` is the token of a `ModelConfirm`, sent to say yes to it. */
  | { readonly do: 'pickModel'; readonly sessionId: SessionId; readonly model: ModelOption; readonly confirm?: string }
  /** Retry: dial now. Start: dial now and let Hermes start its gateway. The only way a dial after launch starts it. */
  | { readonly do: 'reconnect'; readonly start: boolean }

/** `send` and `start` answer the words to show under the composer: a command's output or note, or `null` for none. */
export type ResultOf<C extends Command> =
  C extends { do: 'open' } ? SessionId | null
  : C extends { do: 'send' | 'start' } ? string | null
  : C extends { do: 'models' } ? ModelMenu
  : C extends { do: 'pickModel' } ? ModelConfirm | null
  : void

/** What Hermes offers this chat. `options` empty: nothing is set up. `fallback`: the model Hermes names for it. */
export interface ModelMenu { readonly options: readonly ModelOption[]; readonly fallback: ModelRef | null }

/** Hermes wants a second yes before it switches, usually for a costly model. Nothing changed yet. */
export interface ModelConfirm { readonly token: string; readonly message: string }

/** A command that could not be carried out. A value, not an exception, so it crosses IPC unchanged. */
export interface Refusal {
  readonly kind: 'offline' | 'not-attached' | 'stale' | 'conflict' | 'rejected' | 'unsupported'
  /** Plain words for the user. */
  readonly message: string
}
export type Outcome<T = void> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: Refusal }
