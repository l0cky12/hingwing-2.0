import { describe, expect, it } from 'vitest'
import { activityDesk, type Attached } from '../src/activity'
import { activityIn, botActivitiesOf, unreadAfter, type Busy, type ChatBusy, type UnreadChat } from '../src/domain/activity'
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

describe('a bot named like an object property', () => {
  it('still shows its activity', () => {
    const [CONSTRUCTOR, TO_STRING] = ['constructor', 'toString'] as BotId[] as [BotId, BotId]
    const shown = botActivitiesOf(busy([ONE, CONSTRUCTOR, 'working']), [{ chat: TWO, bot: TO_STRING }])
    expect(activityIn(shown, CONSTRUCTOR)).toBe('working')
    expect(activityIn(shown, TO_STRING)).toBe('unread')
    expect(activityIn({}, CONSTRUCTOR)).toBeNull()
  })
})

describe('activityDesk', () => {
  const row = (id: SessionId, status: string, count: number) => ({
    current: false, id, session_key: id, last_active: 0, started_at: 0, message_count: count, model: '', preview: '', title: '', status
  })
  const desk = (replies: (readonly ReturnType<typeof row>[])[], shown: ReadonlySet<SessionId> = NOTHING_SHOWN, attached: ReadonlyMap<SessionId, Attached> = new Map()) => {
    const kept: (readonly UnreadChat[])[] = []
    const conn = { reach: 'host', as: () => ({ call: async () => ({ sessions: replies.shift() ?? [] }) }) } as unknown as Parameters<typeof activityDesk>[0]
    const made = activityDesk(conn, { unread: [], keep: chats => kept.push(chats), local: () => ({ attached, shown }), changed: () => {} })
    return { made, kept }
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))

  it('marks a chat unread when a turn started and ended between two sweeps', async () => {
    const { made, kept } = desk([[row(ONE, 'idle', 2)], [row(ONE, 'idle', 4)]])
    made.roster([ADA])
    await settle()
    expect(made.activity).toEqual({})
    made.poll()
    await settle()
    expect(made.activity).toEqual({ ada: 'unread' })
    expect(kept.at(-1)).toEqual([{ chat: ONE, bot: ADA }])
  })

  it('marks nothing for such a turn in a chat a window shows, or for a chat first seen idle', async () => {
    const shown = desk([[row(ONE, 'idle', 2)], [row(ONE, 'idle', 4)]], new Set([ONE]))
    shown.made.roster([ADA])
    await settle()
    shown.made.poll()
    await settle()
    expect(shown.made.activity).toEqual({})
    const fresh = desk([[row(ONE, 'idle', 4)]])
    fresh.made.roster([ADA])
    await settle()
    expect(fresh.made.activity).toEqual({})
    expect(fresh.kept).toEqual([])
  })

  it('marks nothing when a late sweep counts a turn an attached chat already showed', async () => {
    const { made, kept } = desk([[row(ONE, 'idle', 2)], [row(ONE, 'idle', 4)]], NOTHING_SHOWN, new Map([[ONE, { bot: ADA, busy: null }]]))
    made.roster([ADA])
    await settle()
    made.poll()
    await settle()
    expect(made.activity).toEqual({})
    expect(kept).toEqual([])
  })
})
