import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import type { RoutineId } from '../src/domain/routines'
import { NO_REASON, parseRoutineRuns, RUNS_SHOWN, runsPath } from '../src/domain/runs'

const session = (id: string, extra: object = {}) => ({
  id, source: 'cron', started_at: 1000, ended_at: 1042, end_reason: 'cron_complete', is_active: false, title: 'Morning digest', ...extra
})
const output = (stem: string, title: string, at = 2000, extra: object = {}) => ({
  id: `cron_output:a1:${stem}`, source: 'cron_output', started_at: at, ended_at: at, title, preview: 'text', ...extra
})
const runs = (...rows: unknown[]) => ({ runs: rows, limit: 20 })

describe('runsPath', () => {
  it('asks for the routine in the bot profile, newest 20 only, escaping what a name may hold', () => {
    expect(runsPath('a1' as RoutineId, 'rae' as BotId)).toBe('/api/cron/jobs/a1/runs?profile=rae&limit=20')
    expect(runsPath('a/b?c' as RoutineId, 'r&e' as BotId)).toBe('/api/cron/jobs/a%2Fb%3Fc/runs?profile=r%26e&limit=20')
    expect(runsPath('a1' as RoutineId, 'rae' as BotId, 1)).toBe('/api/cron/jobs/a1/runs?profile=rae&limit=1')
  })
})

