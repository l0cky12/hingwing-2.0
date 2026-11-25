import { describe, expect, it } from 'vitest'
import type { Outcome } from '../src/domain/command'
import { activityOf } from '../src/domain/reduce'
import type { Session } from '../src/domain/session'
import type { Hermes } from '../src/hub'
import { play, type Fixture, type Moment } from '../src/testing/fixture'
import { callsIn, ERRAND, SESSION } from './support/errand'

const withYolo = (header: Partial<Fixture['header']> = {}): Fixture => ({ ...ERRAND, header: { ...ERRAND.header, yolo: false, ...header } })

const setYolo = (hermes: Hermes, on: boolean) => hermes.run({ do: 'setYolo', sessionId: SESSION, on })
const sets = (moment: Moment) => callsIn(moment.script.received).filter(call => call.method === 'config.set')

async function playWith<T>(fixture: Fixture, at: (moment: Moment) => Promise<T> | null): Promise<{ last: Moment; seen: Session[]; result: Promise<T> | null }> {
  let last: Moment | undefined
  let result: Promise<T> | null = null
  const seen: Session[] = []
  for await (const moment of play(fixture)) {
    last = moment
    seen.push(moment.session)
    result ??= at(moment)
  }
  if (last === undefined) throw new Error('the play published no session')
  return { last, seen, result }
}

describe('switching a chat\'s YOLO through the scripted gateway', () => {
  it('turns it on and off with one config.set each, naming this chat and no scope', async () => {
    const { last, seen, result } = await playWith(withYolo(), ({ hermes, session }) =>
      session.sync.state === 'live' && session.run.state === 'idle' && session.history.length === 0
        ? setYolo(hermes, true).then(async on => ({ on, off: await setYolo(hermes, false) }))
        : null)
    const { on, off } = (await result)!
    expect(on).toEqual<Outcome>({ ok: true, value: undefined })
    expect(off).toEqual<Outcome>({ ok: true, value: undefined })
    expect(seen.some(session => session.yolo === true)).toBe(true)
    expect(sets(last).map(call => call.params)).toEqual([
      { session_id: SESSION, key: 'yolo', value: 'on' },
      { session_id: SESSION, key: 'yolo', value: 'off' }
    ])
    expect(last.session.yolo).toBe(false)
  })

  it('leaves an approval card waiting when it turns on', async () => {
    const { seen, result } = await playWith(withYolo(), ({ hermes, session }) => (activityOf(session).kind === 'asking' ? setYolo(hermes, true) : null))
    expect(await result).toEqual({ ok: true, value: undefined })
    const on = seen.find(session => session.yolo === true)
    expect(on).toBeDefined()
    expect(activityOf(on!).kind).toBe('asking')
  })

  it('starts from what the attach reply says', async () => {
    const { seen } = await playWith(withYolo({ yolo: true }), () => null)
    expect(seen.find(session => session.sync.state === 'live')?.yolo).toBe(true)
  })

  it('shows no state and refuses the switch as unsupported when Hermes takes no such key', async () => {
    const { last, result } = await playWith(ERRAND, ({ hermes, session }) => (session.sync.state === 'live' ? setYolo(hermes, true) : null))
    expect(await result).toMatchObject({ ok: false, refusal: { kind: 'unsupported' } })
    expect(last.session.yolo).toBeNull()
    expect(last.script.finished).toBe(true)
  })

  it('shows Hermes\'s refusal and keeps the state when it refuses the viewer', async () => {
    const { last, result } = await playWith(withYolo({ yoloDenied: true }), ({ hermes, session }) => (session.sync.state === 'live' ? setYolo(hermes, true) : null))
    expect(await result).toEqual({ ok: false, refusal: { kind: 'not-attached', message: "Hermes won't let Highwing do that in this chat." } })
    expect(last.session.yolo).toBe(false)
  })
})
