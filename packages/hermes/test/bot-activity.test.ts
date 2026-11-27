import { describe, expect, it } from 'vitest'
import type { UnreadChat } from '../src/domain/activity'
import type { BotId } from '../src/domain/bots'
import type { SessionId } from '../src/domain/session'
import { openHermes } from '../src/hub'
import { STATUS_BUSY } from '../src/activity'
import { manualClock } from '../src/testing/clock'
import { scriptedDialer, type Fixture } from '../src/testing/fixture'
import { BOUND, callsIn, SESSION, WITH_CHATS } from './support/errand'

const EGGBOT = 'dr-eggbot' as BotId
/** The Bot Chat `chats.json` names for dr eggbot. */
const EGGBOT_CHAT = 'local-0000' as SessionId
const TURN_MS = 6_000
const SLOW: Fixture = { ...WITH_CHATS, header: { ...WITH_CHATS.header, turnMs: { [EGGBOT]: TURN_MS } } }
const OLD: Fixture = { ...SLOW, header: { ...SLOW.header, activeList: false } }

function open(fixture: Fixture, kept: readonly UnreadChat[] = []) {
  const clock = manualClock()
  const script = scriptedDialer(fixture, { clock })
  const writes: (readonly UnreadChat[])[] = []
  const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0' }, unread: { chats: kept, keep: chats => writes.push(chats) } })
  const asked = () => callsIn(script.received).filter(call => call.method === 'session.active_list')
  return { clock, hermes, writes, asked }
}

/** Opens dr eggbot, sends in its Bot Chat, and moves the window to the default bot's chat while the turn runs. */
async function leaveTurnRunning(opened: ReturnType<typeof open>) {
  await opened.clock.advance(0)
  await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: EGGBOT } })
  const stop = opened.hermes.watch(EGGBOT_CHAT, () => {})
  await opened.clock.advance(0)
  expect(await opened.hermes.run({ do: 'send', sessionId: EGGBOT_CHAT, text: 'hello' })).toEqual({ ok: true, value: null })
  await opened.clock.advance(0)
  stop()
  await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: 'default' as BotId } })
  opened.hermes.watch(SESSION, () => {})
  await opened.clock.advance(0)
}

describe('bot activity', () => {
  it("shows a chat Hermes lists as waiting in a bot no window shows, with nothing attached", async () => {
    const opened = open(WITH_CHATS)
    expect(opened.hermes.activity.get()).toEqual({})
    await opened.clock.advance(0)
    expect(opened.hermes.activity.get()).toEqual({ research: 'waiting' })
    expect(opened.asked().map(call => call.params?.profile), 'each bot through its own profile').toEqual(['default', 'dr-eggbot', 'research', 'timothy', 'hermes-dev', 'highwing'])
  })

  it('shows a bot working while its turn runs off screen, then unread once it ends, until its chat is shown again', async () => {
    const opened = open(SLOW)
    await leaveTurnRunning(opened)
    expect(opened.hermes.activity.get()).toEqual({ [EGGBOT]: 'working', research: 'waiting' })
    expect(opened.writes).toEqual([])

    await opened.clock.advance(TURN_MS)
    expect(opened.hermes.activity.get()).toEqual({ [EGGBOT]: 'unread', research: 'waiting' })
    expect(opened.writes, 'kept once').toEqual([[{ chat: EGGBOT_CHAT, bot: EGGBOT }]])

    opened.hermes.watch(EGGBOT_CHAT, () => {})
    expect(opened.hermes.activity.get()).toEqual({ research: 'waiting' })
    expect(opened.writes.at(-1)).toEqual([])
  })

  it('marks nothing unread for a turn that ends while a window shows it', async () => {
    const opened = open(SLOW)
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'open', ref: { kind: 'bot', bot: EGGBOT } })
    opened.hermes.watch(EGGBOT_CHAT, () => {})
    await opened.clock.advance(0)
    await opened.hermes.run({ do: 'send', sessionId: EGGBOT_CHAT, text: 'hello' })
    await opened.clock.advance(0)
    expect(opened.hermes.activity.get()[EGGBOT]).toBe('working')
    await opened.clock.advance(TURN_MS)
    expect(opened.hermes.activity.get()[EGGBOT]).toBeUndefined()
    expect(opened.writes).toEqual([])
  })

  it('shows the unread chats kept from the last run at once', () => {
    const opened = open(WITH_CHATS, [{ chat: EGGBOT_CHAT, bot: EGGBOT }])
    expect(opened.hermes.activity.get()).toEqual({ [EGGBOT]: 'unread' })
  })

  it('drops a kept chat whose bot is no longer listed', async () => {
    const opened = open(WITH_CHATS, [{ chat: 'local-9999' as SessionId, bot: 'gone' as BotId }])
    await opened.clock.advance(0)
    expect(opened.hermes.activity.get()).toEqual({ research: 'waiting' })
    expect(opened.writes).toEqual([[]])
  })

  it('shows what attached chats say on a Hermes without the call, which is asked once', async () => {
    const opened = open(OLD)
    await leaveTurnRunning(opened)
    expect(opened.hermes.activity.get(), 'the waiting chat is attached by nothing').toEqual({ [EGGBOT]: 'working' })
    await opened.clock.advance(TURN_MS)
    expect(opened.hermes.activity.get()).toEqual({ [EGGBOT]: 'unread' })
    expect(opened.asked()).toHaveLength(1)
  })

  it('asks nothing on a Hermes whose socket reaches one profile', async () => {
    const opened = open(BOUND)
    await opened.clock.advance(1_000)
    expect(opened.asked()).toEqual([])
  })
})

describe('the status of a live chat', () => {
  it("is working for a turn under way, waiting for one an approval or a question holds, and nothing for an open chat with no turn", () => {
    expect(STATUS_BUSY).toEqual({ idle: null, starting: 'working', working: 'working', streaming: 'working', resuming: 'working', waiting: 'waiting' })
  })
})
