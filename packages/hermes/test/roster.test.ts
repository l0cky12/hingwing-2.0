import { describe, expect, it } from 'vitest'
import { botsIn, type BotId, type Bots } from '../src/domain/bots'
import { botList } from '../src/roster'
import { settle } from '../src/testing/clock'
import { Offline, RpcRefusal, type Connection } from '../src/wire/link'
import { PROFILES } from './support/errand'

const UNKNOWN_METHOD = new RpcRefusal(-32601, 'unknown_method', 'unknown method: profiles.list')
const DENIED = new RpcRefusal(4001, 'permission_denied', 'permission_denied')
const ONE_BOT = { profiles: [{ name: 'solo', path: '/profiles/solo' }] }
const RESEARCH = 'research' as BotId
const editionOf = (bots: Bots) => (bots.state === 'listed' ? bots.edition : null)
const flagsOf = (bots: Bots, bot: BotId) => {
  const held = bots.state === 'listed' ? botsIn(bots.roster).find(each => each.id === bot) : undefined
  return held && { pinned: held.pinned, hidden: held.hidden }
}

function hermes() {
  const waiting: { resolve(reply: unknown): void; reject(error: Error): void }[] = []
  const state = { asked: 0, changes: 0 }
  const call = (() => {
    state.asked++
    return new Promise((resolve, reject) => waiting.push({ resolve, reject }))
  }) as Connection['call']
  const list = botList({ call }, () => state.changes++)
  const answer = async (how: (ask: (typeof waiting)[number]) => void) => {
    how(waiting.shift() ?? (() => { throw new Error('Highwing has not asked') })())
    await settle()
  }
  list.linked('online')
  list.ask()
  return { list, state, answer }
}

describe('what Highwing knows about the bots', () => {
  it('is loading until Hermes answers, then the roster', async () => {
    const { list, answer } = hermes()
    expect(list.bots).toEqual({ state: 'loading' })
    await answer(ask => ask.resolve(PROFILES))
    expect(list.bots).toMatchObject({ state: 'listed', roster: { featured: { name: 'Emu' } } })
  })

  it('is refused when Hermes would not answer, and asks again when sessions change', async () => {
    const { list, state, answer } = hermes()
    await answer(ask => ask.reject(DENIED))
    expect(list.bots).toEqual({ state: 'refused' })
    list.refresh()
    expect(state.asked).toBe(2)
    await answer(ask => ask.resolve(PROFILES))
    expect(list.bots.state).toBe('listed')
  })

  it('is unsupported when Hermes has no such call, stops asking on that socket, and asks once on the next', async () => {
    const { list, state, answer } = hermes()
    await answer(ask => ask.reject(UNKNOWN_METHOD))
    expect(list.bots).toEqual({ state: 'unsupported' })
    list.refresh()
    list.refresh()
    expect(state.asked, 'no ask on the socket that said no').toBe(1)

    list.linked('waiting')
    list.linked('connecting')
    list.linked('online')
    expect(list.bots, 'no empty list while the new socket is asked').toEqual({ state: 'unsupported' })
    list.ask()
    expect(state.asked).toBe(2)
    await answer(ask => ask.resolve(PROFILES))
    expect(list.bots.state, 'this Hermes was updated').toBe('listed')
  })

  it('keeps a roster through a refusal, a call that got no reply, and a lost link', async () => {
    const { list, answer } = hermes()
    await answer(ask => ask.resolve(PROFILES))
    const listed = list.bots
    for (const failure of [DENIED, new Offline('profiles.list got no reply in 10000 ms')]) {
      list.refresh()
      await answer(ask => ask.reject(failure))
      expect(list.bots).toBe(listed)
    }
    list.linked('waiting')
    list.linked('blocked')
    expect(list.bots).toBe(listed)
  })

  it('is offline when the link fails before any answer, and loading again once it is up', async () => {
    const { list, answer } = hermes()
    list.linked('waiting')
    await answer(ask => ask.reject(new Offline('The socket closed before the gateway replied.')))
    expect(list.bots).toEqual({ state: 'offline' })
    list.linked('connecting')
    expect(list.bots).toEqual({ state: 'offline' })
    list.linked('online')
    expect(list.bots).toEqual({ state: 'loading' })
  })

  it('runs one more ask after the one in flight, however often it is asked meanwhile', async () => {
    const { list, state, answer } = hermes()
    list.refresh()
    list.refresh()
    list.ask()
    expect(state.asked).toBe(1)
    await answer(ask => ask.resolve(PROFILES))
    expect(state.asked).toBe(2)
    await answer(ask => ask.resolve(PROFILES))
    expect(state.asked).toBe(2)
  })

  it('reports a change once, and not an answer that changed nothing', async () => {
    const { list, state, answer } = hermes()
    await answer(ask => ask.resolve(PROFILES))
    expect(state.changes).toBe(1)
    list.refresh()
    await answer(ask => ask.resolve(structuredClone(PROFILES)))
    expect(state.changes, 'the same bots again').toBe(1)
    list.refresh()
    await answer(ask => ask.resolve(ONE_BOT))
    expect(state.changes).toBe(2)
    expect(list.bots).toMatchObject({ state: 'listed', roster: { featured: null, sections: [{ name: null, bots: [{ id: 'solo' }] }] } })
  })

  it('knows the Bot Chat of each bot that has one, and reports a change when only a chat changed', async () => {
    const { list, state, answer } = hermes()
    expect(list.chats).toEqual({})
    await answer(ask => ask.resolve(PROFILES))
    expect(list.chats).toEqual({ 'dr-eggbot': 'local-0000', research: 'local-0001', timothy: 'local-0002', highwing: 'local-0004' })
    const moved = structuredClone(PROFILES) as { profiles: { canonical_session: { id: string; resolved_id: string } | null }[] }
    moved.profiles[2]!.canonical_session!.resolved_id = 'local-0001-compressed'
    moved.profiles[4]!.canonical_session = { id: 'local-0009', resolved_id: '' }
    list.refresh()
    await answer(ask => ask.resolve(moved))
    expect(state.changes, 'the same bots, drawn the same').toBe(2)
    expect(list.chats).toMatchObject({ research: 'local-0001-compressed', 'hermes-dev': 'local-0009' })
    list.refresh()
    await answer(ask => ask.reject(DENIED))
    expect(list.chats, 'kept through a refusal, as the roster is').toMatchObject({ research: 'local-0001-compressed' })
  })

  it('counts the rosters it publishes from 1, and not an answer that drew the same roster', async () => {
    const { list, answer } = hermes()
    await answer(ask => ask.resolve(PROFILES))
    expect(editionOf(list.bots)).toBe(1)
    const moved = structuredClone(PROFILES) as { profiles: { canonical_session: { resolved_id: string } | null }[] }
    moved.profiles[2]!.canonical_session!.resolved_id = 'local-0001-compressed'
    list.refresh()
    await answer(ask => ask.resolve(moved))
    expect(editionOf(list.bots), 'only a Bot Chat moved').toBe(1)
    list.refresh()
    await answer(ask => ask.resolve(ONE_BOT))
    expect(editionOf(list.bots)).toBe(2)
  })
})

