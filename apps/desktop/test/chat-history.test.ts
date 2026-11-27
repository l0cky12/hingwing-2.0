import type { BotId, GroupId, SessionId, Shown, ShownGroup } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { NO_VISITS, stepped, visited, visitOf, type Visit, type Visits } from '../src/renderer/chat-history'

const bot = (id: string): Visit => ({ kind: 'bot', bot: id as BotId })
const chat = (id: string): Visit => ({ kind: 'chat', sessionId: id as SessionId })
const botShown = (id: string): Shown => ({ kind: 'bot', bot: id as BotId, sessionId: null })
const chatShown = (id: string): Shown => ({ kind: 'chat', bot: null, sessionId: id as SessionId })
const draft = (id: string, sessionId: string | null = null): Shown =>
  sessionId === null ? { kind: 'new', bot: null, draftId: id, sessionId: null } : { kind: 'new', bot: null, draftId: id, sessionId: sessionId as SessionId }
const through = (...shown: Shown[]): Visits => shown.reduce(visited, NO_VISITS)

describe('visitOf', () => {
  const sessionId = 's1' as SessionId
  const botId = 'b1' as BotId

  it.each<[string, Shown | ShownGroup | null, Visit | null]>([
    ['nothing shown', null, null],
    ['a bot with no chat yet', { kind: 'bot', bot: botId, sessionId: null }, bot('b1')],
    ['a bot with its chat', { kind: 'bot', bot: botId, sessionId }, bot('b1')],
    ['a picked chat', { kind: 'chat', bot: botId, sessionId }, chat('s1')],
    ['a branch', { kind: 'branch', bot: botId, sessionId, text: 'hi' }, chat('s1')],
    ['a new chat with its first message sent', { kind: 'new', bot: botId, draftId: 'd', sessionId }, chat('s1')],
    ['a new chat nothing was sent to', { kind: 'new', bot: botId, draftId: 'd', sessionId: null }, { kind: 'new', bot: botId, draftId: 'd' }],
    ['a group', { kind: 'group', group: 'g1' as GroupId, over: null }, { kind: 'group', group: 'g1' as GroupId }]
  ])('names %s', (_what, shown, visit) => {
    expect(visitOf(shown)).toEqual(visit)
  })
})

describe('visited and stepped', () => {
  it('starts with no visit', () => {
    expect(NO_VISITS).toEqual({ refs: [], at: -1 })
    expect(stepped(NO_VISITS, -1)).toBeNull()
    expect(stepped(NO_VISITS, 1)).toBeNull()
  })

  it('appends each new place and leaves the current one alone', () => {
    const visits = through(botShown('a'), chatShown('1'), chatShown('1'))
    expect(visits).toEqual({ refs: [bot('a'), chat('1')], at: 1 })
    expect(visited(visits, chatShown('1'))).toBe(visits)
  })

  it('walks back and forward and stops at either end', () => {
    const visits = through(botShown('a'), botShown('b'), botShown('c'))
    expect(stepped(visits, 1)).toBeNull()
    const back = stepped(visits, -1)!
    expect(back.at).toBe(1)
    expect(stepped(stepped(back, -1)!, -1)).toBeNull()
    expect(stepped(back, 1)).toEqual(visits)
  })

  it('leaves a place it stepped back to as it is when that chat shows', () => {
    const back = stepped(through(botShown('a'), botShown('b')), -1)!
    expect(visited(back, botShown('a'))).toBe(back)
  })

  it('drops what was ahead when a new place is visited from the middle', () => {
    const back = stepped(stepped(through(botShown('a'), botShown('b'), botShown('c')), -1)!, -1)!
    expect(visited(back, chatShown('1'))).toEqual({ refs: [bot('a'), chat('1')], at: 1 })
  })

  it('keeps a new chat as a place, so back from it goes to the chat before', () => {
    const visits = through(botShown('a'), botShown('b'), draft('d'))
    expect(stepped(visits, -1)?.refs[1]).toEqual(bot('b'))
    expect(stepped(visits, -1)?.at).toBe(1)
  })

  it('turns a new chat into the chat its first message made', () => {
    const visits = through(botShown('a'), draft('d'), draft('d', 's'))
    expect(visits).toEqual({ refs: [bot('a'), chat('s')], at: 1 })
  })

  it('leaves nothing shown out', () => {
    const visits = through(botShown('a'))
    expect(visited(visits, null)).toBe(visits)
  })

  it('keeps the last 100 places', () => {
    const visits = through(...Array.from({ length: 150 }, (_, index) => chatShown(String(index))))
    expect(visits.refs).toHaveLength(100)
    expect(visits.refs[0]).toEqual(chat('50'))
    expect(visits.at).toBe(99)
  })
})
