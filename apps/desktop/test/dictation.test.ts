import { describe, expect, it } from 'vitest'
import type { CommandOutcome, Recording } from '@highwing/hermes/domain'
import {
  dictationDriver, HOLD_MS, IDLE, inserted, microphoneRefusal, nextDictation, NO_WORDS, REFUSAL_WORDS, type Dictation, type DictationEvent, type Take
} from '../src/renderer/composer/dictation'

const run = (events: readonly DictationEvent[], from: Dictation = IDLE): Dictation =>
  events.reduce<Dictation>((state, event) => nextDictation(state, event) ?? state, from)

const STARTED = [{ do: 'press', at: 1000 }, { do: 'granted' }] as const

describe('nextDictation', () => {
  it('starts on a press, records once the microphone opens, and stops on the next press', () => {
    expect(run([{ do: 'press', at: 1000 }])).toEqual({ at: 'asking', since: 1000, letGo: false })
    expect(run(STARTED)).toEqual({ at: 'recording', since: 1000 })
    expect(run([...STARTED, { do: 'press', at: 5000 }])).toEqual({ at: 'transcribing' })
  })

  it('keeps recording after a quick tap of the keys, and stops when keys held to talk come up', () => {
    expect(run([...STARTED, { do: 'release', at: 1000 + HOLD_MS - 1 }])).toEqual({ at: 'recording', since: 1000 })
    expect(run([...STARTED, { do: 'release', at: 1000 + HOLD_MS }])).toEqual({ at: 'transcribing' })
  })

  it('stops as soon as the microphone opens when keys held to talk came up while it was opening', () => {
    const opening = [{ do: 'press', at: 1000 }, { do: 'release', at: 1000 + HOLD_MS }] as const
    expect(run(opening)).toEqual({ at: 'asking', since: 1000, letGo: true })
    expect(run([...opening, { do: 'granted' }])).toEqual({ at: 'transcribing' })
    expect(run([{ do: 'press', at: 1000 }, { do: 'release', at: 1100 }, { do: 'granted' }]), 'a tap still toggles').toEqual({ at: 'recording', since: 1000 })
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
    expect(run([{ do: 'press', at: 9000 }], failed)).toEqual({ at: 'asking', since: 9000, letGo: false })
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

/** A promise and the hands that settle it, so a test decides when the microphone opens or Hermes answers. */
function pending<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const HEARD: Recording = { mime: 'audio/webm;codecs=opus', audio: new Uint8Array([1, 2, 3]) }
const settle = () => new Promise(resolve => setImmediate(resolve))

function rig(heard: Recording | null = HEARD) {
  const opens: ReturnType<typeof pending<Take>>[] = []
  const answers: ReturnType<typeof pending<CommandOutcome<string>>>[] = []
  const log: string[] = []
  const states: Dictation[] = []
  const texts: string[] = []
  const move = dictationDriver({
    listen: () => {
      const open = pending<Take>()
      opens.push(open)
      return open.promise
    },
    transcribe: recording => {
      log.push(`transcribe ${recording.audio.byteLength} bytes`)
      const answer = pending<CommandOutcome<string>>()
      answers.push(answer)
      return answer.promise
    },
    onChange: state => states.push(state),
    onText: text => texts.push(text)
  })
  const take: Take = { stop: async () => (log.push('stop'), heard), drop: () => void log.push('drop') }
  return { move, opens, answers, log, states, texts, take, now: () => states.at(-1) ?? IDLE }
}

describe('dictationDriver', () => {
  it('opens the microphone once, sends what it heard when stopped, and hands over the text', async () => {
    const { move, opens, answers, log, texts, take, now } = rig()
    move({ do: 'press', at: 0 })
    opens[0]!.resolve(take)
    await settle()
    expect(now()).toEqual({ at: 'recording', since: 0 })
    move({ do: 'press', at: 2000 })
    await settle()
    answers[0]!.resolve({ ok: true, value: 'book a table' })
    await settle()
    expect(log).toEqual(['stop', 'transcribe 3 bytes'])
    expect(texts).toEqual(['book a table'])
    expect(now()).toEqual(IDLE)
    expect(opens).toHaveLength(1)
  })

  it('stops as soon as the microphone opens when keys held to talk came up while it opened, with one open', async () => {
    const { move, opens, log, take, now } = rig(null)
    move({ do: 'press', at: 0 })
    move({ do: 'release', at: HOLD_MS })
    opens[0]!.resolve(take)
    await settle()
    expect(opens, 'a release while it opens asks for no second microphone').toHaveLength(1)
    expect(log).toEqual(['stop'])
    expect(now()).toEqual({ at: 'idle', notice: NO_WORDS })
  })

  it('lets go of a microphone that opens after a cancel, and never records with it', async () => {
    const { move, opens, log, states, take } = rig()
    move({ do: 'press', at: 0 })
    move({ do: 'cancel' })
    opens[0]!.resolve(take)
    await settle()
    expect(log).toEqual(['drop'])
    expect(states.map(state => state.at)).toEqual(['asking', 'idle'])
  })

  it('says why the microphone was refused', async () => {
    const { move, opens, now } = rig()
    move({ do: 'press', at: 0 })
    opens[0]!.reject(new DOMException('Permission denied', 'NotAllowedError'))
    await settle()
    expect(now()).toEqual({ at: 'idle', notice: REFUSAL_WORDS['not-allowed'] })
  })

  it("shows Hermes's words, and drops a transcript that comes back after a cancel", async () => {
    const failing = rig()
    failing.move({ do: 'press', at: 0 })
    failing.opens[0]!.resolve(failing.take)
    await settle()
    failing.move({ do: 'press', at: 1000 })
    await settle()
    failing.answers[0]!.resolve({ ok: false, refusal: { kind: 'rejected', message: "Hermes couldn't turn that into text." } })
    await settle()
    expect(failing.now()).toEqual({ at: 'idle', notice: "Hermes couldn't turn that into text." })

    const late = rig()
    late.move({ do: 'press', at: 0 })
    late.opens[0]!.resolve(late.take)
    await settle()
    late.move({ do: 'press', at: 1000 })
    await settle()
    late.move({ do: 'cancel' })
    late.answers[0]!.resolve({ ok: true, value: 'too late' })
    await settle()
    expect(late.texts).toEqual([])
    expect(late.now()).toEqual(IDLE)
  })
})
