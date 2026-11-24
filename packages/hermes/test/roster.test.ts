import { describe, expect, it } from 'vitest'
import { botList } from '../src/roster'
import { settle } from '../src/testing/clock'
import { Offline, RpcRefusal, type Connection } from '../src/wire/link'
import { PROFILES } from './support/errand'

const UNKNOWN_METHOD = new RpcRefusal(-32601, 'unknown_method', 'unknown method: profiles.list')
const DENIED = new RpcRefusal(4001, 'permission_denied', 'permission_denied')
const ONE_BOT = { profiles: [{ name: 'solo', path: '/profiles/solo' }] }

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
})
