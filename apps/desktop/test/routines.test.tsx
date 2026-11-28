import type { BotId, CommandOutcome, Edited, Ran, Routine, RoutineEdit, RoutineId, RoutineRun, SessionId } from '@highwing/hermes/domain'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RoutinesList, RunsList, ScheduleEditor, type RowEdits } from '../src/renderer/bots/Routines'
import {
  afterControl, afterEdit, afterEditKnown, afterReread, afterSave, canRun, canSave, editControlsOf, isGone, NO_RUNS, openEditor, ranWords, REREAD_MS, rereadAfter, routinesViewOf, RUNNING_WORDS, runsViewOf, SCHEDULE_HINT, savedWords,
  scheduleWords, tookWords, typedInto, type Editor
} from '../src/renderer/bots/routines-view'

const HIDDEN: RowEdits = { controls: { run: false, reschedule: false }, running: [], onRun: () => {}, onReschedule: async () => ({ ok: false, refusal: { kind: 'offline', message: 'x' } }) }
const NONE = { busy: null, edits: HIDDEN, history: { bot: 'rae' as BotId, revision: 1, read: async () => ({ ok: true, value: [] }) as const, onOpen: () => {} }, onToggle: () => {}, onDelete: () => {} }
const routine = (id: string, name: string, schedule: string, paused = false, nextRunAt: string | null = null): Routine => ({ id: id as RoutineId, name, schedule, paused, nextRunAt })

describe('scheduleWords', () => {
  it.each([
    ['every 1m', 'Every minute'],
    ['every 30m', 'Every 30 minutes'],
    ['every 60m', 'Every hour'],
    ['every 120m', 'Every 2 hours'],
    ['every 90m', 'Every 90 minutes'],
    ['every 1440m', 'Every day'],
    ['every 10080m', 'Every 7 days'],
    ['once at 2026-12-01 09:00', 'Once, on 1 December 2026 at 09:00'],
    ['once in 2h', 'Once, in 2 hours'],
    ['once in 1d', 'Once, in 1 day'],
    ['0 9 * * *', 'Every day at 09:00'],
    ['30 17 * * 1-5', 'Weekdays at 17:30'],
    ['0 8 * * 1', 'Every Monday at 08:00'],
    ['0 8 * * 0', 'Every Sunday at 08:00'],
    ['0 8 * * 7', 'Every Sunday at 08:00'],
    ['*/15 * * * *', 'Every 15 minutes'],
    ['0 * * * *', 'Every hour'],
    ['5 * * * *', 'Every hour, at 5 past'],
    ['0 */2 * * *', 'Every 2 hours'],
    ['*/7 * * * *', '*/7 * * * *'],
    ['*/0 * * * *', '*/0 * * * *'],
    ['0 */5 * * *', '0 */5 * * *'],
    ['0 */12 * * *', 'Every 12 hours'],
    ['30 */6 * * *', 'Every 6 hours, at 30 past'],
    ['0 9 1 * *', 'Every month on day 1 at 09:00'],
    ['0 10 * * 0,6', 'Weekends at 10:00'],
    ['0 10 * * sat,sun', 'Weekends at 10:00'],
    ['0 9 * * mon-fri', 'Weekdays at 09:00'],
    ['0 9 * * MON', 'Every Monday at 09:00'],
    ['0 9 * * 1,3', '0 9 * * 1,3'],
    ['0 9 * * 5-1', '0 9 * * 5-1'],
    ['0 9 1 1 *', '0 9 1 1 *'],
    ['every monday 9am', 'Every monday 9am'],
    ['', 'No schedule']
  ])('says %j as %j', (schedule, words) => {
    expect(scheduleWords(schedule)).toBe(words)
  })
})

