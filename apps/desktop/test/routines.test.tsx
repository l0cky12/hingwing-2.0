import type { Routine, RoutineId } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RoutinesList } from '../src/renderer/bots/Routines'
import { routinesViewOf, scheduleWords } from '../src/renderer/bots/routines-view'

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
  it('lists each routine by name with when it runs, or Paused', () => {
    const view = routinesViewOf({ ok: true, value: [routine('a1', 'Morning digest', '0 9 * * 1-5'), routine('b2', 'Backup check', 'every 60m', true)] }, 'Research')
    const html = renderToStaticMarkup(<RoutinesList view={view} />)
    expect(html).toContain('<ul class="routines" aria-label="Routines">')
    expect([...html.matchAll(/<li class="routine"><span class="routine-name">([^<]*)<\/span><span class="routine-when">([^<]*)<\/span><\/li>/g)].map(([, name, when]) => [name, when])).toEqual([
      ['Morning digest', 'Weekdays at 09:00'],
      ['Backup check', 'Paused']
    ])
  })

  it('says how to make one by asking the bot when it has none', () => {
    expect(routinesViewOf({ ok: true, value: [] }, 'Research')).toEqual({
      state: 'empty', hint: 'Research has no routines yet. To make one, ask Research in a chat, for example "Every weekday at 9am, sum up my unread email."'
    })
  })

  it("shows Hermes's refusal as an alert, and a loading line before the first answer", () => {
    const refused = routinesViewOf({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't show routines to Highwing." } }, 'Research')
    expect(renderToStaticMarkup(<RoutinesList view={refused} />)).toContain('role="alert">This Hermes can&#x27;t show routines to Highwing.</p>')
    expect(renderToStaticMarkup(<RoutinesList view={routinesViewOf(null, 'Research')} />)).toContain('Loading routines…')
  })
})
