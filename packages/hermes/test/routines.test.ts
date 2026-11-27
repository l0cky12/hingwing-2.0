import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { scriptedDialer, type CronScript, type Fixture } from '../src/testing/fixture'
import { parseRoutines } from '../src/wire/parse'
import { BOUND, callsIn, SESSION, WITH_BOTS } from './support/errand'

const RESEARCH = 'research' as BotId
const DEFAULT = 'default' as BotId

const DIGEST = { job_id: 'a1', name: 'Morning digest', schedule: '0 9 * * 1-5', enabled: true, state: 'scheduled', next_run_at: '2026-11-27T09:00:00+00:00' }
const BACKUP = { job_id: 'b2', name: 'Backup check', schedule: 'every 60m', enabled: false, state: 'paused', next_run_at: null }
const SHARED = [
  { job_id: 'c3', name: '[bot:research] Paper alerts', schedule: 'every 1440m', enabled: true, state: 'scheduled' },
  { job_id: 'd4', name: 'Inbox sweep', schedule: 'every 30m', enabled: true, state: 'scheduled' },
  { job_id: 'e5', name: '[bot:dr-eggbot] Recipe of the day', schedule: '0 8 * * *', enabled: true, state: 'scheduled' }
]

const withCron = (cron: CronScript, base: Fixture = WITH_BOTS): Fixture => ({ ...base, header: { ...base.header, cron } })

async function launched(fixture: Fixture) {
  const clock = manualClock()
  const script = scriptedDialer(fixture, { clock })
  const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  return { clock, hermes, calls: (method: string) => callsIn(script.received).filter(call => call.method === method) }
}

describe('listRoutines through the hub', () => {
  it("lists the bot's own store, paused jobs included, asking with the bot's profile", async () => {
    const { hermes, calls } = await launched(withCron({ jobs: [], profiles: { research: [DIGEST, BACKUP] } }))
    expect(await hermes.run({ do: 'listRoutines', bot: RESEARCH })).toEqual({
      ok: true,
      value: [
        { id: 'a1', name: 'Morning digest', schedule: '0 9 * * 1-5', paused: false, nextRunAt: '2026-11-27T09:00:00+00:00' },
        { id: 'b2', name: 'Backup check', schedule: 'every 60m', paused: true, nextRunAt: null }
      ]
    })
    expect(calls('cron.manage')).toEqual([{ method: 'cron.manage', params: { action: 'list', include_disabled: true, profile: 'research' } }])
  })

  it('keeps only the jobs tagged for the bot, and the untagged ones for the default bot, on a Hermes that cannot scope the list', async () => {
    const { hermes } = await launched(withCron({ jobs: SHARED, unscoped: true }))
    expect(await hermes.run({ do: 'listRoutines', bot: RESEARCH })).toMatchObject({ ok: true, value: [{ id: 'c3', name: 'Paper alerts' }] })
    expect(await hermes.run({ do: 'listRoutines', bot: DEFAULT })).toMatchObject({ ok: true, value: [{ id: 'd4', name: 'Inbox sweep' }] })
  })

  it('answers an empty list for a bot with no jobs', async () => {
    const { hermes } = await launched(withCron({ jobs: [DIGEST] }))
    expect(await hermes.run({ do: 'listRoutines', bot: RESEARCH })).toEqual({ ok: true, value: [] })
  })

  it('is unsupported on a Hermes with no cron.manage, and on a socket with no interactive grant', async () => {
    for (const fixture of [WITH_BOTS, withCron({ jobs: [DIGEST] }, BOUND)]) {
      const { hermes } = await launched(fixture)
      expect(await hermes.run({ do: 'listRoutines', bot: DEFAULT })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't show routines to Highwing." } })
    }
  })

  it('counts a new socket and every cron.changed in routines, so a window asks again', async () => {
    const changed = { at: 1000, push: { jsonrpc: '2.0', method: 'event', params: { type: 'cron.changed', payload: {} } } }
    const { clock, hermes } = await launched({ ...withCron({ jobs: [] }), steps: [changed] })
    expect(hermes.routines.get(), 'the first socket counts').toBe(1)
    hermes.watch(SESSION, () => {})
    await clock.advance(1000)
    expect(hermes.routines.get()).toBe(2)
  })
})

describe('parseRoutines', () => {
  it('names a job by its id when Hermes gives it no name, and reads an older row with no state by enabled', () => {
    expect(parseRoutines({ jobs: [{ job_id: 'x9', name: '[bot:research] ', enabled: false }], scoped: 'Research' }, RESEARCH)).toEqual({
      ok: true, value: [{ id: 'x9', name: 'x9', schedule: '', paused: true, nextRunAt: null }]
    })
  })

  it('drops a row it cannot use and keeps the rest', () => {
    expect(parseRoutines({ jobs: [{ name: 'no id' } as never, DIGEST], scoped: 'research' }, RESEARCH)).toMatchObject({ ok: true, value: [{ id: 'a1' }] })
  })

  it("refuses with Hermes's words when the cron tool failed, with or without a success flag", () => {
    for (const reply of [{ success: false, error: 'jobs.json is unreadable' }, { error: 'jobs.json is unreadable' }]) {
      expect(parseRoutines(reply, RESEARCH)).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes couldn't list the routines: jobs.json is unreadable" } })
    }
  })
})
