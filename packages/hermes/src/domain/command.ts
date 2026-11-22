import type { InputId, PromptId, PromptReply, SessionId } from './session'

export type Command =
  /** `draftId` is minted when the empty "new chat" view opens. Retrying with it cannot create a second session. */
  | { readonly do: 'create'; readonly draftId: string; readonly cwd: string | null }
  | { readonly do: 'send'; readonly sessionId: SessionId; readonly text: string }
  | { readonly do: 'stop'; readonly sessionId: SessionId }
  | { readonly do: 'answer'; readonly sessionId: SessionId; readonly promptId: PromptId; readonly reply: PromptReply }
  | { readonly do: 'discard'; readonly sessionId: SessionId; readonly inputId: InputId }
  | { readonly do: 'rename'; readonly sessionId: SessionId; readonly title: string }
  | { readonly do: 'archive'; readonly sessionId: SessionId; readonly archived: boolean }
  | { readonly do: 'loadEarlier'; readonly sessionId: SessionId }
  /** Retry: dial now. Start: dial now and let Hermes start its gateway. The only way a dial after launch starts it. */
  | { readonly do: 'reconnect'; readonly start: boolean }

export type ResultOf<C extends Command> = C extends { do: 'create' } ? SessionId : void

/** A command that could not be carried out. A value, not an exception, so it crosses IPC unchanged. */
export interface Refusal {
  readonly kind: 'offline' | 'not-attached' | 'stale' | 'conflict' | 'rejected' | 'unsupported'
  /** Plain words for the user. */
  readonly message: string
}
export type Outcome<T = void> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: Refusal }
