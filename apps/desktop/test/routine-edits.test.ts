import type { HermesRequest, HttpAnswer, ReadHermes, WriteHermes } from '@highwing/hermes'
import type { BotId, RoutineEdit, RoutineId } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { editRoutine, routineEditsOffered } from '../src/main/routine-edits'

const BOT = 'rae' as BotId
const ROUTINE = '4f1c2a9e0b7d' as RoutineId
const RUN: RoutineEdit = { do: 'run' }
const RESCHEDULE: RoutineEdit = { do: 'reschedule', schedule: '0 8 * * 1-5' }

const JOB = {
  id: ROUTINE, name: 'Morning digest', schedule: { kind: 'cron', expr: '0 8 * * 1-5', display: '0 8 * * 1-5' }, schedule_display: '0 8 * * 1-5',
  enabled: true, state: 'scheduled', next_run_at: '2026-11-30T08:00:00+00:00', last_run_at: '2026-11-28T09:00:03+00:00', last_status: 'ok', skills: ['mail'], model: 'gpt-5', deliver: 'local'
}
const ROUTINE_NOW = { id: ROUTINE, name: 'Morning digest', schedule: '0 8 * * 1-5', paused: false, nextRunAt: '2026-11-30T08:00:00+00:00' }

const answering = (answer: HttpAnswer | Error, sent: HermesRequest[] = []): WriteHermes => async request => {
  sent.push(request)
  if (answer instanceof Error) throw answer
  return answer
}

const REFUSALS = {
  running: { kind: 'rejected', message: 'This routine is already running.' },
  gone: { kind: 'stale', message: "That routine isn't there any more." },
  noRun: { kind: 'unsupported', message: "This Hermes can't run a routine now from Highwing." },
  noSchedule: { kind: 'unsupported', message: "This Hermes can't change a routine's schedule from Highwing." },
  banana: { kind: 'rejected', message: "Hermes couldn't use that schedule: Invalid schedule 'every banana'. Use 'every 30m', a cron line or an ISO time." },
  unreadable: { kind: 'stale', message: "Hermes answered, but Highwing can't tell how that routine stands now." },
  runOffline: { kind: 'offline', message: "Highwing couldn't reach Hermes to run that routine." },
  editOffline: { kind: 'offline', message: "Highwing couldn't reach Hermes to change that routine." }
} as const

describe('routineEditsOffered', () => {
  const probing = (answer: HttpAnswer | Error, asked: string[] = []): ReadHermes => async path => {
    asked.push(path)
    if (answer instanceof Error) throw answer
    return answer
  }

  it("is true when Hermes answers the routine's run list, which comes with both routes, and sends only that one GET of one row", async () => {
    const asked: string[] = []
    expect(await routineEditsOffered(probing({ status: 200, body: { runs: [], limit: 1 } }, asked), BOT, ROUTINE)).toBe(true)
    expect(asked).toEqual(['/api/cron/jobs/4f1c2a9e0b7d/runs?profile=rae&limit=1'])
  })

  it.each<[string, HttpAnswer | Error]>([
    ['a 404 `No such API endpoint`, as a Hermes without the run list answers', { status: 404, body: { detail: 'No such API endpoint: /api/cron/jobs/4f1c2a9e0b7d/runs' } }],
    ['a 404 `Not Found`', { status: 404, body: { detail: 'Not Found' } }],
    ['a 200 that is no run list', { status: 200, body: { ok: true } }],
    ['a 200 that was not JSON', { status: 200, body: null }],
    ['a 401', { status: 401, body: null }],
    ['a 500', { status: 500, body: null }],
    ['no answer', new Error('connect ECONNREFUSED')]
  ])('is false for %s', async (_what, answer) => {
    expect(await routineEditsOffered(probing(answer), BOT, ROUTINE)).toBe(false)
  })
})

