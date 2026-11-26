import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import { groupIdFor, isGroupId, seatsFor, type GroupId } from '../src/domain/groups'
import { groupBook, type GroupWire } from '../src/groups'
import { Offline, RpcRefusal } from '../src/wire/link'

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

describe('making a group while an earlier try may have made it', () => {
  const ROSTER = [
    { id: 'default' as BotId, name: 'Ada', preview: null, description: null, tone: 'ink' as const, picture: false },
    { id: 'sam' as BotId, name: 'Sam', preview: null, description: null, tone: 'slate' as const, picture: false }
  ]
  const draft = { group: 'g1' as GroupId, name: 'Launch plan', bots: ROSTER.map(bot => bot.id) }
  const room = { room_id: 'g1', name: 'Launch plan', members: [{ member_id: 'default', profile: 'default', handle: 'ada' }, { member_id: 'sam', profile: 'sam', handle: 'sam' }] }

  function wire(list: () => Promise<unknown>) {
    const call = (method: string) => {
      if (method === 'groups.capabilities') return Promise.resolve({ driver: true })
      if (method === 'groups.list') return list()
      return Promise.reject(new RpcRefusal(4001, 'invalid_params', 'invalid_params'))
    }
    return { call } as unknown as GroupWire
  }

  it('answers a refused create only after Hermes has listed what the earlier try made', async () => {
    let answer: (value: unknown) => void = () => {}
    const book = groupBook(wire(() => new Promise(resolve => { answer = resolve })), () => {})
    let settled = false
    const outcome = book.create(draft, ROSTER).then(result => { settled = true; return result })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(settled, 'still waiting for the list').toBe(false)
    answer({ rooms: [room] })
    expect((await outcome).ok).toBe(false)
    expect(book.groups).toMatchObject({ state: 'listed', rows: [{ id: 'g1' }] })
  })

  it('answers a refused create as offline when the list could not be read, so the dialog keeps its id', async () => {
    const book = groupBook(wire(() => Promise.reject(new Offline('down'))), () => {})
    expect(await book.create(draft, ROSTER)).toMatchObject({ ok: false, refusal: { kind: 'offline' } })
  })
})
