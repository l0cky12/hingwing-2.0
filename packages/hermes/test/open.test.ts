import { describe, expect, it } from 'vitest'
import type { BotId, Bots } from '../src/domain/bots'
import { rosterOf } from '../src/domain/bots'
import { EMPTY_DESK, launchChat, nextDesk, type Desk, type DeskEffect, type DeskEvent, type OpenChat, type Shown } from '../src/domain/open'
import type { SessionId } from '../src/domain/session'
import { chatDesk, type DeskDeps } from '../src/open'
import { Offline, RpcRefusal } from '../src/wire/link'

const [EMU, RESEARCH, OPS] = ['default', 'research', 'ops'] as BotId[] as [BotId, BotId, BotId]
const [HOME, R1, R2, O1] = ['local-home', 'local-r1', 'local-r2', 'local-o1'] as SessionId[] as [SessionId, SessionId, SessionId, SessionId]

const asked = (bot: BotId): DeskEvent => ({ on: 'asked', ref: { kind: 'bot', bot } })
const found = (bot: BotId, sessionId: SessionId | null): DeskEvent => ({ on: 'found', bot, sessionId })
const facts = (named: Record<string, SessionId>, launch: Shown | null = null): DeskEvent => ({ on: 'facts', named, launch })
const askedNew = (bot: BotId | null, draftId: string): DeskEvent => ({ on: 'asked', ref: { kind: 'new', bot, draftId } })
const made = (bot: BotId | null, draftId: string, sessionId: SessionId): DeskEvent => ({ on: 'made', bot, draftId, sessionId })
const picked = (sessionId: SessionId): DeskEvent => ({ on: 'asked', ref: { kind: 'chat', sessionId } })
const listed = (bot: BotId, sessions: readonly SessionId[]): DeskEvent => ({ on: 'listed', bot, sessions })
const branched = (from: SessionId, sessionId: SessionId, text: string): DeskEvent => ({ on: 'branched', from, sessionId, text })
const linked = (sessionId: SessionId): DeskEvent => ({ on: 'asked', ref: { kind: 'link', sessionId } })
const sought = (sessionId: SessionId, bot: BotId | null): DeskEvent => ({ on: 'sought', sessionId, found: bot === null ? { in: 'own' } : { in: 'bot', bot } })
const nowhere = (sessionId: SessionId): DeskEvent => ({ on: 'sought', sessionId, found: { in: 'none' } })
const [B1, B2] = ['local-b1', 'local-b2'] as SessionId[] as [SessionId, SessionId]
const draft = (bot: BotId | null, draftId: string, sessionId: SessionId | null = null): Shown => ({ kind: 'new', bot, draftId, sessionId } as Shown)

function after(events: readonly DeskEvent[], from: Desk = EMPTY_DESK): { readonly desk: Desk; readonly effects: readonly (readonly DeskEffect[])[] } {
  const effects: (readonly DeskEffect[])[] = []
  const desk = events.reduce((held, event) => {
    const next = nextDesk(held, event)
    effects.push(next.effects)
    return next.desk
  }, from)
  return { desk, effects }
}

const LAUNCHED = after([facts({ [EMU]: HOME, [RESEARCH]: R1 }, { kind: 'bot', bot: EMU, sessionId: HOME })]).desk

type Expected = Omit<OpenChat, 'missing'> & Partial<Pick<OpenChat, 'missing'>>

