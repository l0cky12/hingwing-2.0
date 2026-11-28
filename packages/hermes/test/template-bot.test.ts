import { describe, expect, it } from 'vitest'
import type { TemplateAnswers } from '../src/domain/bot-templates'
import type { BotId } from '../src/domain/bots'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { parseAdded } from '../src/wire/parse'
import { scriptedDialer, type Fixture } from '../src/testing/fixture'
import { BOUND, callsIn, WITH_BOTS } from './support/errand'

const AUDITOR = { do: 'createFromTemplate', template: 'nightly-repo-auditor', answers: { name: 'billing-auditor', folder: '/srv/billing', time: '03:30' } } as const
const BUILDER = { do: 'createFromTemplate', template: 'bot-builder', answers: { name: 'builder', folder: '', time: '' } } as const

const WITH_SETUP: Fixture = { ...WITH_BOTS, header: { ...WITH_BOTS.header, yolo: false, approvals: 'smart', cron: { jobs: [] } } }

async function launched(fixture: Fixture) {
  const clock = manualClock()
  const script = scriptedDialer(fixture, { clock })
  const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  const calls = (method: string) => callsIn(script.received).filter(call => call.method === method)
  return { clock, hermes, calls }
}

describe('createFromTemplate through the hub', () => {
  it("makes the profile, turns on the tools, sets the approval mode and adds the nightly job, each for the new bot, then opens it", async () => {
    const { clock, hermes, calls } = await launched(WITH_SETUP)
    const template = hermes.run(AUDITOR)
    expect(await template).toEqual({ ok: true, value: { bot: 'billing-auditor', warnings: [] } })
    expect(calls('profiles.create')).toMatchObject([{ params: { name: 'billing-auditor', soul: expect.stringContaining('You audit one code repository'), description: 'Checks a code repository every night and reports problems.' } }])
    expect(calls('profiles.configure')).toEqual([{ method: 'profiles.configure', params: { name: 'billing-auditor', enabled_toolsets: ['terminal', 'file', 'web', 'memory'] } }])
    expect(calls('config.set')).toEqual([{ method: 'config.set', params: { key: 'approval_mode', value: 'smart', profile: 'billing-auditor' } }])
    const adds = calls('cron.manage').filter(call => call.params?.action === 'add')
    expect(adds).toMatchObject([{ params: { name: 'Nightly audit', schedule: '30 3 * * *', deliver: 'bot-chat', profile: 'billing-auditor', prompt: expect.stringContaining('/srv/billing') } }])
    await clock.advance(0)
    expect(hermes.open.get().shown).toMatchObject({ kind: 'bot', bot: 'billing-auditor' })
    expect(await hermes.run({ do: 'listRoutines', bot: 'billing-auditor' as BotId })).toMatchObject({ ok: true, value: [{ name: 'Nightly audit', schedule: '30 3 * * *' }] })
  })

  it('sends no job for a template with no schedule', async () => {
    const { hermes, calls } = await launched(WITH_SETUP)
    expect(await hermes.run(BUILDER)).toEqual({ ok: true, value: { bot: 'builder', warnings: [] } })
    expect(calls('cron.manage').filter(call => call.params?.action === 'add')).toEqual([])
    expect(calls('profiles.configure')).toHaveLength(1)
  })

  it('sends nothing after a profile Hermes refuses, and says which field was wrong', async () => {
    const { hermes, calls } = await launched(WITH_SETUP)
    const taken = { ...BUILDER, answers: { ...BUILDER.answers, name: 'research' } }
    expect(await hermes.run(taken)).toMatchObject({ ok: false, refusal: { kind: 'rejected', field: 'name' } })
    expect(calls('profiles.configure')).toEqual([])
    expect(calls('config.set')).toEqual([])
  })

  it('refuses answers that make no plan without asking Hermes anything', async () => {
    const { hermes, calls } = await launched(WITH_SETUP)
    const bare = { ...AUDITOR, answers: { ...AUDITOR.answers, folder: '' } as TemplateAnswers }
    expect(await hermes.run(bare)).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(calls('profiles.create')).toEqual([])
  })

  it("keeps the bot and goes on with the other steps when Hermes can't schedule jobs, naming the one that failed, and leaves it to the dialog to open", async () => {
    const { hermes, calls } = await launched({ ...WITH_BOTS, header: { ...WITH_BOTS.header, yolo: false, approvals: 'smart' } })
    expect(await hermes.run(AUDITOR)).toEqual({
      ok: true,
      value: { bot: 'billing-auditor', warnings: ["the nightly job wasn't added. This Hermes can't schedule jobs from Highwing."] }
    })
    expect(calls('config.set')).toHaveLength(1)
    expect(hermes.open.get().shown).not.toMatchObject({ bot: 'billing-auditor' })
  })

  it("warns for each step a Hermes without them can't do, and still makes the bot", async () => {
    const { hermes } = await launched(WITH_BOTS)
    expect(await hermes.run(AUDITOR)).toEqual({
      ok: true,
      value: {
        bot: 'billing-auditor',
        warnings: [
          "its approval mode wasn't set. This Hermes can't set a bot's approval mode from Highwing.",
          "the nightly job wasn't added. This Hermes can't schedule jobs from Highwing."
        ]
      }
    })
  })

  it('does not add the job a second time when the bot already has one of that name', async () => {
    const held = { job_id: 'a1', name: 'Nightly audit', schedule: '0 2 * * *', enabled: true, state: 'scheduled' }
    const { hermes, calls } = await launched({ ...WITH_SETUP, header: { ...WITH_SETUP.header, cron: { jobs: [], profiles: { 'billing-auditor': [held] } } } })
    expect(await hermes.run(AUDITOR)).toMatchObject({ ok: true, value: { warnings: [] } })
    expect(calls('cron.manage').filter(call => call.params?.action === 'add')).toEqual([])
  })

  it('cannot make a bot over a socket that reaches only its own profile', async () => {
    const { hermes } = await launched(BOUND)
    expect(await hermes.run(BUILDER)).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't create bots from Highwing." } })
  })
})

describe("the cron tool's answer to an add", () => {
  it('is a refusal in its own words when it did not make the job', () => {
    expect(parseAdded({ success: false, error: 'Invalid schedule' })).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes couldn't add the job: Invalid schedule" } })
    expect(parseAdded({ success: true, error: 'croniter missing' })).toMatchObject({ ok: false })
    expect(parseAdded({ success: true, job_id: 'a1' })).toEqual({ ok: true, value: undefined })
  })
})