describe('editRoutine', () => {
  it('sends a run as a POST of the trigger route in the bot profile, and answers the routine as Hermes now holds it', async () => {
    const sent: HermesRequest[] = []
    expect(await editRoutine(answering({ status: 200, body: JOB }, sent), BOT, ROUTINE, RUN)).toEqual({ ok: true, value: ROUTINE_NOW })
    expect(sent).toEqual([{ method: 'POST', path: '/api/cron/jobs/4f1c2a9e0b7d/trigger?profile=rae', ms: 86_400_000 }])
  })

  it('sends a new schedule as a PUT whose body is the schedule alone, and answers the routine with the schedule and next run Hermes gives', async () => {
    const sent: HermesRequest[] = []
    expect(await editRoutine(answering({ status: 200, body: JOB }, sent), BOT, ROUTINE, RESCHEDULE)).toEqual({ ok: true, value: ROUTINE_NOW })
    expect(sent).toEqual([{ method: 'PUT', path: '/api/cron/jobs/4f1c2a9e0b7d?profile=rae', json: { updates: { schedule: '0 8 * * 1-5' } }, ms: 30_000 }])
    expect(JSON.stringify(sent[0]?.json)).toBe('{"updates":{"schedule":"0 8 * * 1-5"}}')
  })

  it('answers a paused routine as paused', async () => {
    expect(await editRoutine(answering({ status: 200, body: { ...JOB, enabled: false, state: 'paused', next_run_at: null } }), BOT, ROUTINE, RESCHEDULE))
      .toEqual({ ok: true, value: { ...ROUTINE_NOW, paused: true, nextRunAt: null } })
  })

  it.each<[string, RoutineEdit, HttpAnswer | Error, keyof typeof REFUSALS]>([
    ['a run, 409 already running', RUN, { status: 409, body: { detail: 'Job is already running or was claimed by another scheduler' } }, 'running'],
    ['a run, 404 for a job Hermes does not have', RUN, { status: 404, body: { detail: 'Job not found' } }, 'gone'],
    ['a schedule, 404 for a job Hermes does not have', RESCHEDULE, { status: 404, body: { detail: 'Job not found' } }, 'gone'],
    ['a run, 404 for a route Hermes does not have', RUN, { status: 404, body: { detail: 'Not Found' } }, 'noRun'],
    ['a run, 405', RUN, { status: 405, body: { detail: 'Method Not Allowed' } }, 'noRun'],
    ['a schedule, 404 for a route Hermes does not have', RESCHEDULE, { status: 404, body: { detail: 'Not Found' } }, 'noSchedule'],
    ['a schedule, 405', RESCHEDULE, { status: 405, body: null }, 'noSchedule'],
    ['a schedule, 400 with its reason', { do: 'reschedule', schedule: 'every banana' }, { status: 400, body: { detail: "Invalid schedule 'every banana'. Use 'every 30m', a cron line or an ISO time" } }, 'banana'],
    ['a run, a 200 that is no job', RUN, { status: 200, body: { ok: true } }, 'unreadable'],
    ['a run, a 200 for another job', RUN, { status: 200, body: { ...JOB, id: 'other' } }, 'unreadable'],
    ['a run, a 200 that was not JSON', RUN, { status: 200, body: null }, 'unreadable'],
    ['a run, a 500', RUN, { status: 500, body: null }, 'runOffline'],
    ['a run, a 401', RUN, { status: 401, body: null }, 'runOffline'],
    ['a run, no answer', RUN, new Error('connect ECONNREFUSED'), 'runOffline'],
    ['a schedule, no answer', RESCHEDULE, new Error('The operation was aborted'), 'editOffline'],
    ['a schedule, a 409, which Hermes sends only for a run', RESCHEDULE, { status: 409, body: { detail: 'x' } }, 'editOffline']
  ])('refuses %s in plain words', async (_what, edit, answer, refusal) => {
    expect(await editRoutine(answering(answer), BOT, ROUTINE, edit)).toEqual({ ok: false, refusal: REFUSALS[refusal] })
  })

  it('gives the reason Hermes had for a schedule it refused as a sentence, and says so when it gives none', async () => {
    expect(await editRoutine(answering({ status: 400, body: { detail: 'Invalid schedule.' } }), BOT, ROUTINE, RESCHEDULE))
      .toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes couldn't use that schedule: Invalid schedule." } })
    expect(await editRoutine(answering({ status: 400, body: null }), BOT, ROUTINE, RESCHEDULE))
      .toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes couldn't use that schedule: it gave no reason." } })
  })
})
