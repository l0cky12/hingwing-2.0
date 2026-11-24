import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ContextBreakdown, Outcome } from '../src/domain/command'
import type { Session } from '../src/domain/session'
import { play, playToEnd, type Fixture } from '../src/testing/fixture'
import { callsIn, ERRAND, SESSION } from './support/errand'

type Canned = NonNullable<Fixture['header']['usage']>
const canned = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../fixtures/usage/${name}.json`, import.meta.url)), 'utf8')) as Canned
const USAGE = canned('errand')
const WITH_USAGE: Fixture = { ...ERRAND, header: { ...ERRAND.header, usage: USAGE } }

async function breakdownAt(fixture: Fixture, when: (session: Session) => boolean) {
  let result: Promise<Outcome<ContextBreakdown>> | null = null
  let received: readonly unknown[] = []
  for await (const { hermes, session, script } of play(fixture)) {
    if (when(session)) result ??= hermes.run({ do: 'contextBreakdown', sessionId: SESSION })
    received = script.received
  }
  return { outcome: await result, received }
}

describe('token usage through the scripted gateway', () => {
  it('shows the context fill the gateway answers before the first message', async () => {
    const seen: Session[] = []
    for await (const { session } of play(WITH_USAGE)) seen.push(session)
    const first = seen.find(session => session.usage.context !== null)
    expect(first?.history).toEqual([])
    expect(first?.usage).toEqual({ totals: { input: 0, output: 0, reasoning: 0 }, context: { used: 6000, max: 200_000, percent: 3, estimated: true } })
  })

  it('ends with the percent the gateway\'s breakdown names, and the reply holding the tokens its turn used', async () => {
    const session = await playToEnd(WITH_USAGE)
    expect(session.usage.context?.percent).toBe(USAGE.breakdown.context_percent)
    expect(session.usage.context).toEqual({ used: 68_000, max: 200_000, percent: 34, estimated: true })
    expect(session.history.map(turn => turn.tokens)).toEqual([{ input: 1204, output: 380, reasoning: 412 }])
  })

  it('answers what fills the window when asked', async () => {
    const { outcome, received } = await breakdownAt(WITH_USAGE, session => session.sync.state === 'live' && session.history.length === 1)
    expect(outcome).toEqual({
      ok: true,
      value: {
        model: 'fast-small', used: 68_000, max: 200_000, percent: 34, estimated: true,
        categories: [
          { id: 'system_prompt', label: 'System', tokens: 6000 },
          { id: 'tool_definitions', label: 'Tools', tokens: 11_000 },
          { id: 'conversation', label: 'Messages', tokens: 51_000 }
        ]
      }
    })
    expect(callsIn(received).filter(call => call.method === 'session.context_breakdown').map(call => call.params)).toEqual([{ session_id: SESSION }])
  })

  it('holds no figures for a Hermes that answers neither call, and plays the errand to its end', async () => {
    const { outcome } = await breakdownAt(ERRAND, session => session.sync.state === 'live')
    expect(outcome).toMatchObject({ ok: false, refusal: { kind: 'unsupported' } })
    const session = await playToEnd(ERRAND)
    expect(session.usage).toEqual({ totals: null, context: null })
    expect(session.history.map(turn => turn.tokens)).toEqual([null])
  })

  it('keeps the tokens and the fill through a dropped socket and its replay', async () => {
    const session = await playToEnd(WITH_USAGE, { drop: { afterPush: 12, missed: 6 } })
    expect(session.history.map(turn => turn.tokens)).toEqual([{ input: 1204, output: 380, reasoning: 412 }])
    expect(session.usage.context?.percent).toBe(34)
  })
})
