import { describe, expect, it } from 'vitest'
import type { Outcome } from '../src/domain/command'
import { activityOf } from '../src/domain/reduce'
import type { Session } from '../src/domain/session'
import type { Hermes } from '../src/hub'
import { play, type Fixture, type Moment } from '../src/testing/fixture'
import { callsIn, ERRAND, SESSION } from './support/errand'

const withYolo = (header: Partial<Fixture['header']> = {}): Fixture => ({ ...ERRAND, header: { ...ERRAND.header, yolo: false, ...header } })

const turnYolo = (hermes: Hermes, on: boolean) => hermes.run({ do: 'tune', sessionId: SESSION, set: 'yolo', on })
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
        ? turnYolo(hermes, true).then(async on => ({ on, off: await turnYolo(hermes, false) }))
        : null)
    const { on, off } = (await result)!
    expect(on).toEqual<Outcome>({ ok: true, value: undefined })
    expect(off).toEqual<Outcome>({ ok: true, value: undefined })
    expect(seen.some(session => session.tuning.yolo === true)).toBe(true)
    expect(sets(last).map(call => call.params)).toEqual([
      { session_id: SESSION, key: 'yolo', value: 'on' },
      { session_id: SESSION, key: 'yolo', value: 'off' }
    ])
    expect(last.session.tuning.yolo).toBe(false)
  })

  it('leaves an approval card waiting when it turns on', async () => {
    const { seen, result } = await playWith(withYolo(), ({ hermes, session }) => (activityOf(session).kind === 'asking' ? turnYolo(hermes, true) : null))
    expect(await result).toEqual({ ok: true, value: undefined })
    const on = seen.find(session => session.tuning.yolo === true)
    expect(on).toBeDefined()
    expect(activityOf(on!).kind).toBe('asking')
  })

  it('starts from what the attach reply says', async () => {
    const { seen } = await playWith(withYolo({ yolo: true }), () => null)
    expect(seen.find(session => session.sync.state === 'live')?.tuning.yolo).toBe(true)
  })

  it('shows no state and refuses the switch as unsupported when Hermes takes no such key', async () => {
    const { last, result } = await playWith(ERRAND, ({ hermes, session }) => (session.sync.state === 'live' ? turnYolo(hermes, true) : null))
    expect(await result).toMatchObject({ ok: false, refusal: { kind: 'unsupported' } })
    expect(last.session.tuning.yolo).toBeNull()
    expect(last.script.finished).toBe(true)
  })

  it('shows Hermes\'s refusal and keeps the state when it refuses the viewer', async () => {
    const { last, result } = await playWith(withYolo({ yoloDenied: true }), ({ hermes, session }) => (session.sync.state === 'live' ? turnYolo(hermes, true) : null))
    expect(await result).toEqual({ ok: false, refusal: { kind: 'not-attached', message: "Hermes won't let Highwing do that in this chat." } })
    expect(last.session.tuning.yolo).toBe(false)
  })
})

describe('the bot\'s approval mode', () => {
  const live = (seen: readonly Session[]) => seen.findLast(session => session.sync.state === 'live')
  const watched = (header: Partial<Fixture['header']>) => playWith(withYolo(header), () => null)

  it('is read with config.get once the chat is live, beside the chat\'s own YOLO', async () => {
    const { last, seen } = await watched({ approvals: 'smart' })
    expect(live(seen)?.tuning).toMatchObject({ approvals: 'smart', yolo: false })
    expect(callsIn(last.script.received).filter(call => call.method === 'config.get' && call.params?.key === 'approval_mode')).toHaveLength(1)
  })

  it('reads a bot on off as off, while the chat\'s own flag stays false as Hermes says it', async () => {
    const { seen } = await watched({ approvals: 'off' })
    expect(live(seen)?.tuning).toMatchObject({ approvals: 'off', yolo: false })
  })

  it('moves the bot to Smart with one config.set of approval_mode', async () => {
    const { last, result } = await playWith(withYolo({ approvals: 'off' }), ({ hermes, session }) =>
      session.sync.state === 'live' && session.tuning.approvals === 'off' && session.run.state === 'idle' && session.history.length === 0
        ? hermes.run({ do: 'tune', sessionId: SESSION, set: 'approvals', to: 'smart' })
        : null)
    expect(await result).toEqual({ ok: true, value: undefined })
    expect(sets(last).map(call => call.params)).toEqual([{ session_id: SESSION, key: 'approval_mode', value: 'smart' }])
    expect(last.session.tuning).toMatchObject({ approvals: 'smart', yolo: false })
  })

  it.each(['off', 'manual'] as const)('moves a bot on Smart to %s with one config.set of approval_mode', async to => {
    const { last, result } = await playWith(withYolo({ approvals: 'smart' }), ({ hermes, session }) =>
      session.sync.state === 'live' && session.tuning.approvals === 'smart' && session.run.state === 'idle' && session.history.length === 0
        ? hermes.run({ do: 'tune', sessionId: SESSION, set: 'approvals', to })
        : null)
    expect(await result).toEqual({ ok: true, value: undefined })
    expect(sets(last).map(call => call.params)).toEqual([{ session_id: SESSION, key: 'approval_mode', value: to }])
    expect(last.session.tuning).toMatchObject({ approvals: to, yolo: false })
  })

  it('names no mode when Hermes refuses the read', async () => {
    const { seen } = await watched({})
    expect(live(seen)?.tuning.approvals).toBeNull()
  })
})
