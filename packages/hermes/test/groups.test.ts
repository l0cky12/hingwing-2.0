import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import { groupIdFor, isGroupId, seatsFor } from '../src/domain/groups'

const bot = (id: string, name: string) => ({ id: id as BotId, name })
const handlesOf = (...picked: ReturnType<typeof bot>[]) => seatsFor(picked).map(seat => seat.handle)

describe('a seat in a new group', () => {
  it('is the profile, asked with the name the sidebar shows', () => {
    expect(seatsFor([bot('default', 'Ada'), bot('sam', 'Sam')])).toEqual([
      { id: 'default', bot: 'default', handle: 'ada', name: 'Ada' },
      { id: 'sam', bot: 'sam', handle: 'sam', name: 'Sam' }
    ])
  })

  it.each([
    ['spaces and marks', bot('timothy', 'Timothy · CEO'), 'timothy-ceo'],
    ['an accent', bot('emile', 'Émile'), 'emile'],
    ['capitals and a trailing mark', bot('dr', 'Dr. Eggbot!'), 'dr-eggbot'],
    ['no Latin letter', bot('kiku', '菊'), 'kiku'],
    ['a name that is a reserved handle', bot('everyone-bot', 'Everyone'), 'everyone-bot'],
    ['a profile no handle may be', bot('night shift', '🌙'), 'night-shift']
  ])('takes a handle Hermes accepts from a name with %s', (_, picked, handle) => {
    expect(handlesOf(picked)).toEqual([handle])
  })

  it('never gives two seats the same handle', () => {
    expect(handlesOf(bot('sam', 'Sam'), bot('sam-2', 'Sam'), bot('sam-3', 'sam'))).toEqual(['sam', 'sam-2', 'sam-3'])
    expect(handlesOf(bot('ops', 'Ops'), bot('oncall', 'Ops'), bot('ops-2', 'Ops'), bot('backup', 'Ops'))).toEqual(['ops', 'oncall', 'ops-2', 'backup'])
    expect(handlesOf(bot('all', 'All'), bot('team', 'All'))).toEqual(['all-2', 'team'])
  })

  it('keeps every handle to an id Hermes accepts', () => {
    const long = seatsFor([bot('long', `${'a'.repeat(70)} b`)])[0]?.handle ?? ''
    expect(long).toBe('a'.repeat(64))
    expect(isGroupId(long)).toBe(true)
  })
})

describe('the id of a new group', () => {
  it('stays the same until Hermes refuses one, and is new after each refusal', () => {
    const dialog = '0f7c2a52-6a5f-4a0b-9d0e-6a3a4f1f2c11'
    expect(groupIdFor(dialog, 0)).toBe(dialog)
    expect(groupIdFor(dialog, 0)).toBe(groupIdFor(dialog, 0))
    expect(new Set([0, 1, 2].map(tries => groupIdFor(dialog, tries))).size).toBe(3)
    expect([0, 1, 2].every(tries => isGroupId(groupIdFor(dialog, tries)))).toBe(true)
  })

  it.each([
    ['launch-plan', true], ['a', true], ['room:2026.11_a-b', true], ['x'.repeat(128), true],
    ['', false], ['-lead', false], ['has space', false], ['x'.repeat(129), false], [42, false], [null, false]
  ])('is %j a room id Hermes takes: %s', (raw, taken) => {
    expect(isGroupId(raw)).toBe(taken)
  })
})
