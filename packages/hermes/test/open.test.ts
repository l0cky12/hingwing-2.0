import { describe, expect, it } from 'vitest'
import type { BotId, Bots } from '../src/domain/bots'
import { rosterOf } from '../src/domain/bots'
import { EMPTY_DESK, launchChat, nextDesk, type Desk, type DeskEffect, type DeskEvent, type Shown } from '../src/domain/open'
import type { SessionId } from '../src/domain/session'

const [EMU, RESEARCH, OPS] = ['default', 'research', 'ops'] as BotId[] as [BotId, BotId, BotId]
const [HOME, R1, R2, O1] = ['local-home', 'local-r1', 'local-r2', 'local-o1'] as SessionId[] as [SessionId, SessionId, SessionId, SessionId]

const asked = (bot: BotId): DeskEvent => ({ on: 'asked', ref: { kind: 'bot', bot } })
const found = (bot: BotId, sessionId: SessionId | null): DeskEvent => ({ on: 'found', bot, sessionId })
const facts = (named: Record<string, SessionId>, launch: Shown | null = null): DeskEvent => ({ on: 'facts', named, launch })

/** The desk after every event, and the effects each event asked for. */
function after(events: readonly DeskEvent[], from: Desk = EMPTY_DESK): { readonly desk: Desk; readonly effects: readonly (readonly DeskEffect[])[] } {
  const effects: (readonly DeskEffect[])[] = []
  const desk = events.reduce((held, event) => {
    const next = nextDesk(held, event)
    effects.push(next.effects)
    return next.desk
  }, from)
  return { desk, effects }
}

const LAUNCHED = after([facts({ [EMU]: HOME, [RESEARCH]: R1 }, { bot: EMU, sessionId: HOME })]).desk

describe('the open chat', () => {
  it.each<[string, readonly DeskEvent[], Desk['open'], readonly (readonly DeskEffect[])[]]>([
    ['shows the launch chat while nothing is shown',
      [facts({ [EMU]: HOME }, { bot: EMU, sessionId: HOME })], { shown: { bot: EMU, sessionId: HOME }, opening: null }, [[]]],
    ['keeps what is shown when Hermes says more later',
      [facts({}, { bot: null, sessionId: HOME }), facts({ [EMU]: R1 }, { bot: EMU, sessionId: R1 })], { shown: { bot: null, sessionId: HOME }, opening: null }, [[], []]],
    ['waits while Hermes has not said enough to pick one',
      [facts({ [RESEARCH]: R1 })], { shown: null, opening: null }, [[]]],
    ['opens a bot whose chat the roster named at once, with no call',
      [facts({ [EMU]: HOME, [RESEARCH]: R1 }, { bot: EMU, sessionId: HOME }), asked(RESEARCH)], { shown: { bot: RESEARCH, sessionId: R1 }, opening: null }, [[], []]],
    ['looks a bot up by its title when its chat is not known, and keeps the chat shown meanwhile',
      [facts({ [EMU]: HOME }, { bot: EMU, sessionId: HOME }), asked(OPS)], { shown: { bot: EMU, sessionId: HOME }, opening: { kind: 'bot', bot: OPS } }, [[], [{ find: OPS }]]],
    ['makes one lookup for two clicks on the same bot',
      [asked(OPS), asked(OPS)], { shown: null, opening: { kind: 'bot', bot: OPS } }, [[{ find: OPS }], []]],
    ['shows the chat a lookup found',
      [asked(OPS), found(OPS, O1)], { shown: { bot: OPS, sessionId: O1 }, opening: null }, [[{ find: OPS }], []]],
    ['shows an unstarted chat for a bot that has none',
      [asked(OPS), found(OPS, null)], { shown: { bot: OPS, sessionId: null }, opening: null }, [[{ find: OPS }], []]],
    ['looks again on a later click at a bot that had no chat',
      [asked(OPS), found(OPS, null), asked(OPS)], { shown: { bot: OPS, sessionId: null }, opening: { kind: 'bot', bot: OPS } }, [[{ find: OPS }], [], [{ find: OPS }]]],
    ['keeps the latest click when an earlier lookup answers after it',
      [facts({ [RESEARCH]: R1 }), asked(OPS), asked(RESEARCH), found(OPS, O1)], { shown: { bot: RESEARCH, sessionId: R1 }, opening: null }, [[], [{ find: OPS }], [], []]],
    ['keeps a later click waiting when an earlier lookup answers first',
      [asked(OPS), asked(RESEARCH), found(OPS, O1)], { shown: null, opening: { kind: 'bot', bot: RESEARCH } }, [[{ find: OPS }], [{ find: RESEARCH }], []]],
    ['keeps the chat shown when a lookup is refused, and stops waiting',
      [facts({ [EMU]: HOME }, { bot: EMU, sessionId: HOME }), asked(OPS), { on: 'failed', bot: OPS }], { shown: { bot: EMU, sessionId: HOME }, opening: null }, [[], [{ find: OPS }], []]],
    ['looks again after a refused lookup',
      [asked(OPS), { on: 'failed', bot: OPS }, asked(OPS)], { shown: null, opening: { kind: 'bot', bot: OPS } }, [[{ find: OPS }], [], [{ find: OPS }]]],
    ['returns to the same chat on a switch back, with no call',
      [asked(OPS), found(OPS, O1), facts({ [RESEARCH]: R1 }), asked(RESEARCH), asked(OPS)], { shown: { bot: OPS, sessionId: O1 }, opening: null }, [[{ find: OPS }], [], [], [], []]],
    ['follows the shown bot to the chat the roster names for it',
      [facts({ [RESEARCH]: R1 }, { bot: RESEARCH, sessionId: R1 }), facts({ [RESEARCH]: R2 })], { shown: { bot: RESEARCH, sessionId: R2 }, opening: null }, [[], []]],
    ['follows the shown bot without answering a click on another one',
      [facts({ [RESEARCH]: R1 }, { bot: RESEARCH, sessionId: R1 }), asked(OPS), facts({ [RESEARCH]: R2 })], { shown: { bot: RESEARCH, sessionId: R2 }, opening: { kind: 'bot', bot: OPS } }, [[], [{ find: OPS }], []]],
    ['leaves the pane alone when the roster names a chat for a bot that is not shown',
      [facts({ [EMU]: HOME }, { bot: EMU, sessionId: HOME }), facts({ [EMU]: HOME, [RESEARCH]: R2 })], { shown: { bot: EMU, sessionId: HOME }, opening: null }, [[], []]],
    ['moves an unstarted chat to the session its first message made',
      [asked(OPS), found(OPS, null), found(OPS, O1)], { shown: { bot: OPS, sessionId: O1 }, opening: null }, [[{ find: OPS }], [], []]],
    ['records a chat made for a bot the user has left, and stays where they are',
      [facts({ [RESEARCH]: R1 }), asked(OPS), found(OPS, null), asked(RESEARCH), found(OPS, O1)], { shown: { bot: RESEARCH, sessionId: R1 }, opening: null }, [[], [{ find: OPS }], [], [], []]]
  ])('%s', (_name, events, open, effects) => {
    const reached = after(events)
    expect(reached.desk.open).toEqual(open)
    expect(reached.effects).toEqual(effects)
  })

  it('knows the owner of every session before it names one, and keeps the owner of a session a bot has moved on from', () => {
    const events = [facts({ [EMU]: HOME, [RESEARCH]: R1 }, { bot: EMU, sessionId: HOME }), asked(OPS), found(OPS, O1), facts({ [RESEARCH]: R2 }), asked(RESEARCH)]
    events.reduce((desk, event) => {
      const next = nextDesk(desk, event).desk
      const { shown } = next.open
      if (shown !== null && shown.bot !== null && shown.sessionId !== null) expect(next.owners[shown.sessionId], JSON.stringify(event)).toBe(shown.bot)
      return next
    }, EMPTY_DESK)
    const { desk } = after(events)
    expect(desk.owners).toEqual({ [HOME]: EMU, [R1]: RESEARCH, [R2]: RESEARCH, [O1]: OPS })
    expect(desk.chats).toEqual({ [EMU]: HOME, [RESEARCH]: R2, [OPS]: O1 })
  })

  it('gives back the same value when an event changes nothing, so nothing is published for it', () => {
    expect(nextDesk(LAUNCHED, facts({ [EMU]: HOME, [RESEARCH]: R1 }, { bot: EMU, sessionId: HOME })).desk.open).toBe(LAUNCHED.open)
    expect(nextDesk(LAUNCHED, found(RESEARCH, R1)).desk.open).toBe(LAUNCHED.open)
    expect(nextDesk(LAUNCHED, { on: 'failed', bot: OPS }).desk.open).toBe(LAUNCHED.open)
  })
})

