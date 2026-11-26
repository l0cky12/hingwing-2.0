import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import {
  EMPTY_GROUPS, groupChatOf, groupIdFor, groupsOf, isGroupId, logStart, nextGroups, nextPoll, seatsFor, type GroupDesk, type GroupEvent, type GroupFacts, type GroupId, type GroupNews, type MemberId
} from '../src/domain/groups'
import { groupBook, type GroupWire } from '../src/groups'
import { manualClock } from '../src/testing/clock'
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
    { id: 'default' as BotId, name: 'Ada', preview: null, description: null, tone: 'ink' as const, picture: false, pinned: false, hidden: false },
    { id: 'sam' as BotId, name: 'Sam', preview: null, description: null, tone: 'slate' as const, picture: false, pinned: false, hidden: false }
  ]
  const draft = { group: 'g1' as GroupId, name: 'Launch plan', bots: ROSTER.map(bot => bot.id) }
  const room = { room_id: 'g1', name: 'Launch plan', members: [{ member_id: 'default', profile: 'default', handle: 'ada' }, { member_id: 'sam', profile: 'sam', handle: 'sam' }] }

  const DEPS = { clock: manualClock(), mintId: () => 'minted', changed: () => {} }

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
    const book = groupBook(wire(() => new Promise(resolve => { answer = resolve })), DEPS)
    let settled = false
    const outcome = book.create(draft, ROSTER).then(result => { settled = true; return result })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(settled, 'still waiting for the list').toBe(false)
    answer({ rooms: [room] })
    expect((await outcome).ok).toBe(false)
    expect(book.groups).toMatchObject({ state: 'listed', rows: [{ id: 'g1' }] })
  })

  it('answers a refused create as offline when the list could not be read, so the dialog keeps its id', async () => {
    const book = groupBook(wire(() => Promise.reject(new Offline('down'))), DEPS)
    expect(await book.create(draft, ROSTER)).toMatchObject({ ok: false, refusal: { kind: 'offline' } })
  })
})