describe('a flag Hermes confirmed', () => {
  it('shows at once in a new edition, which it answers, and the roster is asked for again', async () => {
    const { list, state, answer } = hermes()
    await answer(ask => ask.resolve(PROFILES))
    expect(list.confirm(RESEARCH, { flag: 'pinned', on: true })).toBe(2)
    expect([editionOf(list.bots), flagsOf(list.bots, RESEARCH)]).toEqual([2, { pinned: true, hidden: false }])
    expect(state.changes).toBe(2)
    expect(state.asked).toBe(2)
  })

  it('is not put back by an answer to an ask sent before it, which is asked for again', async () => {
    const { list, state, answer } = hermes()
    await answer(ask => ask.resolve(PROFILES))
    list.refresh()
    list.confirm(RESEARCH, { flag: 'hidden', on: true })
    await answer(ask => ask.resolve(PROFILES))
    expect(flagsOf(list.bots, RESEARCH), 'the answer from before the write').toEqual({ pinned: false, hidden: true })
    expect(state.asked).toBe(3)
    await answer(ask => ask.resolve(PROFILES))
    expect(flagsOf(list.bots, RESEARCH), 'an answer from after the write').toEqual({ pinned: false, hidden: false })
  })

  it('stays when the read after it is refused or gets no reply', async () => {
    for (const failure of [DENIED, new Offline('profiles.list got no reply in 10000 ms')]) {
      const { list, answer } = hermes()
      await answer(ask => ask.resolve(PROFILES))
      list.confirm(RESEARCH, { flag: 'pinned', on: true })
      await answer(ask => ask.reject(failure))
      expect(flagsOf(list.bots, RESEARCH)).toEqual({ pinned: true, hidden: false })
    }
  })

  it('changes nothing for a bot the roster does not list, answers the edition it has, and still asks', async () => {
    const { list, state, answer } = hermes()
    await answer(ask => ask.resolve(PROFILES))
    const listed = list.bots
    expect(list.confirm('gone' as BotId, { flag: 'pinned', on: true })).toBe(1)
    expect(list.bots).toBe(listed)
    expect(state.asked).toBe(2)
  })
})