describe('the open chat', () => {
  it.each<[string, readonly DeskEvent[], Expected, readonly (readonly DeskEffect[])[]]>([
    ['shows the launch chat while nothing is shown',
      [facts({ [EMU]: HOME }, { kind: 'bot', bot: EMU, sessionId: HOME })], { shown: { kind: 'bot', bot: EMU, sessionId: HOME }, opening: null }, [[]]],
    ['keeps what is shown when Hermes says more later',
      [facts({}, { kind: 'chat', bot: null, sessionId: HOME }), facts({ [EMU]: R1 }, { kind: 'bot', bot: EMU, sessionId: R1 })], { shown: { kind: 'chat', bot: null, sessionId: HOME }, opening: null }, [[], []]],
    ['waits while Hermes has not said enough to pick one',
      [facts({ [RESEARCH]: R1 })], { shown: null, opening: null }, [[]]],
    ['opens a bot whose chat the roster named at once, with no call',
      [facts({ [EMU]: HOME, [RESEARCH]: R1 }, { kind: 'bot', bot: EMU, sessionId: HOME }), asked(RESEARCH)], { shown: { kind: 'bot', bot: RESEARCH, sessionId: R1 }, opening: null }, [[], []]],
    ['looks a bot up by its title when its chat is not known, and keeps the chat shown meanwhile',
      [facts({ [EMU]: HOME }, { kind: 'bot', bot: EMU, sessionId: HOME }), asked(OPS)], { shown: { kind: 'bot', bot: EMU, sessionId: HOME }, opening: { kind: 'bot', bot: OPS } }, [[], [{ find: OPS }]]],
    ['makes one lookup for two clicks on the same bot',
      [asked(OPS), asked(OPS)], { shown: null, opening: { kind: 'bot', bot: OPS } }, [[{ find: OPS }], []]],
    ['shows the chat a lookup found',
      [asked(OPS), found(OPS, O1)], { shown: { kind: 'bot', bot: OPS, sessionId: O1 }, opening: null }, [[{ find: OPS }], []]],
    ['shows an unstarted chat for a bot that has none',
      [asked(OPS), found(OPS, null)], { shown: { kind: 'bot', bot: OPS, sessionId: null }, opening: null }, [[{ find: OPS }], []]],
    ['looks again on a later click at a bot that had no chat',
      [asked(OPS), found(OPS, null), asked(OPS)], { shown: { kind: 'bot', bot: OPS, sessionId: null }, opening: { kind: 'bot', bot: OPS } }, [[{ find: OPS }], [], [{ find: OPS }]]],
    ['keeps the latest click when an earlier lookup answers after it',
      [facts({ [RESEARCH]: R1 }), asked(OPS), asked(RESEARCH), found(OPS, O1)], { shown: { kind: 'bot', bot: RESEARCH, sessionId: R1 }, opening: null }, [[], [{ find: OPS }], [], []]],
    ['keeps a later click waiting when an earlier lookup answers first',
      [asked(OPS), asked(RESEARCH), found(OPS, O1)], { shown: null, opening: { kind: 'bot', bot: RESEARCH } }, [[{ find: OPS }], [{ find: RESEARCH }], []]],
    ['keeps the chat shown when a lookup is refused, and stops waiting',
      [facts({ [EMU]: HOME }, { kind: 'bot', bot: EMU, sessionId: HOME }), asked(OPS), { on: 'failed', bot: OPS }], { shown: { kind: 'bot', bot: EMU, sessionId: HOME }, opening: null }, [[], [{ find: OPS }], []]],
    ['looks again after a refused lookup',
      [asked(OPS), { on: 'failed', bot: OPS }, asked(OPS)], { shown: null, opening: { kind: 'bot', bot: OPS } }, [[{ find: OPS }], [], [{ find: OPS }]]],
    ['returns to the same chat on a switch back, with no call',
      [asked(OPS), found(OPS, O1), facts({ [RESEARCH]: R1 }), asked(RESEARCH), asked(OPS)], { shown: { kind: 'bot', bot: OPS, sessionId: O1 }, opening: null }, [[{ find: OPS }], [], [], [], []]],
    ['follows the shown bot to the chat the roster names for it',
      [facts({ [RESEARCH]: R1 }, { kind: 'bot', bot: RESEARCH, sessionId: R1 }), facts({ [RESEARCH]: R2 })], { shown: { kind: 'bot', bot: RESEARCH, sessionId: R2 }, opening: null }, [[], []]],
    ['follows the shown bot without answering a click on another one',
      [facts({ [RESEARCH]: R1 }, { kind: 'bot', bot: RESEARCH, sessionId: R1 }), asked(OPS), facts({ [RESEARCH]: R2 })], { shown: { kind: 'bot', bot: RESEARCH, sessionId: R2 }, opening: { kind: 'bot', bot: OPS } }, [[], [{ find: OPS }], []]],
    ['leaves the pane alone when the roster names a chat for a bot that is not shown',
      [facts({ [EMU]: HOME }, { kind: 'bot', bot: EMU, sessionId: HOME }), facts({ [EMU]: HOME, [RESEARCH]: R2 })], { shown: { kind: 'bot', bot: EMU, sessionId: HOME }, opening: null }, [[], []]],
    ['moves an unstarted chat to the session its first message made',
      [asked(OPS), found(OPS, null), found(OPS, O1)], { shown: { kind: 'bot', bot: OPS, sessionId: O1 }, opening: null }, [[{ find: OPS }], [], []]],
    ['records a chat made for a bot the user has left, and stays where they are',
      [facts({ [RESEARCH]: R1 }), asked(OPS), found(OPS, null), asked(RESEARCH), found(OPS, O1)], { shown: { kind: 'bot', bot: RESEARCH, sessionId: R1 }, opening: null }, [[], [{ find: OPS }], [], [], []]],
    ['shows a new chat at once, with no call, and lets an earlier click go',
      [facts({ [EMU]: HOME }, { kind: 'bot', bot: EMU, sessionId: HOME }), asked(OPS), askedNew(EMU, 'd1')], { shown: draft(EMU, 'd1'), opening: null }, [[], [{ find: OPS }], []]],
    ['shows a later click once its answer comes, over a new chat',
      [askedNew(EMU, 'd1'), asked(OPS), found(OPS, O1)], { shown: { kind: 'bot', bot: OPS, sessionId: O1 }, opening: null }, [[], [{ find: OPS }], []]],
    ['moves a new chat to the session its first message made',
      [askedNew(EMU, 'd1'), made(EMU, 'd1', R1)], { shown: draft(EMU, 'd1', R1), opening: null }, [[], []]],
    ['shows nothing new when a session is made for a new chat the user has left',
      [facts({ [RESEARCH]: R1 }), askedNew(EMU, 'd1'), askedNew(EMU, 'd2'), made(EMU, 'd1', R2)], { shown: draft(EMU, 'd2'), opening: null }, [[], [], [], []]],
    ["keeps a new chat when the roster names its bot's Bot Chat",
      [askedNew(EMU, 'd1'), made(EMU, 'd1', R1), facts({ [EMU]: HOME, [RESEARCH]: R2 })], { shown: draft(EMU, 'd1', R1), opening: null }, [[], [], []]],
    ["keeps a new chat in the socket's own profile when Hermes says more",
      [askedNew(null, 'd1'), made(null, 'd1', R1), facts({ [EMU]: HOME }, { kind: 'bot', bot: EMU, sessionId: HOME })], { shown: draft(null, 'd1', R1), opening: null }, [[], [], []]],
    ['opens a chat picked from the list in the bot that listed it, with no call',
      [facts({ [EMU]: HOME }, { kind: 'bot', bot: EMU, sessionId: HOME }), listed(RESEARCH, [R1, R2]), picked(R2)], { shown: { kind: 'chat', bot: RESEARCH, sessionId: R2 }, opening: null }, [[], [], []]],
    ["opens a picked chat no bot listed in the socket's own profile",
      [picked(R2)], { shown: { kind: 'chat', bot: null, sessionId: R2 }, opening: null }, [[]]],
    ['lets an earlier click go when a chat is picked',
      [listed(RESEARCH, [R1, R2]), asked(OPS), picked(R1), found(OPS, O1)], { shown: { kind: 'chat', bot: RESEARCH, sessionId: R1 }, opening: null }, [[], [{ find: OPS }], [], []]],
    ['keeps a picked chat when the roster names its bot another Bot Chat',
      [listed(RESEARCH, [R2]), picked(R2), facts({ [RESEARCH]: R1 })], { shown: { kind: 'chat', bot: RESEARCH, sessionId: R2 }, opening: null }, [[], [], []]],
    ["keeps the shown Bot Chat's pane when its own row is picked, and lets an earlier click go",
      [facts({ [EMU]: HOME }, { kind: 'bot', bot: EMU, sessionId: HOME }), asked(OPS), listed(EMU, [HOME]), picked(HOME)], { shown: { kind: 'bot', bot: EMU, sessionId: HOME }, opening: null }, [[], [{ find: OPS }], [], []]],
    ["keeps a new chat's pane when its own row is picked",
      [askedNew(RESEARCH, 'd1'), made(RESEARCH, 'd1', R1), listed(RESEARCH, [R1]), picked(R1)], { shown: draft(RESEARCH, 'd1', R1), opening: null }, [[], [], [], []]],
    ['shows the chat a branch made, in its parent\'s bot, with the message it was made from',
      [listed(RESEARCH, [R1]), picked(R1), branched(R1, B1, 'again')], { shown: { kind: 'branch', bot: RESEARCH, sessionId: B1, text: 'again' }, opening: null }, [[], [], []]],
    ["shows a branch of a Bot Chat in that bot",
      [facts({ [EMU]: HOME }, { kind: 'bot', bot: EMU, sessionId: HOME }), branched(HOME, B1, 'again')], { shown: { kind: 'branch', bot: EMU, sessionId: B1, text: 'again' }, opening: null }, [[], []]],
    ["shows a branch of a chat of the socket's own profile with no bot",
      [picked(R2), branched(R2, B1, 'again')], { shown: { kind: 'branch', bot: null, sessionId: B1, text: 'again' }, opening: null }, [[], []]],
    ['shows nothing when the user opened another chat before the branch answered',
      [listed(RESEARCH, [R1, R2]), picked(R1), picked(R2), branched(R1, B1, 'again')], { shown: { kind: 'chat', bot: RESEARCH, sessionId: R2 }, opening: null }, [[], [], [], []]],
    ['shows nothing when a click on a bot is still waiting for its answer',
      [listed(RESEARCH, [R1]), picked(R1), asked(OPS), branched(R1, B1, 'again')], { shown: { kind: 'chat', bot: RESEARCH, sessionId: R1 }, opening: { kind: 'bot', bot: OPS } }, [[], [], [{ find: OPS }], []]],
    ['shows nothing for a branch of a chat that is not shown at all',
      [branched(R1, B1, 'again')], { shown: null, opening: null }, [[]]],
    ["keeps a branch's pane, and so its box, when its own row is picked",
      [listed(RESEARCH, [R1]), picked(R1), branched(R1, B1, 'again'), picked(B1)], { shown: { kind: 'branch', bot: RESEARCH, sessionId: B1, text: 'again' }, opening: null }, [[], [], [], []]],
    ['opens a branch as a plain chat once another chat has been open',
      [listed(RESEARCH, [R1]), picked(R1), branched(R1, B1, 'again'), picked(R1), picked(B1)], { shown: { kind: 'chat', bot: RESEARCH, sessionId: B1 }, opening: null }, [[], [], [], [], []]],
    ['shows a branch of a branch',
      [listed(RESEARCH, [R1]), picked(R1), branched(R1, B1, 'again'), branched(B1, B2, 'once more')], { shown: { kind: 'branch', bot: RESEARCH, sessionId: B2, text: 'once more' }, opening: null }, [[], [], [], []]],
    ['opens nothing when a list comes',
      [facts({ [EMU]: HOME }, { kind: 'bot', bot: EMU, sessionId: HOME }), listed(RESEARCH, [R1, R2])], { shown: { kind: 'bot', bot: EMU, sessionId: HOME }, opening: null }, [[], []]],
    ['opens a linked chat whose bot the roster named at once, with no call',
      [facts({ [EMU]: HOME, [RESEARCH]: R1 }, { kind: 'bot', bot: EMU, sessionId: HOME }), linked(R1)], { shown: { kind: 'chat', bot: RESEARCH, sessionId: R1 }, opening: null }, [[], []]],
    ['opens a linked chat a list named at once, with no call',
      [listed(RESEARCH, [R2]), linked(R2)], { shown: { kind: 'chat', bot: RESEARCH, sessionId: R2 }, opening: null }, [[], []]],
    ['looks for a linked chat no one has named, and keeps the chat shown meanwhile',
      [facts({ [EMU]: HOME }, { kind: 'bot', bot: EMU, sessionId: HOME }), linked(R2)], { shown: { kind: 'bot', bot: EMU, sessionId: HOME }, opening: { kind: 'link', sessionId: R2 } }, [[], [{ seek: R2 }]]],
    ['opens a linked chat in the bot it was found in',
      [facts({ [EMU]: HOME }, { kind: 'bot', bot: EMU, sessionId: HOME }), linked(R2), sought(R2, RESEARCH)], { shown: { kind: 'chat', bot: RESEARCH, sessionId: R2 }, opening: null }, [[], [{ seek: R2 }], []]],
    ["opens a linked chat found in the socket's own profile with no bot",
      [linked(R2), sought(R2, null)], { shown: { kind: 'chat', bot: null, sessionId: R2 }, opening: null }, [[{ seek: R2 }], []]],
    ['keeps the chat shown and says so when Hermes has no chat by that id',
      [facts({ [EMU]: HOME }, { kind: 'bot', bot: EMU, sessionId: HOME }), linked(R2), nowhere(R2)], { shown: { kind: 'bot', bot: EMU, sessionId: HOME }, opening: null, missing: R2 }, [[], [{ seek: R2 }], []]],
    ['keeps the chat shown and says nothing when the search is refused',
      [facts({ [EMU]: HOME }, { kind: 'bot', bot: EMU, sessionId: HOME }), linked(R2), { on: 'unsought', sessionId: R2 }], { shown: { kind: 'bot', bot: EMU, sessionId: HOME }, opening: null }, [[], [{ seek: R2 }], []]],
    ['stops saying a linked chat is missing on the next click',
      [listed(RESEARCH, [R1]), picked(R1), linked(R2), nowhere(R2), picked(R1)], { shown: { kind: 'chat', bot: RESEARCH, sessionId: R1 }, opening: null }, [[], [], [{ seek: R2 }], [], []]],
    ['stops saying a linked chat is missing when a bot is clicked',
      [linked(R2), nowhere(R2), asked(OPS)], { shown: null, opening: { kind: 'bot', bot: OPS } }, [[{ seek: R2 }], [], [{ find: OPS }]]],
    ['stops saying a linked chat is missing when a new chat starts',
      [linked(R2), nowhere(R2), askedNew(EMU, 'd1')], { shown: draft(EMU, 'd1'), opening: null }, [[{ seek: R2 }], [], []]],
    ['stops saying a linked chat is missing when another link is followed',
      [linked(R2), nowhere(R2), linked(O1)], { shown: null, opening: { kind: 'link', sessionId: O1 } }, [[{ seek: R2 }], [], [{ seek: O1 }]]],
    ['shows nothing for a linked chat found after a later click',
      [facts({ [RESEARCH]: R1 }), linked(R2), asked(RESEARCH), sought(R2, RESEARCH)], { shown: { kind: 'bot', bot: RESEARCH, sessionId: R1 }, opening: null }, [[], [{ seek: R2 }], [], []]],
    ['says nothing about a missing link after a later click',
      [listed(RESEARCH, [R1]), linked(R2), picked(R1), nowhere(R2)], { shown: { kind: 'chat', bot: RESEARCH, sessionId: R1 }, opening: null }, [[], [{ seek: R2 }], [], []]],
    ['keeps a later click waiting when a linked chat is found first',
      [linked(R2), asked(OPS), sought(R2, RESEARCH)], { shown: null, opening: { kind: 'bot', bot: OPS } }, [[{ seek: R2 }], [{ find: OPS }], []]],
    ["keeps a link waiting when an earlier bot's lookup answers",
      [asked(OPS), linked(R2), found(OPS, O1)], { shown: null, opening: { kind: 'link', sessionId: R2 } }, [[{ find: OPS }], [{ seek: R2 }], []]],
    ["keeps the shown chat's pane when a link names it, with no call",
      [askedNew(RESEARCH, 'd1'), made(RESEARCH, 'd1', R1), linked(R1)], { shown: draft(RESEARCH, 'd1', R1), opening: null }, [[], [], []]],
    ['keeps the shown chat when a link names it though no bot is known for it, and lets an earlier click go',
      [picked(R2), asked(OPS), linked(R2)], { shown: { kind: 'chat', bot: null, sessionId: R2 }, opening: null }, [[], [{ find: OPS }], []]]
  ])('%s', (_name, events, open, effects) => {
    const reached = after(events)
    expect(reached.desk.open).toEqual({ missing: null, ...open })
    expect(reached.effects).toEqual(effects)
  })

  it('knows the owner of every session before it names one, and keeps the owner of a session a bot has moved on from', () => {
    const events = [
      facts({ [EMU]: HOME, [RESEARCH]: R1 }, { kind: 'bot', bot: EMU, sessionId: HOME }), asked(OPS), found(OPS, O1), facts({ [RESEARCH]: R2 }), asked(RESEARCH),
      askedNew(OPS, 'd1'), made(OPS, 'd1', 'local-o2' as SessionId), askedNew(EMU, 'd2'), askedNew(null, 'd3'), made(EMU, 'd2', 'local-e2' as SessionId), made(null, 'd3', 'local-n1' as SessionId),
      linked('local-l1' as SessionId), sought('local-l1' as SessionId, OPS), linked('local-l2' as SessionId), sought('local-l2' as SessionId, null)
    ]
    events.reduce((desk, event) => {
      const next = nextDesk(desk, event).desk
      const { shown } = next.open
      if (shown !== null && shown.bot !== null && shown.sessionId !== null) expect(next.owners[shown.sessionId], JSON.stringify(event)).toBe(shown.bot)
      return next
    }, EMPTY_DESK)
    const { desk } = after(events)
    expect(desk.owners, "a new chat's session is owned by its bot, and one in the socket's own profile by none").toEqual({
      [HOME]: EMU, [R1]: RESEARCH, [R2]: RESEARCH, [O1]: OPS, 'local-o2': OPS, 'local-e2': EMU, 'local-l1': OPS
    })
    expect(desk.chats, 'a new chat is no Bot Chat').toEqual({ [EMU]: HOME, [RESEARCH]: R2, [OPS]: O1 })
  })

  it("records the owner of a branch's chat even when the branch shows nothing", () => {
    const { desk } = after([listed(RESEARCH, [R1, R2]), picked(R1), picked(R2), branched(R1, B1, 'again'), picked(R2), branched(R2, B2, 'more')])
    expect(desk.owners).toEqual({ [R1]: RESEARCH, [R2]: RESEARCH, [B1]: RESEARCH, [B2]: RESEARCH })
  })

  it('records the bot a linked chat was found in even when the user has moved on', () => {
    const { desk } = after([linked(R2), picked(R1), sought(R2, RESEARCH)])
    expect(desk.owners).toEqual({ [R2]: RESEARCH })
  })

  it("keeps a session's first owner when another bot's list names it", () => {
    const { desk } = after([facts({ [EMU]: HOME }), listed(RESEARCH, [R1, HOME]), listed(OPS, [R1])])
    expect(desk.owners).toEqual({ [HOME]: EMU, [R1]: RESEARCH })
  })

  it('looks a bot up by its own name only, so a profile named like an Object method has no chat until Hermes names one', () => {
    const named = ['constructor', 'toString'] as BotId[]
    for (const bot of named) expect(after([asked(bot)]).effects, bot).toEqual([[{ find: bot }]])
    expect(after([asked(named[0]!), found(named[0]!, null)]).desk.open.shown).toEqual({ kind: 'bot', bot: 'constructor', sessionId: null })
  })

  it('gives back the same value when an event changes nothing, so nothing is published for it', () => {
    expect(nextDesk(LAUNCHED, facts({ [EMU]: HOME, [RESEARCH]: R1 }, { kind: 'bot', bot: EMU, sessionId: HOME })).desk.open).toBe(LAUNCHED.open)
    expect(nextDesk(LAUNCHED, found(RESEARCH, R1)).desk.open).toBe(LAUNCHED.open)
    expect(nextDesk(LAUNCHED, { on: 'failed', bot: OPS }).desk.open).toBe(LAUNCHED.open)
    expect(nextDesk(LAUNCHED, listed(RESEARCH, [R1])).desk, 'a list of chats whose owners are known').toBe(LAUNCHED)
    expect(nextDesk(LAUNCHED, nowhere(R2)).desk.open, 'an answer for a link no one is waiting on').toBe(LAUNCHED.open)
  })
})