describe('what Highwing holds of a group chat', () => {
  const PLAN = 'launch-plan' as GroupId
  const facts = (more: Partial<GroupFacts> = {}): GroupFacts => ({ id: PLAN, name: 'Launch plan', members: [], latestSeq: 3, epoch: 1, ...more })
  const said = (seq: number, id = `user:${seq}`): GroupEvent => ({ kind: 'said', seq, at: seq * 1000, id, text: `message ${seq}` })
  const able: GroupNews = { on: 'support', support: { is: 'able', driver: true, seatable: null } }
  const opened = [able, { on: 'listed', groups: [facts()] }, { on: 'followed', group: PLAN }, { on: 'state', facts: facts(), answering: [], pushes: true }] as const
  const after = (...news: readonly GroupNews[]) => news.reduce(nextGroups, EMPTY_GROUPS)
  const page = (after: number, events: readonly GroupEvent[], cursor = events.at(-1)?.seq ?? after): GroupNews => ({ on: 'page', group: PLAN, after, epoch: 1, events, cursor })
  const shown = (desk: GroupDesk) => {
    const chat = groupChatOf(desk)
    return chat?.at === 'read' ? chat.events.map(event => event.seq) : chat?.at
  }

  it('takes a page only where the last one ended, so one taken twice shows once', () => {
    const once = after(...opened, page(0, [said(1), said(2)]))
    expect(shown(once)).toEqual([1, 2])
    expect(shown(nextGroups(once, page(0, [said(1), said(2)])))).toEqual([1, 2])
    expect(shown(nextGroups(once, page(1, [said(2), said(3)]))), 'a page that overlaps what is shown').toEqual([1, 2])
    expect(shown(nextGroups(once, page(2, [said(3)])))).toEqual([1, 2, 3])
  })

  it('lets a message go from on its way to the thread once the log holds it, and keeps it on its way till then', () => {
    const sending = after(...opened, page(0, []), { on: 'sending', group: PLAN, message: { key: 'k1', eventId: 'user:abc', text: 'Ship it?' } })
    expect(groupChatOf(sending)).toMatchObject({ sending: [{ key: 'k1', text: 'Ship it?' }] })
    expect(groupChatOf(nextGroups(sending, page(0, [said(1)])))).toMatchObject({ sending: [{ key: 'k1' }] })
    expect(groupChatOf(nextGroups(sending, page(0, [said(1, 'user:abc')])))).toMatchObject({ events: [{ id: 'user:abc' }], sending: [] })
  })

  it('does not put a re-sent message on its way again once the log already holds it', () => {
    const delivered = after(...opened, page(0, [said(1, 'user:abc')]))
    const resent = nextGroups(delivered, { on: 'sending', group: PLAN, message: { key: 'k1', eventId: 'user:abc', text: 'message 1' } })
    expect(groupChatOf(resent)).toMatchObject({ events: [{ id: 'user:abc' }], sending: [] })
  })

  it('holds a group whose id is a name every object has, and finds none for one it does not hold', () => {
    const odd = 'constructor' as GroupId
    const desk = after(able, { on: 'listed', groups: [facts({ id: odd })] }, { on: 'followed', group: odd })
    expect(groupsOf(desk)).toMatchObject({ state: 'listed', rows: [{ id: 'constructor', answering: [] }] })
    const other = after(able, { on: 'listed', groups: [facts()] }, { on: 'followed', group: 'toString' as GroupId })
    expect(groupChatOf(other)).toEqual({ group: 'toString', at: 'loading' })
    expect(groupsOf(nextGroups(other, { on: 'page', group: 'valueOf' as GroupId, after: 0, epoch: 1, events: [], cursor: 0 }))).toMatchObject({ rows: [{ id: PLAN }] })
  })

  it('reads the log again from the start of its window once Hermes is in a new epoch, or its log ends before the cursor', () => {
    const read = after(...opened, page(0, [said(1), said(2), said(3)]))
    for (const moved of [facts({ epoch: 2 }), facts({ latestSeq: 1 })]) {
      const desk = nextGroups(read, { on: 'state', facts: moved, answering: [], pushes: true })
      expect(groupChatOf(desk)).toEqual({ group: PLAN, at: 'loading' })
      expect(logStart(desk.held[PLAN]!)).toBe(0)
    }
    const deep = nextGroups(read, { on: 'state', facts: facts({ latestSeq: 1003 }), answering: [], pushes: true })
    expect(logStart(deep.held[PLAN]!), 'a log that only grew is read on from the cursor').toBe(3)
    expect(logStart(after(able, { on: 'listed', groups: [facts({ latestSeq: 1003 })] }).held[PLAN]!), 'a first read starts 400 lines back').toBe(603)
    expect(logStart(after(...opened, page(0, [said(1), said(2), said(3)])).held[PLAN]!), 'nothing new to read').toBeNull()
  })

  it('keeps reading only the shown group and a group someone is answering in, every 15 s behind pushes and every 2 s without', () => {
    const answering = { on: 'state', facts: facts({ id: 'standup' as GroupId }), answering: [{ member: 'mia' as MemberId, doing: 'thinking', tool: null }], pushes: false } as const
    expect(nextPoll(after(able, { on: 'listed', groups: [facts()] })), 'nothing shown, nobody answering').toBeNull()
    expect(nextPoll(after(...opened))).toEqual({ ms: 15_000, groups: [PLAN] })
    expect(nextPoll(after(...opened, answering))).toEqual({ ms: 2_000, groups: [PLAN, 'standup'] })
    expect(nextPoll(after(...opened, { on: 'link', offline: true }))).toBeNull()
  })

  it('keeps the shown group when a list leaves it out, and says it is missing once Hermes says it has none', () => {
    const desk = after(...opened, page(0, [said(1)]), { on: 'listed', groups: [] })
    expect(shown(desk)).toEqual([1])
    expect(groupsOf(desk)).toMatchObject({ rows: [] })
    expect(groupChatOf(nextGroups(desk, { on: 'missing', group: PLAN }))).toEqual({ group: PLAN, at: 'missing' })
  })
})

describe('a message while Hermes stops running group chats', () => {
  it('is refused in the same words as before, and Hermes is asked again so the window learns it', async () => {
    let driver = true
    const asked: string[] = []
    const call = (method: string) => {
      asked.push(method)
      if (method === 'groups.capabilities') return Promise.resolve({ driver })
      if (method === 'groups.list') return Promise.resolve({ rooms: [] })
      driver = false
      return Promise.reject(new RpcRefusal(4001, 'runtime_coordination_required', 'runtime_coordination_required'))
    }
    const book = groupBook({ call } as unknown as GroupWire, { clock: manualClock(), mintId: () => 'k1', changed: () => {} })
    book.online()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(book.groups).toMatchObject({ state: 'listed', driver: true })
    expect(await book.send('launch-plan' as GroupId, 'Ship it?')).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes isn't running group chats right now." } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(book.groups).toMatchObject({ state: 'listed', driver: false })
    expect(asked.filter(method => method === 'groups.capabilities')).toHaveLength(2)
  })
})
