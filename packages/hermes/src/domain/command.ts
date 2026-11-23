import type { InputId, PromptId, PromptReply, SessionId } from './session'

export type Command =
  /** `draftId` is minted when the empty "new chat" view opens. Retrying with it cannot create a second session. */
  | { readonly do: 'create'; readonly draftId: string; readonly cwd: string | null }
  /** A line that starts with a listed `/name` runs that Hermes command or skill instead of going to the agent as text. */
  | { readonly do: 'send'; readonly sessionId: SessionId; readonly text: string }
  | { readonly do: 'stop'; readonly sessionId: SessionId }
  | { readonly do: 'answer'; readonly sessionId: SessionId; readonly promptId: PromptId; readonly reply: PromptReply }
  | { readonly do: 'discard'; readonly sessionId: SessionId; readonly inputId: InputId }
  | { readonly do: 'rename'; readonly sessionId: SessionId; readonly title: string }
  | { readonly do: 'archive'; readonly sessionId: SessionId; readonly archived: boolean }
  | { readonly do: 'loadEarlier'; readonly sessionId: SessionId }
  /** Retry: dial now. Start: dial now and let Hermes start its gateway. The only way a dial after launch starts it. */
  | { readonly do: 'reconnect'; readonly start: boolean }

/** `send` answers the words to show under the composer: a command's output or note, or `null` for none. */
export type ResultOf<C extends Command> = C extends { do: 'create' } ? SessionId : C extends { do: 'send' } ? string | null : void

/** A command that could not be carried out. A value, not an exception, so it crosses IPC unchanged. */
export interface Refusal {
  readonly kind: 'offline' | 'not-attached' | 'stale' | 'conflict' | 'rejected' | 'unsupported'
  /** Plain words for the user. */
  readonly message: string
}
export type Outcome<T = void> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: Refusal }
