import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import { EDIT_MS, jobPath, requestOf, rescheduleBody, RUN_NOW_MS, triggerPath } from '../src/domain/routine-edits'
import type { RoutineId } from '../src/domain/routines'
import { parseCronJob } from '../src/wire/parse'

const ROUTINE = '4f1c2a9e0b7d' as RoutineId
const BOT = 'rae' as BotId

describe('the routes of an edit', () => {
  it("name the routine in the bot's profile, escaping what a name may hold", () => {
    expect(jobPath(ROUTINE, BOT)).toBe('/api/cron/jobs/4f1c2a9e0b7d?profile=rae')
    expect(triggerPath(ROUTINE, BOT)).toBe('/api/cron/jobs/4f1c2a9e0b7d/trigger?profile=rae')
    expect(triggerPath('a/b?c' as RoutineId, 'r&e' as BotId)).toBe('/api/cron/jobs/a%2Fb%3Fc/trigger?profile=r%26e')
  })

  it('carry a schedule as the one field of a PUT, and nothing else, so Hermes keeps every other field of the job', () => {
    expect(JSON.stringify(rescheduleBody('0 8 * * 1-5'))).toBe('{"updates":{"schedule":"0 8 * * 1-5"}}')
  })

  it('send a run as a POST with no body, waiting as long as a job may run', () => {
    expect(requestOf({ do: 'run' }, ROUTINE, BOT)).toEqual({ method: 'POST', path: '/api/cron/jobs/4f1c2a9e0b7d/trigger?profile=rae', ms: RUN_NOW_MS })
    expect(RUN_NOW_MS).toBe(86_400_000)
  })

  it('send a new schedule as a PUT of the text as typed, with a short deadline', () => {
    expect(requestOf({ do: 'reschedule', schedule: 'every banana' }, ROUTINE, BOT)).toEqual({
      method: 'PUT', path: '/api/cron/jobs/4f1c2a9e0b7d?profile=rae', json: { updates: { schedule: 'every banana' } }, ms: EDIT_MS
    })
  })
})

describe('parseCronJob', () => {
  const RAW = {
    id: '4f1c2a9e0b7d', name: '[bot:rae] Morning digest', prompt: 'Sum up my mail.', skills: ['mail'], model: 'gpt-5', deliver: 'local',
    schedule: { kind: 'cron', expr: '0 8 * * 1-5', display: '0 8 * * 1-5' }, schedule_display: '0 8 * * 1-5', enabled: true, state: 'scheduled',
    next_run_at: '2026-11-30T08:00:00+00:00', last_run_at: '2026-11-27T09:00:03+00:00', last_status: 'ok', last_error: null
  }

  it("reads the raw record Hermes's cron routes answer, with its id as `id` and the words of its schedule as `schedule_display`", () => {
    expect(parseCronJob(RAW)).toEqual({ id: '4f1c2a9e0b7d', name: 'Morning digest', schedule: '0 8 * * 1-5', paused: false, nextRunAt: '2026-11-30T08:00:00+00:00' })
  })

  it('reads a paused job as paused, with no next run', () => {
    expect(parseCronJob({ ...RAW, enabled: false, state: 'paused', next_run_at: null })).toMatchObject({ paused: true, nextRunAt: null })
  })

  it.each([
    ['a body that is no object', null],
    ['a list', []],
    ['a record with no id', { ...RAW, id: undefined }],
    ['a record whose id is blank', { ...RAW, id: '' }],
    ['a record whose id is not text', { ...RAW, id: 7 }]
  ])('reads %s as no job', (_what, body) => {
    expect(parseCronJob(body)).toBeNull()
  })

  it("never reads the schedule's dict as words: a record with no `schedule_display` has no schedule words", () => {
    expect(parseCronJob({ ...RAW, schedule_display: undefined })).toMatchObject({ schedule: '' })
  })
})