describe('the chat a connection shows before any click', () => {
  const fact = (id: BotId, isDefault: boolean) => ({ id, name: id, isDefault, section: null, preview: null, description: null, chat: null, picture: false, pinned: false, hidden: false })
  const WITH_DEFAULT: Bots = { state: 'listed', roster: rosterOf([fact(EMU, true), fact(RESEARCH, false)]), edition: 1 }
  const NO_DEFAULT: Bots = { state: 'listed', roster: rosterOf([fact(RESEARCH, false)]), edition: 1 }
  const READY = { status: 'ready', newest: HOME } as const
  const EMPTY = { status: 'ready', newest: null } as const

  it.each<[string, Parameters<typeof launchChat>, Shown | null]>([
    ["is the default bot's Bot Chat on a socket that reaches every profile", ['host', WITH_DEFAULT, { [EMU]: R1 }, READY], { kind: 'bot', bot: EMU, sessionId: R1 }],
    ['is the default bot unstarted when it has no Bot Chat, whatever the list holds', ['host', WITH_DEFAULT, {}, READY], { kind: 'bot', bot: EMU, sessionId: null }],
    ['does not wait for the list when there is a default bot', ['host', WITH_DEFAULT, { [EMU]: R1 }, { status: 'loading', newest: null }], { kind: 'bot', bot: EMU, sessionId: R1 }],
    ['is the newest chat, with no bot, on a socket bound to one profile', ['profile', WITH_DEFAULT, { [EMU]: R1 }, READY], { kind: 'chat', bot: null, sessionId: HOME }],
    ['is the newest chat when the roster has no default bot', ['host', NO_DEFAULT, {}, READY], { kind: 'chat', bot: null, sessionId: HOME }],
    ['is the newest chat on a Hermes that cannot list its bots', ['profile', { state: 'unsupported' }, {}, READY], { kind: 'chat', bot: null, sessionId: HOME }],
    ['is the newest chat when Hermes would not list its bots', ['host', { state: 'refused' }, {}, READY], { kind: 'chat', bot: null, sessionId: HOME }],
    ['is the newest chat the last list held while a newer one is read', ['profile', { state: 'unsupported' }, {}, { status: 'stale', newest: HOME }], { kind: 'chat', bot: null, sessionId: HOME }],
    ['is none while the bots are being read', ['host', { state: 'loading' }, {}, READY], null],
    ['is none while there is no connection', [null, WITH_DEFAULT, { [EMU]: R1 }, READY], null],
    ['is none before the first answer about the bots', ['host', { state: 'offline' }, {}, READY], null],
    ['is none while the list is being read', ['profile', { state: 'unsupported' }, {}, { status: 'loading', newest: null }], null],
    ['is none when there is no chat at all', ['profile', { state: 'unsupported' }, {}, EMPTY], null]
  ])('%s', (_name, args, shown) => {
    expect(launchChat(...args)).toEqual(shown)
  })
})

