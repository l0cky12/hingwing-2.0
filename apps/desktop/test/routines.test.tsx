import type { BotId, Routine, RoutineId, RoutineRun, SessionId } from '@highwing/hermes/domain'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RoutinesList, RunsList } from '../src/renderer/bots/Routines'
import { afterControl, NO_RUNS, routinesViewOf, runsViewOf, scheduleWords, tookWords } from '../src/renderer/bots/routines-view'

const NONE = { busy: null, history: { bot: 'rae' as BotId, revision: 1, read: async () => ({ ok: true, value: [] }) as const, onOpen: () => {} }, onToggle: () => {}, onDelete: () => {} }
const routine = (id: string, name: string, schedule: string, paused = false): Routine => ({ id: id as RoutineId, name, schedule, paused, nextRunAt: null })

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

  it('ends each row\'s buttons at the panel\'s inner edge, where the tab line and Close end', () => {
    const tab = rightOf(topLevelStyleOf('.routines-tab').get('margin'))
    expect(tab + rightOf(topLevelStyleOf('.routine').get('padding')), 'the rows').toBe(0)
    expect(tab + rightOf(topLevelStyleOf('.routines-tab > .form-choices').get('padding')), 'Close').toBe(0)
  })
})
