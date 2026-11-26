import { describe, expect, it } from 'vitest'
import { botActivitiesOf, unreadAfter, type Busy, type ChatBusy, type UnreadChat } from '../src/domain/activity'
import type { BotId } from '../src/domain/bots'
import type { SessionId } from '../src/domain/session'

const [ADA, SAM] = ['ada', 'sam'] as BotId[] as [BotId, BotId]
const [ONE, TWO, THREE] = ['s1', 's2', 's3'] as SessionId[] as [SessionId, SessionId, SessionId]
const busy = (...chats: readonly [SessionId, BotId, ChatBusy][]) => new Map<SessionId, Busy>(chats.map(([chat, bot, state]) => [chat, { bot, busy: state }]))
const NONE = busy()
const NOTHING_SHOWN: ReadonlySet<SessionId> = new Set()

describe('unreadAfter', () => {
  it('marks a chat whose turn ended while no window showed it', () => {
    expect(unreadAfter([], busy([ONE, ADA, 'working']), NONE, NOTHING_SHOWN)).toEqual([{ chat: ONE, bot: ADA }])
    expect(unreadAfter([], busy([ONE, ADA, 'waiting']), NONE, NOTHING_SHOWN), 'a refused approval ends the turn too').toEqual([{ chat: ONE, bot: ADA }])
  })

  it('marks nothing for a turn that ended on screen, or one still under way', () => {
    expect(unreadAfter([], busy([ONE, ADA, 'working']), NONE, new Set([ONE]))).toEqual([])
    expect(unreadAfter([], busy([ONE, ADA, 'working']), busy([ONE, ADA, 'waiting']), NOTHING_SHOWN)).toEqual([])
  })

  it('marks a chat once, however many turns end in it', () => {
    const held: readonly UnreadChat[] = [{ chat: ONE, bot: ADA }]
    expect(unreadAfter(held, busy([ONE, ADA, 'working']), NONE, NOTHING_SHOWN)).toBe(held)
  })

  it('reads every chat a window shows', () => {
    const held: readonly UnreadChat[] = [{ chat: ONE, bot: ADA }, { chat: TWO, bot: SAM }]
    expect(unreadAfter(held, NONE, NONE, new Set([TWO]))).toEqual([{ chat: ONE, bot: ADA }])
  })

  it('returns the same list when nothing changed', () => {
    const held: readonly UnreadChat[] = [{ chat: ONE, bot: ADA }]
    expect(unreadAfter(held, busy([TWO, SAM, 'working']), busy([TWO, SAM, 'working']), new Set([THREE]))).toBe(held)
  })
})

describe('botActivitiesOf', () => {
  it('shows waiting over working over unread, per bot', () => {
    const unread: readonly UnreadChat[] = [{ chat: THREE, bot: ADA }, { chat: 's4' as SessionId, bot: SAM }]
    expect(botActivitiesOf(busy([ONE, ADA, 'working'], [TWO, ADA, 'waiting']), unread)).toEqual({ ada: 'waiting', sam: 'unread' })
    expect(botActivitiesOf(busy([ONE, ADA, 'working']), unread)).toEqual({ ada: 'working', sam: 'unread' })
    expect(botActivitiesOf(busy([TWO, ADA, 'waiting'], [ONE, ADA, 'working']), [])).toEqual({ ada: 'waiting' })
  })

  it('leaves out a bot with nothing to show', () => {
    expect(botActivitiesOf(NONE, [])).toEqual({})
  })
})