describe("a linked chat's search", () => {
  type Page = readonly SessionId[]
  const fact = (id: BotId) => ({ id, name: id, isDefault: id === EMU, section: null, preview: null, description: null, chat: null, picture: false, pinned: false, hidden: false })
  const LISTED: Bots = { state: 'listed', roster: rosterOf([fact(EMU), fact(RESEARCH), fact(OPS)]), edition: 1 }
  const NOTHING = { status: 'ready', newest: null } as const
  const R3 = 'local-r3' as SessionId
  const OWN_PROFILE = ''

  function desk(reach: 'host' | 'profile', pages: { readonly [profile: string]: readonly Page[] }, refusing: readonly string[] = [], dropped = 0) {
    const sent: { readonly profile: string; readonly cursor: unknown }[] = []
    const callAs = (profile: string) => (_method: string, params: { readonly cursor?: string }) => {
      sent.push({ profile, cursor: params.cursor })
      if (sent.length <= dropped) return Promise.reject(new Offline())
      if (refusing.includes(profile)) return Promise.reject(new RpcRefusal(4030, 'permission_denied', 'no'))
      const book = pages[profile] ?? [[]]
      const at = params.cursor === undefined ? 0 : Number(params.cursor)
      const rows = (book[at] ?? []).map(sessionId => ({ session_id: sessionId, id: sessionId }))
      return Promise.resolve({ sessions: rows, scope: 'stored', next_cursor: at + 1 < book.length ? String(at + 1) : null })
    }
    const conn = { reach, creation: null, call: callAs(OWN_PROFILE), as: (bot: BotId) => ({ call: callAs(bot) }) } as unknown as DeskDeps['conn']
    const opened = chatDesk({ conn, client: { name: 'test', version: '0' }, mintId: () => 'id', changed: () => {} })
    return { opened, sent, settle: (bots: Bots) => opened.settle({ bots, named: {}, list: NOTHING }) }
  }

  it('pages through each profile until one lists the chat, then opens it in that bot', async () => {
    const { opened, sent, settle } = desk('host', { [RESEARCH]: [[R1], [R2], [R3]] })
    settle(LISTED)
    expect(await opened.ask({ kind: 'link', sessionId: R3 })).toEqual({ ok: true, value: R3 })
    expect(opened.open).toEqual({ shown: { kind: 'chat', bot: RESEARCH, sessionId: R3 }, opening: null, missing: null })
    expect(opened.botOf(R3)).toBe(RESEARCH)
    expect(sent.filter(call => call.profile === RESEARCH).map(call => call.cursor)).toEqual([undefined, '1', '2'])
  })

  it('reads as missing once every page of every profile went by', async () => {
    const { opened, sent, settle } = desk('host', { [EMU]: [[HOME]], [RESEARCH]: [[R1], [R2]] })
    settle(LISTED)
    expect(await opened.ask({ kind: 'link', sessionId: R3 })).toEqual({ ok: true, value: null })
    expect(opened.open, 'the launch chat stays').toEqual({ shown: { kind: 'bot', bot: EMU, sessionId: null }, opening: null, missing: R3 })
    expect(sent.map(call => call.profile).sort()).toEqual([EMU, OPS, RESEARCH, RESEARCH])
  })

  it('waits to search until Hermes has answered about its bots', async () => {
    const { opened, sent, settle } = desk('host', { [OPS]: [[O1]] })
    const outcome = opened.ask({ kind: 'link', sessionId: O1 })
    settle({ state: 'loading' })
    settle({ state: 'offline' })
    await Promise.resolve()
    expect(sent).toEqual([])
    expect(opened.open.opening).toEqual({ kind: 'link', sessionId: O1 })
    settle(LISTED)
    expect(await outcome).toEqual({ ok: true, value: O1 })
    expect(opened.open.shown).toEqual({ kind: 'chat', bot: OPS, sessionId: O1 })
  })

  it("searches the socket's own profile when it cannot list bots, or reaches one profile", async () => {
    for (const [reach, bots] of [['host', { state: 'unsupported' }], ['profile', LISTED]] as const) {
      const { opened, sent, settle } = desk(reach, { [OWN_PROFILE]: [[R1]] })
      settle(bots)
      expect(await opened.ask({ kind: 'link', sessionId: R1 }), reach).toEqual({ ok: true, value: R1 })
      expect(opened.open.shown, reach).toEqual({ kind: 'chat', bot: null, sessionId: R1 })
      expect(sent.map(call => call.profile), reach).toEqual([OWN_PROFILE])
    }
  })

  it('makes one search for two links to the same chat', async () => {
    const { opened, sent, settle } = desk('host', { [OPS]: [[O1]] })
    settle(LISTED)
    const outcomes = await Promise.all([opened.ask({ kind: 'link', sessionId: O1 }), opened.ask({ kind: 'link', sessionId: O1 })])
    expect(outcomes).toEqual([{ ok: true, value: O1 }, { ok: true, value: O1 }])
    expect(sent).toHaveLength(3)
  })

  it('opens the chat when one profile lists it though another refused, and says why when none lists it', async () => {
    const found = desk('host', { [OPS]: [[O1]] }, [RESEARCH])
    found.settle(LISTED)
    expect(await found.opened.ask({ kind: 'link', sessionId: O1 })).toEqual({ ok: true, value: O1 })

    const refused = desk('host', {}, [RESEARCH])
    refused.settle(LISTED)
    expect(await refused.opened.ask({ kind: 'link', sessionId: O1 })).toEqual({ ok: false, refusal: { kind: 'not-attached', message: "Hermes won't let Highwing do that in this chat." } })
    expect(refused.opened.open, 'a refused search names nothing missing').toEqual({ shown: { kind: 'bot', bot: EMU, sessionId: null }, opening: null, missing: null })
  })

  it('searches again once the socket is back when the drop cut the search short', async () => {
    const { opened, sent, settle } = desk('host', { [OPS]: [[O1]] }, [], 3)
    settle(LISTED)
    const outcome = opened.ask({ kind: 'link', sessionId: O1 })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(sent, 'every bot was asked and none answered').toHaveLength(3)
    expect(opened.open.opening, 'the link still waits').toEqual({ kind: 'link', sessionId: O1 })
    opened.online()
    expect(await outcome).toEqual({ ok: true, value: O1 })
    expect(opened.open.shown).toEqual({ kind: 'chat', bot: OPS, sessionId: O1 })
  })

  it('gives a dropped search up once the user opened another chat', async () => {
    const { opened, sent, settle } = desk('host', { [OPS]: [[O1]] }, [], 3)
    settle(LISTED)
    const outcome = opened.ask({ kind: 'link', sessionId: O1 })
    await opened.ask({ kind: 'chat', sessionId: R1 })
    expect(await outcome).toMatchObject({ ok: false, refusal: { kind: 'offline' } })
    opened.online()
    expect(sent).toHaveLength(3)
    expect(opened.open.shown).toEqual({ kind: 'chat', bot: null, sessionId: R1 })
  })
})
