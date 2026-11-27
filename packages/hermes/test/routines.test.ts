import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { scriptedDialer, type Fixture } from '../src/testing/fixture'
import { parseRoutines } from '../src/wire/parse'
import { callsIn, WITH_BOTS } from './support/errand'

const RESEARCH = 'research' as BotId
const DAILY = { job_id: 'j1', name: 'Morning digest', schedule: '0 9 * * *', enabled: true, state: 'scheduled' }
const PAUSED = { job_id: 'j2', name: 'Citations', schedule: 'every 120m', enabled: false, state: 'paused' }
const WITH_CRON: Fixture = {
  ...WITH_BOTS,
  header: { ...WITH_BOTS.header, cron: { jobs: { research: [DAILY, PAUSED] }, later: { after_ms: 1000, jobs: { research: [{ ...DAILY, enabled: false, state: 'paused' }] } } } }
}

async function launched(fixture: Fixture) {
  const clock = manualClock()
  const script = scriptedDialer(fixture, { clock })
  const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  return { clock, hermes, calls: () => callsIn(script.received).filter(call => call.method === 'cron.manage') }
}

describe('routines through the hub', () => {
  it("lists the bot's own store, paused jobs included", async () => {
    const { hermes, calls } = await launched(WITH_CRON)
    expect(await hermes.run({ do: 'routines', bot: RESEARCH })).toEqual({
      ok: true,
      value: [
        { id: 'j1', name: 'Morning digest', schedule: '0 9 * * *', paused: false },
        { id: 'j2', name: 'Citations', schedule: 'every 120m', paused: true }
      ]
    })
    expect(calls()).toEqual([{ method: 'cron.manage', params: { action: 'list', include_disabled: true, profile: 'research' } }])
    expect(await hermes.run({ do: 'routines', bot: 'dr-eggbot' as BotId })).toEqual({ ok: true, value: [] })
  })

  it('moves the cron edition on cron.changed, and a new ask reads the changed store', async () => {
    const { clock, hermes } = await launched(WITH_CRON)
    await hermes.run({ do: 'routines', bot: RESEARCH })
    const before = hermes.cron.get()
    await clock.advance(1000)
    expect(hermes.cron.get()).toBe(before + 1)
    expect(await hermes.run({ do: 'routines', bot: RESEARCH })).toEqual({ ok: true, value: [{ id: 'j1', name: 'Morning digest', schedule: '0 9 * * *', paused: true }] })
  })

  it("says so when this Hermes can't list routines", async () => {
    expect(await (await launched(WITH_BOTS)).hermes.run({ do: 'routines', bot: RESEARCH })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't list routines." } })
  })
})

describe('parseRoutines', () => {
  const tagged = [
    { job_id: 'a', name: '[bot:research] Digest', schedule: 'every 60m' },
    { job_id: 'b', name: '[bot:Rae] Report', schedule: 'every 60m' },
    { job_id: 'c', name: 'Backup', schedule: 'every 60m' }
  ]

  it('keeps only the tagged jobs of the bot, without the tag, from a gateway that did not scope the store', () => {
    expect(parseRoutines({ jobs: tagged }, RESEARCH).map(routine => [routine.id, routine.name])).toEqual([['a', 'Digest']])
    expect(parseRoutines({ jobs: tagged }, 'rae' as BotId).map(routine => routine.id)).toEqual(['b'])
    expect(parseRoutines({ jobs: tagged }, 'default' as BotId).map(routine => routine.id)).toEqual(['c'])
  })

  it('keeps every job of a store scoped to the bot', () => {
    expect(parseRoutines({ jobs: tagged, scoped: 'research' }, RESEARCH).map(routine => routine.name)).toEqual(['Digest', 'Report', 'Backup'])
  })

  it('names a job with no name by its id, and skips a row with no id', () => {
    expect(parseRoutines({ jobs: [{ job_id: 'x', name: '' }, { name: 'no id' } as never], scoped: 'research' }, RESEARCH)).toEqual([{ id: 'x', name: 'x', schedule: '', paused: false }])
  })
})