describe('the chat a connection shows before any click', () => {
  const fact = (id: BotId, isDefault: boolean) => ({ id, name: id, isDefault, section: null, preview: null, chat: null })
  const WITH_DEFAULT: Bots = { state: 'listed', roster: rosterOf([fact(EMU, true), fact(RESEARCH, false)]) }
  const NO_DEFAULT: Bots = { state: 'listed', roster: rosterOf([fact(RESEARCH, false)]) }
  const READY = { status: 'ready', newest: HOME } as const
  const EMPTY = { status: 'ready', newest: null } as const

  it.each<[string, Parameters<typeof launchChat>, Shown | null]>([
    ["is the default bot's Bot Chat on a socket that reaches every profile", ['host', WITH_DEFAULT, { [EMU]: R1 }, READY], { bot: EMU, sessionId: R1 }],
    ['is the default bot unstarted when it has no Bot Chat, whatever the list holds', ['host', WITH_DEFAULT, {}, READY], { bot: EMU, sessionId: null }],
    ['does not wait for the list when there is a default bot', ['host', WITH_DEFAULT, { [EMU]: R1 }, { status: 'loading', newest: null }], { bot: EMU, sessionId: R1 }],
    ['is the newest chat, with no bot, on a socket bound to one profile', ['profile', WITH_DEFAULT, { [EMU]: R1 }, READY], { bot: null, sessionId: HOME }],
    ['is the newest chat when the roster has no default bot', ['host', NO_DEFAULT, {}, READY], { bot: null, sessionId: HOME }],
    ['is the newest chat on a Hermes that cannot list its bots', ['profile', { state: 'unsupported' }, {}, READY], { bot: null, sessionId: HOME }],
    ['is the newest chat when Hermes would not list its bots', ['host', { state: 'refused' }, {}, READY], { bot: null, sessionId: HOME }],
    ['is the newest chat the last list held while a newer one is read', ['profile', { state: 'unsupported' }, {}, { status: 'stale', newest: HOME }], { bot: null, sessionId: HOME }],
    ['is none while the bots are being read', ['host', { state: 'loading' }, {}, READY], null],
    ['is none while there is no connection', [null, WITH_DEFAULT, { [EMU]: R1 }, READY], null],
    ['is none before the first answer about the bots', ['host', { state: 'offline' }, {}, READY], null],
    ['is none while the list is being read', ['profile', { state: 'unsupported' }, {}, { status: 'loading', newest: null }], null],
    ['is none when there is no chat at all', ['profile', { state: 'unsupported' }, {}, EMPTY], null]
  ])('%s', (_name, args, shown) => {
    expect(launchChat(...args)).toEqual(shown)
  })
})
