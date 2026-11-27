/**
 * Dictation into the composer: where the microphone is, and every move it can make. Pure, so the
 * composer only carries each move out. `since` is when the user pressed to start, so a key held
 * that long is a push to talk and its release stops.
 */
export type Dictation =
  | { readonly at: 'idle'; readonly notice: string | null }
  | { readonly at: 'asking'; readonly since: number }
  | { readonly at: 'recording'; readonly since: number }
  | { readonly at: 'transcribing' }

export type MicrophoneRefusal = 'no-microphone' | 'not-allowed' | 'failed'

export type DictationEvent =
  /** The microphone button, or Ctrl/Cmd+D going down. */
  | { readonly do: 'press'; readonly at: number }
  /** Ctrl/Cmd+D coming up. */
  | { readonly do: 'release'; readonly at: number }
  | { readonly do: 'granted' }
  | { readonly do: 'refused'; readonly why: MicrophoneRefusal }
  /** Hermes's text. Empty: it heard no words. */
  | { readonly do: 'transcribed'; readonly text: string }
  | { readonly do: 'failed'; readonly message: string }
  /** The chat changed, the link went down or the composer went away. Whatever was heard is dropped. */
  | { readonly do: 'cancel' }

export const IDLE: Dictation = { at: 'idle', notice: null }
/** A press held at least this long is push to talk: letting go stops. A shorter one is a toggle. */
export const HOLD_MS = 400

export const REFUSAL_WORDS: Readonly<Record<MicrophoneRefusal, string>> = {
  'no-microphone': "Highwing can't find a microphone. Connect one, then try again.",
  'not-allowed': "Highwing isn't allowed to use the microphone. Allow it in your system's privacy settings, then try again.",
  failed: "Highwing couldn't start the microphone. Try again."
}
export const NO_WORDS = "Hermes didn't hear any words. Try again, a little closer to the microphone."

type At<A extends Dictation['at']> = Extract<Dictation, { at: A }>
type On<E extends DictationEvent['do']> = Extract<DictationEvent, { do: E }>

const notice = (words: string): Dictation => ({ at: 'idle', notice: words })
const drop = (): Dictation => IDLE

/** Every move. A state with no row for an event ignores it. */
const MOVES: { readonly [A in Dictation['at']]: { readonly [E in DictationEvent['do']]?: (state: At<A>, event: On<E>) => Dictation | null } } = {
  idle: {
    press: (_, { at }) => ({ at: 'asking', since: at }),
    cancel: state => (state.notice === null ? null : IDLE)
  },
  asking: {
    granted: ({ since }) => ({ at: 'recording', since }),
    refused: (_, { why }) => notice(REFUSAL_WORDS[why]),
    failed: (_, { message }) => notice(message),
    cancel: drop
  },
  recording: {
    press: () => ({ at: 'transcribing' }),
    release: ({ since }, { at }) => (at - since >= HOLD_MS ? { at: 'transcribing' } : null),
    failed: (_, { message }) => notice(message),
    cancel: drop
  },
  transcribing: {
    transcribed: (_, { text }) => (text.trim() === '' ? notice(NO_WORDS) : IDLE),
    failed: (_, { message }) => notice(message),
    cancel: drop
  }
}

/** The state after `event`, or null when the state ignores it. */
export function nextDictation(state: Dictation, event: DictationEvent): Dictation | null {
  const move = MOVES[state.at][event.do] as ((state: Dictation, event: DictationEvent) => Dictation | null) | undefined
  return move?.(state, event) ?? null
}

/** Why `getUserMedia` refused, by the names the Media Capture spec gives its errors. */
export function microphoneRefusal(error: unknown): MicrophoneRefusal {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-microphone'
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'not-allowed'
  return 'failed'
}

/** `words` in place of `text`'s selection from `start` to `end`, set off by a space from any word it would touch. */
export function inserted(text: string, start: number, end: number, words: string): { readonly text: string; readonly caret: number } {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const lead = before === '' || /\s$/.test(before) ? '' : ' '
  const trail = after === '' || /^\s/.test(after) ? '' : ' '
  const put = `${lead}${words.trim()}${trail}`
  return { text: `${before}${put}${after}`, caret: before.length + lead.length + words.trim().length }
}