describe('the Routines tab', () => {
  it('lists each routine by name with when it runs, or Paused, with Pause or Resume and Delete', () => {
    const view = routinesViewOf({ ok: true, value: [routine('a1', 'Morning digest', '0 9 * * 1-5'), routine('b2', 'Backup check', 'every 60m', true)] }, 'Research')
    const html = renderToStaticMarkup(<RoutinesList view={view} {...NONE} />)
    expect(html).toContain('<ul class="routines" aria-label="Routines">')
    const rows = [...html.matchAll(/<li class="routine" aria-busy="false"><span class="routine-name">([^<]*)<\/span><span class="routine-when">([^<]*)<\/span><span class="routine-controls">(.*?)<\/span><\/li>/g)]
    expect(rows.map(([, name, when, controls]) => [name, when, [...controls!.matchAll(/aria-label="([^"]*)"/g)].map(([, label]) => label)])).toEqual([
      ['Morning digest', 'Weekdays at 09:00', ['Past runs of Morning digest', 'Pause Morning digest', 'Delete Morning digest…']],
      ['Backup check', 'Paused', ['Past runs of Backup check', 'Resume Backup check', 'Delete Backup check…']]
    ])
  })

  it("gives each routine a Past runs button that starts closed and names the list it opens", () => {
    const view = routinesViewOf({ ok: true, value: [routine('a1', 'Morning digest', 'every 60m')] }, 'Research')
    const html = renderToStaticMarkup(<RoutinesList view={view} {...NONE} />)
    expect(html).toMatch(/<button type="button" aria-expanded="false" aria-controls="[^"]+" aria-label="Past runs of Morning digest">Past runs<\/button>/)
    expect(html).not.toContain('Loading runs')
  })

  it('disables every control but Past runs while one is on its way to Hermes', () => {
    const view = routinesViewOf({ ok: true, value: [routine('a1', 'Morning digest', 'every 60m'), routine('b2', 'Backup check', 'every 60m')] }, 'Research')
    const html = renderToStaticMarkup(<RoutinesList view={view} {...NONE} busy={'a1' as RoutineId} />)
    expect(html).toContain('<li class="routine" aria-busy="true">')
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(4)
  })

  it('says how to make one by asking the bot when it has none', () => {
    expect(routinesViewOf({ ok: true, value: [] }, 'Research')).toEqual({
      state: 'empty', hint: 'Research has no routines yet. To make one, ask Research in a chat, for example "Every weekday at 9am, sum up my unread email."'
    })
  })

  it("shows Hermes's refusal as an alert, and a loading line before the first answer", () => {
    const refused = routinesViewOf({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't show routines to Highwing." } }, 'Research')
    expect(renderToStaticMarkup(<RoutinesList view={refused} {...NONE} />)).toContain('role="alert">This Hermes can&#x27;t show routines to Highwing.</p>')
    expect(renderToStaticMarkup(<RoutinesList view={routinesViewOf(null, 'Research')} {...NONE} />)).toContain('Loading routines…')
  })
})

describe('a control of a routine', () => {
  const LISTED = { ok: true, value: [routine('a1', 'Morning digest', 'every 60m'), routine('b2', 'Backup check', 'every 60m')] } as const

  it("puts Hermes's answer in the row, and takes a deleted routine out", () => {
    const paused = routine('a1', 'Morning digest', 'every 60m', true)
    expect(afterControl(LISTED, 'a1' as RoutineId, { ok: true, value: paused })).toEqual({ listed: { ok: true, value: [paused, LISTED.value[1]] }, said: null })
    expect(afterControl(LISTED, 'a1' as RoutineId, { ok: true, value: null })).toEqual({ listed: { ok: true, value: [LISTED.value[1]] }, said: null })
  })

  it("keeps the list and says why when Hermes refused, and takes the list away when Hermes can't change routines", () => {
    expect(afterControl(LISTED, 'a1' as RoutineId, { ok: false, refusal: { kind: 'rejected', message: "Hermes couldn't pause that routine: busy" } })).toEqual({
      listed: LISTED, said: "Hermes couldn't pause that routine: busy"
    })
    const unsupported = { ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't show routines to Highwing." } } as const
    expect(afterControl(LISTED, 'a1' as RoutineId, unsupported)).toEqual({ listed: unsupported, said: null })
  })
})

const RAE = 'rae' as BotId
const CLOCK = { now: Date.UTC(2026, 10, 27, 12, 0), timeZone: 'UTC' }
const run = (key: string, outcome: RoutineRun['outcome'], at: number, seconds: number | null, chat: string | null): RoutineRun => ({ key, outcome, at, seconds, chat: chat as SessionId | null, owner: null })
const HOUR = 3_600_000

describe('tookWords', () => {
  it.each([
    [0, 'took under 1 s'],
    [0.4, 'took under 1 s'],
    [42, 'took 42 s'],
    [59.4, 'took 59 s'],
    [60, 'took 1 min'],
    [179, 'took 3 min'],
    [180, 'took 3 min'],
    [3540, 'took 59 min'],
    [3600, 'took 1 h'],
    [3900, 'took 1 h 5 min'],
    [7200, 'took 2 h']
  ])('says %s seconds as %j', (seconds, words) => {
    expect(tookWords(seconds)).toBe(words)
  })
})

describe('the past runs of a routine', () => {
  const RUNS: readonly RoutineRun[] = [
    run('s1', { is: 'running' }, CLOCK.now - 5 * 60_000, null, 's1'),
    run('s2', { is: 'succeeded' }, CLOCK.now - HOUR, 42, 's2'),
    run('s3', { is: 'failed', why: 'It ended without a final reply.' }, CLOCK.now - 25 * HOUR, 180, 's3'),
    run('s4', { is: 'cancelled', why: 'cancelled on request (Stop)' }, CLOCK.now - 50 * HOUR, 7, 's4'),
    run('o5', { is: 'failed', why: 'Provider returned 429: rate limited' }, CLOCK.now - 80 * HOUR, null, null),
    run('o6', { is: 'missed', why: null }, CLOCK.now - 90 * HOUR, null, null),
    run('o7', { is: 'unknown' }, CLOCK.now - 100 * HOUR, null, null)
  ]

  it('says each run in words: its state, its time, how long it took, and why it failed', () => {
    const view = runsViewOf({ ok: true, value: RUNS }, CLOCK, RAE)
    expect(view.state === 'listed' && view.rows.map(({ state, when, took, why }) => [state, when, took, why])).toEqual([
      ['Running', 'Today 11:55', null, null],
      ['Succeeded', 'Today 11:00', 'took 42 s', null],
      ['Failed', 'Yesterday 11:00', 'took 3 min', 'It ended without a final reply.'],
      ['Cancelled', 'Wed 25 Nov 10:00', 'took 7 s', 'cancelled on request (Stop)'],
      ['Failed', 'Tue 24 Nov 04:00', null, 'Provider returned 429: rate limited'],
      ['Missed', 'Mon 23 Nov 18:00', null, null],
      ['No result', 'Mon 23 Nov 08:00', null, null]
    ])
  })

  it('reads the runs again while the list is open, since another bot\'s runs send no cron.changed, but not from a Hermes without the route', () => {
    expect(rereadAfter({ ok: true, value: RUNS })).toBe(REREAD_MS)
    expect(rereadAfter({ ok: true, value: [] }), 'no runs yet').toBe(REREAD_MS)
    expect(rereadAfter({ ok: false, refusal: { kind: 'offline', message: 'x' } }), 'offline for now').toBe(REREAD_MS)
    expect(rereadAfter({ ok: false, refusal: { kind: 'unsupported', message: 'x' } }), 'no route').toBeNull()
  })

  it('keeps the runs it shows when a later read fails, and shows the failure when it has none', () => {
    const shown = { ok: true, value: RUNS } as const
    const offline = { ok: false, refusal: { kind: 'offline', message: 'gone' } } as const
    expect(afterReread(shown, offline)).toBe(shown)
    expect(afterReread(null, offline)).toBe(offline)
    expect(afterReread(offline, shown)).toBe(shown)
  })

  it('opens a run in the profile Hermes names for it, else in the routine\'s bot', () => {
    const elsewhere = { ...run('s1', { is: 'succeeded' }, 0, 1, 's1'), owner: 'default' as BotId }
    const view = runsViewOf({ ok: true, value: [elsewhere, run('s2', { is: 'succeeded' }, 0, 1, 's2'), run('o', { is: 'succeeded' }, 0, null, null)] }, CLOCK, RAE)
    expect(view.state === 'listed' && view.rows.map(row => row.chat)).toEqual([{ sessionId: 's1', bot: 'default' }, { sessionId: 's2', bot: 'rae' }, null])
  })

  it('draws a list named for the routine, with an Open run button only on a run that has a chat', () => {
    const html = renderToStaticMarkup(<RunsList id="runs" name="Morning digest" view={runsViewOf({ ok: true, value: RUNS }, CLOCK, RAE)} onOpen={() => {}} />)
    expect(html).toContain('<ul aria-label="Past runs of Morning digest">')
    expect([...html.matchAll(/aria-label="(Open run from [^"]*)"/g)].map(([, label]) => label)).toEqual([
      'Open run from Today 11:55', 'Open run from Today 11:00', 'Open run from Yesterday 11:00', 'Open run from Wed 25 Nov 10:00'
    ])
    expect(html).toContain('<span class="run-why">Provider returned 429: rate limited</span>')
    expect(html.match(/<span class="run-why">/g)).toHaveLength(3)
  })

  it('says it is loading, says there are none, and shows what Hermes refused with as an alert', () => {
    const draw = (listed: Parameters<typeof runsViewOf>[0]) => renderToStaticMarkup(<RunsList id="runs" name="Morning digest" view={runsViewOf(listed, CLOCK, RAE)} onOpen={() => {}} />)
    expect(draw(null)).toContain('aria-busy="true">Loading runs…</p>')
    expect(draw({ ok: true, value: [] })).toContain(`<p class="routines-note">${NO_RUNS}</p>`)
    expect(NO_RUNS).toBe('No runs yet.')
    expect(draw({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't show a routine's past runs to Highwing." } })).toContain('role="alert">This Hermes can&#x27;t show a routine&#x27;s past runs to Highwing.</p>')
  })
})

describe('run now and edit schedule', () => {
  const DIGEST = routine('a1', 'Morning digest', '0 9 * * 1-5')
  const BACKUP = routine('b2', 'Backup check', 'every 60m', true)
  const LISTED = { ok: true, value: [DIGEST, BACKUP] } as const
  const SHOWN: RowEdits = { ...HIDDEN, controls: { run: true, reschedule: true } }
  const refusal = (kind: 'offline' | 'stale' | 'conflict' | 'rejected' | 'unsupported', message: string) => ({ ok: false, refusal: { kind, message } }) as const
  const draw = (edits: RowEdits, busy: RoutineId | null = null) =>
    renderToStaticMarkup(<RoutinesList view={routinesViewOf(LISTED, 'Research')} {...NONE} busy={busy} edits={edits} />)
  const labelsOf = (html: string, name: string) => {
    const row = [...html.matchAll(/<li class="routine"[^>]*>(.*?)<\/li>/g)].map(([, inner]) => inner!).find(inner => inner.includes(`>${name}<`))
    return [...(row ?? '').matchAll(/aria-label="([^"]*)"/g)].map(([, label]) => label)
  }

  it('gives each row the schedule as Hermes words it, for the field to start from', () => {
    const view = routinesViewOf({ ok: true, value: [DIGEST, routine('c3', 'Once', 'once in 2h')] }, 'Research')
    expect(view.state === 'listed' && view.rows.map(row => [row.when, row.schedule])).toEqual([['Weekdays at 09:00', '0 9 * * 1-5'], ['Once, in 2 hours', 'once in 2h']])
  })

  it('shows neither control until Hermes has said it serves them, and the one a later answer called unsupported goes again', () => {
    expect(editControlsOf(null)).toEqual({ run: false, reschedule: false })
    expect(editControlsOf({ offered: false, withdrawn: [] })).toEqual({ run: false, reschedule: false })
    expect(editControlsOf({ offered: true, withdrawn: [] })).toEqual({ run: true, reschedule: true })
    expect(editControlsOf({ offered: true, withdrawn: ['run'] })).toEqual({ run: false, reschedule: true })
    expect(editControlsOf({ offered: true, withdrawn: ['reschedule'] })).toEqual({ run: true, reschedule: false })
  })

  it('withdraws an edit only on an unsupported answer, once', () => {
    const known = { offered: true, withdrawn: [] }
    const run: RoutineEdit = { do: 'run' }
    expect(afterEditKnown(known, run, refusal('unsupported', 'x'))).toEqual({ offered: true, withdrawn: ['run'] })
    expect(afterEditKnown({ offered: true, withdrawn: ['run'] }, run, refusal('unsupported', 'x'))).toEqual({ offered: true, withdrawn: ['run'] })
    for (const answered of [refusal('stale', 'x'), refusal('rejected', 'x'), refusal('offline', 'x'), { ok: true, value: { routine: DIGEST, ran: null } } as const]) expect(afterEditKnown(known, run, answered)).toBe(known)
  })

  it('offers Run now on a routine that is not paused, and never on a paused one, which Hermes would also resume', () => {
    expect(canRun({ paused: false }, { run: true, reschedule: true })).toBe(true)
    expect(canRun({ paused: true }, { run: true, reschedule: true })).toBe(false)
    expect(canRun({ paused: false }, { run: false, reschedule: true })).toBe(false)
    const html = draw(SHOWN)
    expect(labelsOf(html, 'Morning digest')).toEqual(['Past runs of Morning digest', 'Run Morning digest now', 'Edit schedule of Morning digest', 'Pause Morning digest', 'Delete Morning digest…'])
    expect(labelsOf(html, 'Backup check')).toEqual(['Past runs of Backup check', 'Edit schedule of Backup check', 'Resume Backup check', 'Delete Backup check…'])
  })

  it('says Running now… on the row Hermes is running, and disables its Run now alone, leaving the other rows and controls usable', () => {
    const html = draw({ ...SHOWN, running: ['a1' as RoutineId] })
    expect(html).toContain(`<span class="routine-state" role="status">${RUNNING_WORDS}</span>`)
    expect(RUNNING_WORDS).toBe('Running now…')
    expect(html.match(/routine-state/g)).toHaveLength(1)
    expect(html).toContain('<li class="routine" aria-busy="true">')
    expect(html.match(/<button[^>]*disabled=""[^>]*aria-label="([^"]*)"|<button[^>]*aria-label="([^"]*)"[^>]*disabled=""/g)?.map(button => /aria-label="([^"]*)"/.exec(button)?.[1])).toEqual(['Run Morning digest now'])
  })

  it('draws each edit control disabled, as Pause and Delete are, while a control is on its way to Hermes', () => {
    const disabled = draw(SHOWN, 'b2' as RoutineId).match(/<button[^>]*disabled=""[^>]*>/g) ?? []
    expect(disabled.map(button => /aria-label="([^"]*)"/.exec(button)?.[1])).toEqual([
      'Run Morning digest now', 'Edit schedule of Morning digest', 'Pause Morning digest', 'Delete Morning digest…', 'Edit schedule of Backup check', 'Resume Backup check', 'Delete Backup check…'
    ])
  })

  it('folds Hermes\'s answer to a run into the row, and says how the run went with the name Hermes holds', () => {
    const ran = { ...DIGEST, name: 'Morning digest (new)', nextRunAt: '2026-11-30T09:00:00+00:00' }
    expect(afterEdit(LISTED, 'a1' as RoutineId, { do: 'run' }, { ok: true, value: { routine: ran, ran: { is: 'succeeded' } } }, CLOCK)).toEqual({
      listed: { ok: true, value: [ran, BACKUP] }, said: null, note: 'Ran Morning digest (new). It succeeded.'
    })
  })

  it.each<[Ran | null, string]>([
    [{ is: 'succeeded' }, 'Ran Morning digest. It succeeded.'],
    [{ is: 'failed', why: 'Provider returned 429' }, 'Ran Morning digest. It failed: Provider returned 429'],
    [{ is: 'failed', why: null }, 'Ran Morning digest. It failed, and Hermes gave no reason.'],
    [{ is: 'undelivered' }, "Ran Morning digest. It ran, but its result didn't reach where it goes."],
    [{ is: 'cancelled' }, 'Ran Morning digest. It was stopped before it finished.'],
    [null, 'Ran Morning digest.']
  ])('says what Hermes stamped on the run, %j', (ran, words) => {
    expect(ranWords(DIGEST, ran)).toBe(words)
  })

  it('folds Hermes\'s answer to a new schedule into the row, with the next run as Hermes gives it', () => {
    const saved = { ...DIGEST, schedule: '0 8 * * 1-5', nextRunAt: '2026-11-30T08:00:00+00:00' }
    expect(afterEdit(LISTED, 'a1' as RoutineId, { do: 'reschedule', schedule: '0 8 * * 1-5' }, { ok: true, value: { routine: saved, ran: null } }, CLOCK)).toEqual({
      listed: { ok: true, value: [saved, BACKUP] }, said: null, note: 'Saved. Hermes runs it next Mon 30 Nov 2026 08:00.'
    })
  })

  it.each([
    [{ ...DIGEST, nextRunAt: '2026-11-27T15:30:00+00:00' }, 'Saved. Hermes runs it next Today 15:30.'],
    [{ ...DIGEST, nextRunAt: '2026-11-28T09:00:00+00:00' }, 'Saved. Hermes runs it next Sat 28 Nov 2026 09:00.'],
    [{ ...DIGEST, paused: true }, "Saved. It's paused, so it has no next run."],
    [{ ...DIGEST, nextRunAt: null }, 'Saved. Hermes has no next run for it.'],
    [{ ...DIGEST, nextRunAt: 'soon' }, 'Saved.']
  ])('says what Hermes gave as the next run of %j: %j', (saved, words) => {
    expect(savedWords(saved, CLOCK)).toBe(words)
  })

  it('keeps the list and says why when Hermes refused a run, and keeps a refusal the open field shows out of the line above the list', () => {
    const running = refusal('rejected', 'This routine is already running.')
    expect(afterEdit(LISTED, 'a1' as RoutineId, { do: 'run' }, running, CLOCK)).toEqual({ listed: LISTED, said: 'This routine is already running.', note: null })
    const banana = refusal('rejected', "Hermes couldn't use that schedule: Invalid duration.")
    const change: RoutineEdit = { do: 'reschedule', schedule: 'every banana' }
    expect(afterEdit(LISTED, 'a1' as RoutineId, change, banana, CLOCK)).toEqual({ listed: LISTED, said: null, note: null })
    expect(afterEdit(LISTED, 'a1' as RoutineId, change, refusal('offline', 'Highwing could not reach Hermes.'), CLOCK).said).toBeNull()
    for (const [kind, message] of [['unsupported', "This Hermes can't change a routine's schedule from Highwing."], ['stale', "That routine isn't there any more."]] as const) {
      expect(afterEdit(LISTED, 'a1' as RoutineId, change, refusal(kind, message), CLOCK)).toEqual({ listed: LISTED, said: message, note: null })
    }
  })

  it('leaves a list Hermes refused to give as it is, when an edit lands', () => {
    const refused = refusal('offline', 'gone')
    expect(afterEdit(refused, 'a1' as RoutineId, { do: 'run' }, { ok: true, value: { routine: DIGEST, ran: null } }, CLOCK)).toEqual({ listed: refused, said: null, note: 'Ran Morning digest.' })
  })

  it('reads the list again after Hermes says the routine is not there', () => {
    expect(isGone(refusal('stale', 'x'))).toBe(true)
    for (const answered of [refusal('rejected', 'x'), refusal('unsupported', 'x'), { ok: true, value: { routine: DIGEST, ran: null } } as const]) expect(isGone(answered)).toBe(false)
  })
})

describe('the schedule field', () => {
  const ROW = { schedule: '0 9 * * 1-5' }
  const OPEN = openEditor(ROW)
  const draw = (editor: Editor) => renderToStaticMarkup(<ScheduleEditor name="Morning digest" editor={editor} saveable={canSave(editor, ROW)} onType={() => {}} onSave={() => {}} onCancel={() => {}} />)

  it("starts from the schedule as Hermes words it, and takes Save only for a schedule that is typed and is not the one it has", () => {
    expect(OPEN).toEqual({ text: '0 9 * * 1-5', saving: false, words: null })
    expect(canSave(OPEN, ROW)).toBe(false)
    expect(canSave(typedInto(OPEN, '  0 9 * * 1-5 '), ROW)).toBe(false)
    expect(canSave(typedInto(OPEN, '   '), ROW)).toBe(false)
    expect(canSave(typedInto(OPEN, ''), ROW)).toBe(false)
    expect(canSave(typedInto(OPEN, '0 8 * * 1-5'), ROW)).toBe(true)
    expect(canSave({ ...typedInto(OPEN, '0 8 * * 1-5'), saving: true }, ROW)).toBe(false)
  })

  it('is labelled for the routine, holds the text, and says in one line the forms Hermes reads', () => {
    const html = draw(OPEN)
    expect(html).toMatch(/<label for="([^"]+)">Schedule for Morning digest<\/label><input id="\1" type="text" maxLength="200"[^>]* value="0 9 \* \* 1-5"\/>/)
    expect(html).toContain('autoComplete="off"')
    expect(html).toMatch(/aria-describedby="([^"]+)"/)
    expect(html).toContain(`>${SCHEDULE_HINT}</p>`)
    expect(SCHEDULE_HINT).toBe('Hermes reads forms like every 30m, 0 9 * * 1-5, every monday 9am or in 2h.')
    expect(html).toContain('<button type="button" class="primary" disabled="">Save</button><button type="button">Cancel</button>')
  })

  it('takes Save once the text has changed', () => {
    expect(draw(typedInto(OPEN, '0 8 * * 1-5'))).toContain('<button type="button" class="primary">Save</button>')
  })

  it('says Saving… while Hermes has it, with the field read-only', () => {
    const html = draw({ ...typedInto(OPEN, '0 8 * * 1-5'), saving: true })
    expect(html).toContain('role="status">Saving…</span>')
    expect(html).toContain('readOnly=""')
  })

  it("keeps Hermes's refusal under the field as an alert, until the text changes", () => {
    const refused = afterSave({ ...typedInto(OPEN, 'every banana'), saving: true }, { ok: false, refusal: { kind: 'rejected', message: "Hermes couldn't use that schedule: Invalid duration." } })
    expect(refused).toEqual({ text: 'every banana', saving: false, words: "Hermes couldn't use that schedule: Invalid duration." })
    expect(draw(refused!)).toContain('role="alert">Hermes couldn&#x27;t use that schedule: Invalid duration.</p>')
    expect(typedInto(refused!, 'every 30m').words).toBeNull()
  })

  it('stays open for a refusal that can be tried again, and closes for Hermes taking it or for a control or routine that is gone', () => {
    const saving = { ...typedInto(OPEN, '0 8 * * 1-5'), saving: true }
    const answer = (answered: CommandOutcome<Edited>) => afterSave(saving, answered)
    expect(answer({ ok: true, value: { routine: routine('a1', 'Morning digest', '0 8 * * 1-5'), ran: null } })).toBeNull()
    expect(answer({ ok: false, refusal: { kind: 'offline', message: 'x' } })).toEqual({ ...saving, saving: false, words: 'x' })
    expect(answer({ ok: false, refusal: { kind: 'unsupported', message: 'x' } })).toBeNull()
    expect(answer({ ok: false, refusal: { kind: 'stale', message: 'x' } })).toBeNull()
  })
})

const CSS = readFileSync(new URL('../src/renderer/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function topLevelStyleOf(selector: string): ReadonlyMap<string, string> {
  const style = new Map<string, string>()
  let depth = 0
  let prelude = ''
  let text = ''
  for (const char of CSS) {
    if (char === '{') {
      if (depth === 0) prelude = text.trim()
      depth++
      text = ''
    } else if (char === '}') {
      depth--
      if (depth === 0 && prelude.split(/\s*,\s*/).includes(selector)) {
        for (const line of text.split(';')) {
          const at = line.indexOf(':')
          if (at > 0) style.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
        }
      }
      text = ''
    } else text += char
  }
  return style
}

const rightOf = (shorthand = '0') => { const sides = shorthand.split(/\s+/); return parseFloat(sides[1] ?? sides[0]!) }
const LOOK = ['padding', 'font-size', 'border', 'border-radius', 'background', 'color']

describe('the Routines tab in the details panel', () => {
  it('draws its Pause, Resume and Delete… as the panel\'s Upload picture button, at rest and under the pointer', () => {
    const upload = topLevelStyleOf('.bot-picture button')
    const control = topLevelStyleOf('.routine-controls button')
    expect(Object.fromEntries(LOOK.map(name => [name, control.get(name)]))).toEqual(Object.fromEntries(LOOK.map(name => [name, upload.get(name)])))
    expect(topLevelStyleOf('.routine-controls button:hover:not(:disabled)').get('border-color')).toBe(topLevelStyleOf('.bot-picture button:hover:not(:disabled)').get('border-color'))
  })

  it('draws the schedule field\'s Save and Cancel as the row\'s buttons, and the field as the settings fields', () => {
    const control = topLevelStyleOf('.routine-controls button')
    const edit = topLevelStyleOf('.routine-edit button')
    expect(Object.fromEntries(LOOK.map(name => [name, edit.get(name)]))).toEqual(Object.fromEntries(LOOK.map(name => [name, control.get(name)])))
    expect(topLevelStyleOf('.routine-edit input').get('border')).toBe('1px solid var(--edge)')
  })

  it('ends each row\'s buttons at the panel\'s inner edge, where the tab line and Close end', () => {
    const tab = rightOf(topLevelStyleOf('.routines-tab').get('margin'))
    expect(tab + rightOf(topLevelStyleOf('.routine').get('padding')), 'the rows').toBe(0)
    expect(tab + rightOf(topLevelStyleOf('.routines-tab > .form-choices').get('padding')), 'Close').toBe(0)
  })
})
