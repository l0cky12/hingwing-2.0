import type { Routine, RoutineId } from '@highwing/hermes/domain'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RoutinesList } from '../src/renderer/bots/Routines'
import { afterControl, routinesViewOf, scheduleWords } from '../src/renderer/bots/routines-view'

const NONE = { busy: null, onToggle: () => {}, onDelete: () => {} }
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
      ['Morning digest', 'Weekdays at 09:00', ['Pause Morning digest', 'Delete Morning digest…']],
      ['Backup check', 'Paused', ['Resume Backup check', 'Delete Backup check…']]
    ])
  })

  it('disables every control while one is on its way to Hermes', () => {
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

const CSS = readFileSync(new URL('../src/renderer/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** What the rules outside any at-rule give `selector`, a later rule winning, as the window draws it outside forced colors. */
function styleOf(selector: string): ReadonlyMap<string, string> {
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
    const upload = styleOf('.bot-picture button')
    const control = styleOf('.routine-controls button')
    expect(Object.fromEntries(LOOK.map(name => [name, control.get(name)]))).toEqual(Object.fromEntries(LOOK.map(name => [name, upload.get(name)])))
    expect(styleOf('.routine-controls button:hover:not(:disabled)').get('border-color')).toBe(styleOf('.bot-picture button:hover:not(:disabled)').get('border-color'))
  })

  it('ends each row\'s buttons at the panel\'s inner edge, where the tab line and Close end', () => {
    const tab = rightOf(styleOf('.routines-tab').get('margin'))
    expect(tab + rightOf(styleOf('.routine').get('padding')), 'the rows').toBe(0)
    expect(tab + rightOf(styleOf('.routines-tab > .form-choices').get('padding')), 'Close').toBe(0)
  })
})