describe('parseRoutineRuns', () => {
  it('reads a session that finished with its final reply as a succeeded run of its length, opening its chat', () => {
    expect(parseRoutineRuns(runs(session('cron_a1_1')))).toEqual([{ key: 'cron_a1_1', outcome: { is: 'succeeded' }, at: 1_000_000, seconds: 42, chat: 'cron_a1_1', owner: null }])
  })

  it('reads a session that is still active as running, with no length yet', () => {
    expect(parseRoutineRuns(runs(session('s', { ended_at: null, end_reason: null, is_active: true })))).toEqual([
      { key: 's', outcome: { is: 'running' }, at: 1_000_000, seconds: null, chat: 's', owner: null }
    ])
  })

  it.each<[string, object, string]>([
    ['the scheduler still holds, though quiet for over five minutes', { scheduler_owned: true, is_active: false }, 'running'],
    ['the scheduler no longer holds, though active a moment ago', { scheduler_owned: false, is_active: true }, 'unknown'],
    ['an older Hermes calls active and names no owner', { is_active: true }, 'running']
  ])('reads an open session %s by Hermes\'s scheduler first', (_what, extra, is) => {
    expect(parseRoutineRuns(runs(session('s', { ended_at: null, end_reason: null, ...extra })))?.[0]?.outcome).toEqual({ is })
  })

  it('names the profile Hermes says holds the run, and none for a row without a chat', () => {
    expect(parseRoutineRuns(runs(session('s', { profile: 'default' }), session('t', { profile: '' }), output('x', 'OK', 2000, { profile: 'default' })))?.map(run => run.owner)).toEqual(['default', null, null])
  })

  it('reads a session that ended without a final reply as failed, and says why', () => {
    expect(parseRoutineRuns(runs(session('s', { end_reason: 'cron_incomplete_no_output' })))?.[0]?.outcome).toEqual({ is: 'failed', why: 'It ended without a final reply.' })
  })

  it.each<[string, object]>([
    ['another end reason', { end_reason: 'session_reset' }],
    ['no end reason, as a session never closed', { ended_at: null, end_reason: null }]
  ])('gives a session with %s no verdict', (_what, extra) => {
    expect(parseRoutineRuns(runs(session('s', extra)))?.[0]?.outcome).toEqual({ is: 'unknown' })
  })

  it('reads a title Hermes rewrote to CANCELLED as a cancelled run with its reason, over what end reason says', () => {
    expect(parseRoutineRuns(runs(session('s', { title: 'CANCELLED · cancelled on request (Stop)', end_reason: 'cron_complete' })))?.[0]).toMatchObject({
      outcome: { is: 'cancelled', why: 'cancelled on request (Stop)' }, chat: 's', seconds: 42
    })
  })

  it('gives no length when a session claims to end before it began, or Hermes sent none', () => {
    expect(parseRoutineRuns(runs(session('a', { ended_at: 999 }), session('b', { ended_at: 'x' }), session('c', { ended_at: undefined })))?.map(run => run.seconds)).toEqual([null, null, null])
  })

  it.each<[string, string, object]>([
    ['COMPLETED', 'COMPLETED · the digest text', { is: 'succeeded' }],
    ['OK', 'OK', { is: 'succeeded' }],
    ['FAILED with its error', 'FAILED · Provider returned 429: rate limited', { is: 'failed', why: 'Provider returned 429: rate limited' }],
    ['ERROR with its error', 'ERROR · boom', { is: 'failed', why: 'boom' }],
    ['FAILED with nothing after it', 'FAILED', { is: 'failed', why: NO_REASON }],
    ['FAILED with Hermes\'s stand-in title', 'FAILED · Script-only run', { is: 'failed', why: NO_REASON }],
    ['CANCELLED with its reason', 'CANCELLED · job removed while running', { is: 'cancelled', why: 'job removed while running' }],
    ['CANCELLED with nothing after it', 'CANCELLED', { is: 'cancelled', why: null }],
    ['MISSED with its reason', 'MISSED · missed ×3', { is: 'missed', why: 'missed ×3' }],
    ['a bare preview', 'Script-only run', { is: 'unknown' }],
    ['a preview that only starts like a label', 'OKAY · fine', { is: 'unknown' }],
    ['a label in lower case', 'failed · nope', { is: 'unknown' }]
  ])('reads an output doc titled with %s', (_what, title, outcome) => {
    expect(parseRoutineRuns(runs(output('x', title)))).toEqual([{ key: 'cron_output:a1:x', outcome, at: 2_000_000, seconds: null, chat: null, owner: null }])
  })

  it('gives a script-only row no length even when Hermes stamps start and end alike, and no chat', () => {
    expect(parseRoutineRuns(runs(output('x', 'COMPLETED · ok', 5, { started_at: 5, ended_at: 9 })))?.[0]).toMatchObject({ seconds: null, chat: null })
  })

  it('keeps Hermes order and drops a row it cannot read without losing the rest', () => {
    const rows = [session('keep1'), null, 'x', [], { id: 'no-source', started_at: 1 }, session('', {}), session('no-time', { started_at: 'soon' }), session('later', { source: 'chat' }), output('keep2', 'OK')]
    expect(parseRoutineRuns(runs(...rows))?.map(run => run.key)).toEqual(['keep1', 'cron_output:a1:keep2'])
  })

  it('drops a second row with the same id, so each run can be a list item of its own', () => {
    expect(parseRoutineRuns(runs(session('s'), session('s', { started_at: 5 })))).toHaveLength(1)
  })

  it('keeps the newest 20 of a longer list', () => {
    const many = Array.from({ length: 30 }, (_, index) => session(`s${index}`))
    const parsed = parseRoutineRuns(runs(...many))
    expect(parsed).toHaveLength(RUNS_SHOWN)
    expect(parsed?.[RUNS_SHOWN - 1]?.key).toBe('s19')
  })

  it('answers an empty list for a routine with no runs', () => {
    expect(parseRoutineRuns(runs())).toEqual([])
  })

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'runs'],
    ['an array', []],
    ['no runs', {}],
    ['runs that are not a list', { runs: {} }]
  ])('refuses %s as no run list', (_what, body) => {
    expect(parseRoutineRuns(body)).toBeNull()
  })

  it('carries nothing of a row but what the list draws', () => {
    const sensitive = { chat_id: 'chat-secret-1', user_id: 'user-secret-2', origin_json: '{"who":"origin-secret-3"}', system_prompt: 'prompt-secret-4', model_config: { key: 'config-secret-5' }, preview: 'preview-secret-6' }
    const parsed = parseRoutineRuns(runs(session('s', sensitive), output('x', 'FAILED · rate limited', 2000, sensitive)))
    const text = JSON.stringify(parsed)
    for (const secret of ['chat-secret-1', 'user-secret-2', 'origin-secret-3', 'prompt-secret-4', 'config-secret-5', 'preview-secret-6']) expect(text).not.toContain(secret)
    expect(parsed?.map(run => Object.keys(run).sort())).toEqual([['at', 'chat', 'key', 'outcome', 'owner', 'seconds'], ['at', 'chat', 'key', 'outcome', 'owner', 'seconds']])
  })
})
