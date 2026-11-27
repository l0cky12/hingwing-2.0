import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import { scheduleInWords, type Routines } from '../src/domain/routines'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { scriptedDialer, type CronScript, type Fixture } from '../src/testing/fixture'
import { parseRoutines } from '../src/wire/parse'
import { BOUND, callsIn, WITH_BOTS } from './support/errand'

const RESEARCH = 'research' as BotId
const SCRIPT = JSON.parse(readFileSync(fileURLToPath(new URL('../../../fixtures/cron/research.json', import.meta.url)), 'utf8')) as CronScript
const withCron = (cron: CronScript, base: Fixture = WITH_BOTS): Fixture => ({ ...base, header: { ...base.header, cron } })

function open(fixture: Fixture) {
  const clock = manualClock()
  const script = scriptedDialer(fixture, { clock })
  const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  const seen: Routines[] = []
  hermes.routines.subscribe(next => seen.push(next))
  const reads = () => callsIn(script.received).filter(call => call.method === 'cron.manage')
  return { clock, hermes, seen, reads }
}

const namesIn = (routines: Routines) => (routines?.list.state === 'listed' ? routines.list.routines.map(routine => routine.name) : routines?.list.state)

describe('scheduleInWords', () => {
  it.each([
    ['every 1m', 'Every minute'],
    ['every 30m', 'Every 30 minutes'],
    ['every 60m', 'Every hour'],
    ['every 360m', 'Every 6 hours'],
    ['every 1440m', 'Every day'],
    ['every 2880m', 'Every 2 days'],
    ['0 9 * * *', 'Every day at 09:00'],
    ['30 7 * * 1-5', 'Weekdays at 07:30'],
    ['0 10 * * 6,0', 'Weekends at 10:00'],
    ['0 9 * * 5,1', 'Every Monday and Friday at 09:00'],
    ['0 9 * * 7', 'Every Sunday at 09:00'],
    ['0 * * * *', 'Every hour'],
    ['15 * * * *', 'Every hour at :15'],
    ['*/10 * * * *', 'Every 10 minutes'],
    ['0 */4 * * *', 'Every 4 hours'],
    ['once at 2026-12-01 09:00', 'Once, at 2026-12-01 09:00'],
    ['once in 2h', 'Once'],
    ['every monday 9am', 'Every monday 9am'],
    ['0 25 * * *', '0 25 * * *'],
    ['5 4 1 * *', '5 4 1 * *'],
    ['', 'No schedule']
  ])('says %j as %j', (display, words) => expect(scheduleInWords(display)).toBe(words))
})

describe('parseRoutines', () => {
  const row = (job_id: string, name: string, more: object = {}) => ({ job_id, name, schedule: 'every 30m', enabled: true, ...more })

  it('lists a scoped store whole, with the bot tag taken off each name and paused read from enabled', () => {
    expect(parseRoutines({ success: true, scoped: 'research', jobs: [row('a', '[bot:research] Digest'), row('b', 'Sweep', { enabled: false })] }, RESEARCH)).toEqual({
      state: 'listed',
      routines: [{ id: 'a', name: 'Digest', schedule: 'Every 30 minutes', paused: false }, { id: 'b', name: 'Sweep', schedule: 'Every 30 minutes', paused: true }]
    })
  })

  it("keeps only this bot's tagged rows from an unscoped store, and gives untagged rows to the default bot", () => {
    const jobs = [row('a', '[bot:research] Digest'), row('b', '[BOT:writer] Draft'), row('c', 'Untagged')]
    expect(namesIn({ bot: RESEARCH, list: parseRoutines({ jobs }, RESEARCH) })).toEqual(['Digest'])
    expect(namesIn({ bot: 'default' as BotId, list: parseRoutines({ jobs }, 'default' as BotId) })).toEqual(['Untagged'])
  })

  it('names a row by its prompt or id when it has no name, and skips a row with no id', () => {
    const listed = parseRoutines({ scoped: 'research', jobs: [{ job_id: 'a', prompt_preview: 'Check mail' }, { job_id: 'b' }, { name: 'No id' }] as never }, RESEARCH)
    expect(namesIn({ bot: RESEARCH, list: listed })).toEqual(['Check mail', 'b'])
  })

  it("refuses with Hermes's words when the tool failed", () => {
    expect(parseRoutines({ success: false, error: 'jobs.json is locked' }, RESEARCH)).toEqual({ state: 'refused', message: "Hermes couldn't read the routines: jobs.json is locked" })
  })
})

describe('the routines feed', () => {
  it("reads a bot's routines when shown, again on cron.changed, and stops when hidden", async () => {
    const { clock, hermes, seen, reads } = open(withCron(SCRIPT))
    await clock.advance(0)
    await hermes.run({ do: 'showRoutines', bot: RESEARCH })
    expect(namesIn(hermes.routines.get())).toBe('reading')
    await clock.advance(0)
    expect(namesIn(hermes.routines.get())).toEqual(['Morning brief', 'Backup check'])
    expect(reads().map(call => call.params)).toEqual([{ action: 'list', include_disabled: true, profile: 'research' }])

    await clock.advance(1500)
    expect(namesIn(hermes.routines.get())).toEqual(['Morning brief', 'Backup check', 'Inbox sweep'])
    expect(seen.map(namesIn).filter(state => state === 'reading')).toHaveLength(1)

    await hermes.run({ do: 'showRoutines', bot: null })
    expect(hermes.routines.get()).toBeNull()
  })

  it('shows an empty list for a bot with no jobs', async () => {
    const { clock, hermes } = open(withCron(SCRIPT))
    await clock.advance(0)
    await hermes.run({ do: 'showRoutines', bot: 'timothy' as BotId })
    await clock.advance(0)
    expect(hermes.routines.get()).toEqual({ bot: 'timothy', list: { state: 'listed', routines: [] } })
  })

  it('drops a reply for a bot no longer shown', async () => {
    const { clock, hermes } = open(withCron(SCRIPT))
    await clock.advance(0)
    await hermes.run({ do: 'showRoutines', bot: RESEARCH })
    await hermes.run({ do: 'showRoutines', bot: 'timothy' as BotId })
    await clock.advance(0)
    expect(hermes.routines.get()).toEqual({ bot: 'timothy', list: { state: 'listed', routines: [] } })
  })

  it('says a Hermes without cron.manage cannot list routines, and so does a socket bound to one profile', async () => {
    const refused = { state: 'refused', message: "This Hermes can't list routines for Highwing. Update Hermes on that machine, then reconnect." }
    for (const fixture of [WITH_BOTS, withCron(SCRIPT, BOUND)]) {
      const { clock, hermes } = open(fixture)
      await clock.advance(0)
      await hermes.run({ do: 'showRoutines', bot: fixture === WITH_BOTS ? RESEARCH : ('default' as BotId) })
      await clock.advance(0)
      expect(hermes.routines.get()?.list).toEqual(refused)
    }
  })
})
