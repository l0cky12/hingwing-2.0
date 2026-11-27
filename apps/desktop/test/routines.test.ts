import { describe, expect, it } from 'vitest'
import { scheduleWords } from '../src/renderer/bots/routines'

describe("a routine's schedule in plain words", () => {
  it.each([
    ['every 30m', 'Every 30 minutes'],
    ['every 60m', 'Every hour'],
    ['every 120m', 'Every 2 hours'],
    ['every 90m', 'Every 90 minutes'],
    ['every 1440m', 'Every day'],
    ['every 2880m', 'Every 2 days'],
    ['once in 2h', 'Once, in 2 hours'],
    ['once in 30 minutes', 'Once, in 30 minutes'],
    ['once at 2026-01-05 09:00', 'Once, on January 5, 2026 at 9:00'],
    ['0 9 * * *', 'Every day at 9:00'],
    ['0 9 * * 1-5', 'Weekdays at 9:00'],
    ['0 10 * * 6,0', 'Weekends at 10:00'],
    ['30 8 * * 1', 'Mondays at 8:30'],
    ['0 17 * * 1,4', 'Mondays and Thursdays at 17:00'],
    ['*/15 * * * *', 'Every 15 minutes'],
    ['0 * * * *', 'Every hour'],
    ['15 * * * *', 'Every hour at 15 past']
  ])('says %s as %s', (schedule, words) => {
    expect(scheduleWords(schedule)).toBe(words)
  })

  it.each(['0 9 1 * *', '0 9-17 * * *', '0 25 * * *', '*/0 * * * *', '*/45 * * * *', 'every 0m', 'every weekday at 9am', '?'])('keeps %s as Hermes wrote it', schedule => {
    expect(scheduleWords(schedule)).toBe(schedule)
  })
})
