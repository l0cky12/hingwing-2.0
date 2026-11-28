import type { CallHermes, HermesAsk, HttpAnswer } from '@highwing/hermes'
import type { BotId, RoutineId } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { readRoutineRuns } from '../src/main/routine-runs'

const answering = (answer: HttpAnswer | Error): CallHermes => async () => {
  if (answer instanceof Error) throw answer
  return answer
}

const BOT = 'rae' as BotId
const ROUTINE = '4f1c2a9e0b7d' as RoutineId
const RUNS = { runs: [{ id: 'local-s1', source: 'cron', started_at: 1000, ended_at: 1042, end_reason: 'cron_complete', is_active: false, title: 'Morning digest', chat_id: 'private' }], limit: 20 }
const REFUSALS = {
  none: { kind: 'unsupported', message: "This Hermes can't show a routine's past runs to Highwing." },
  unreached: { kind: 'offline', message: "Highwing couldn't reach Hermes for this routine's runs." },
  unreadable: { kind: 'unsupported', message: "Hermes answered with runs Highwing can't read." }
} as const

describe('readRoutineRuns', () => {
  it('answers the runs Hermes sent, as the list draws them', async () => {
    expect(await readRoutineRuns(answering({ status: 200, body: RUNS }), BOT, ROUTINE)).toEqual({
      ok: true,
      value: [{ key: 'local-s1', outcome: { is: 'succeeded' }, at: 1_000_000, seconds: 42, chat: 'local-s1', owner: null }]
    })
  })

  it('answers an empty list for a routine that never ran', async () => {
    expect(await readRoutineRuns(answering({ status: 200, body: { runs: [], limit: 20 } }), BOT, ROUTINE)).toEqual({ ok: true, value: [] })
  })

  it("asks for the routine's newest runs in the bot's profile", async () => {
    const asked: HermesAsk[] = []
    await readRoutineRuns(async ask => (asked.push(ask), { status: 404, body: null }), BOT, ROUTINE)
    expect(asked).toEqual([{ method: 'GET', path: '/api/cron/jobs/4f1c2a9e0b7d/runs?limit=20', profile: 'rae' }])
  })

  it.each<[string, HttpAnswer | Error, keyof typeof REFUSALS]>([
    ['a 404, as a Hermes without the route answers', { status: 404, body: { detail: 'Not Found' } }, 'none'],
    ['a 401', { status: 401, body: null }, 'unreached'],
    ['a 500', { status: 500, body: null }, 'unreached'],
    ['no answer', new Error('connect ECONNREFUSED'), 'unreached'],
    ['a body that is no run list', { status: 200, body: { runs: 'x' } }, 'unreadable'],
    ['a reply that was not JSON', { status: 200, body: null }, 'unreadable']
  ])('refuses %s in plain words', async (_what, answer, refusal) => {
    expect(await readRoutineRuns(answering(answer), BOT, ROUTINE)).toEqual({ ok: false, refusal: REFUSALS[refusal] })
  })
})
