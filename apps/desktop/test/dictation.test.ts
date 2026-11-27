import { describe, expect, it } from 'vitest'
import {
  HOLD_MS, IDLE, inserted, microphoneRefusal, nextDictation, NO_WORDS, REFUSAL_WORDS, type Dictation, type DictationEvent
} from '../src/renderer/composer/dictation'

const run = (events: readonly DictationEvent[], from: Dictation = IDLE): Dictation =>
  events.reduce<Dictation>((state, event) => nextDictation(state, event) ?? state, from)

const STARTED = [{ do: 'press', at: 1000 }, { do: 'granted' }] as const

describe('nextDictation', () => {
  it('starts on a press, records once the microphone opens, and stops on the next press', () => {
    expect(run([{ do: 'press', at: 1000 }])).toEqual({ at: 'asking', since: 1000 })
    expect(run(STARTED)).toEqual({ at: 'recording', since: 1000 })
    expect(run([...STARTED, { do: 'press', at: 5000 }])).toEqual({ at: 'transcribing' })
  })

  it('keeps recording after a quick tap of the keys, and stops when keys held to talk come up', () => {
    expect(run([...STARTED, { do: 'release', at: 1000 + HOLD_MS - 1 }])).toEqual({ at: 'recording', since: 1000 })
    expect(run([...STARTED, { do: 'release', at: 1000 + HOLD_MS }])).toEqual({ at: 'transcribing' })
  })

  it('ends idle with the text, and says so when Hermes heard no words', () => {
    const heard = [...STARTED, { do: 'press', at: 3000 }] as const
    expect(run([...heard, { do: 'transcribed', text: 'book a table' }])).toEqual(IDLE)
    expect(run([...heard, { do: 'transcribed', text: '  ' }])).toEqual({ at: 'idle', notice: NO_WORDS })
  })

  it.each(Object.entries(REFUSAL_WORDS))('shows plain words when the microphone is refused as %s', (why, words) => {
    expect(run([{ do: 'press', at: 0 }, { do: 'refused', why: why as keyof typeof REFUSAL_WORDS }])).toEqual({ at: 'idle', notice: words })
  })

  it("shows Hermes's words when it cannot transcribe, and clears them on the next press", () => {
    const failed = run([...STARTED, { do: 'press', at: 3000 }, { do: 'failed', message: "Hermes couldn't turn that into text." }])
    expect(failed).toEqual({ at: 'idle', notice: "Hermes couldn't turn that into text." })
    expect(run([{ do: 'press', at: 9000 }], failed)).toEqual({ at: 'asking', since: 9000 })
  })

  it('drops what was heard on a cancel, from any state', () => {
    for (const state of [run([{ do: 'press', at: 0 }]), run(STARTED), run([...STARTED, { do: 'press', at: 3000 }]), { at: 'idle', notice: NO_WORDS } as const]) {
      expect(nextDictation(state, { do: 'cancel' })).toEqual(IDLE)
    }
  })

  it('ignores an event the state has no use for', () => {
    const transcribing = run([...STARTED, { do: 'press', at: 3000 }])
    expect(nextDictation(transcribing, { do: 'press', at: 4000 }), 'a press while Hermes transcribes').toBeNull()
    expect(nextDictation(run([{ do: 'press', at: 0 }]), { do: 'press', at: 10 }), 'a second press while the microphone opens').toBeNull()
    expect(nextDictation(IDLE, { do: 'release', at: 0 })).toBeNull()
    expect(nextDictation(IDLE, { do: 'transcribed', text: 'late' }), 'text that arrives after a cancel').toBeNull()
    expect(nextDictation(IDLE, { do: 'cancel' })).toBeNull()
  })
})

describe('microphoneRefusal', () => {
  it.each([
    ['NotFoundError', 'no-microphone'], ['OverconstrainedError', 'no-microphone'],
    ['NotAllowedError', 'not-allowed'], ['SecurityError', 'not-allowed'], ['NotReadableError', 'failed']
  ] as const)('reads %s as %s', (name, why) => {
    expect(microphoneRefusal(new DOMException('', name))).toBe(why)
  })
})

describe('inserted', () => {
  it('puts the words at the caret, set off by a space from the words beside it', () => {
    expect(inserted('Book for two', 4, 4, 'a table')).toEqual({ text: 'Book a table for two', caret: 12 })
    expect(inserted('', 0, 0, ' hello ')).toEqual({ text: 'hello', caret: 5 })
    expect(inserted('Hi ', 3, 3, 'there')).toEqual({ text: 'Hi there', caret: 8 })
  })

  it('replaces the selection', () => {
    expect(inserted('Book a chair now', 7, 12, 'table')).toEqual({ text: 'Book a table now', caret: 12 })
  })
})
