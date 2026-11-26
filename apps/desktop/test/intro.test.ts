import type { BotId, GatewayUrl, GroupId, SessionId, SshHost } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import type { Setup } from '../src/ipc-contract'
import { DONE, DUE, EXAMPLE_REQUESTS, EXAMPLES, examplesFor, introInFront, introSteps, nextIntro, OFF } from '../src/intro'

const LOCAL = { kind: 'local' } as const
const REMOTE = { kind: 'remote', host: 'hermes-host.example-tailnet.ts.net' as SshHost } as const
const GATEWAY = { kind: 'url', url: 'https://hermes.example.com:8443/hermes' as GatewayUrl } as const
const LIVE = { target: LOCAL, epoch: 1 }
const ARM = { do: 'arm' } as const
const LEAVE = { do: 'examples' } as const
const FINISH = { do: 'done' } as const
const EMU = 'emu' as BotId
const WREN = 'wren' as BotId
const CHAT = 's1' as SessionId

const UNSTARTED = { kind: 'bot', bot: EMU, sessionId: null } as const
const OCCUPIED = { kind: 'chat', bot: EMU, sessionId: CHAT } as const
const OTHER = { kind: 'bot', bot: WREN, sessionId: null } as const
const OWN = { kind: 'new', bot: null, draftId: 'd', sessionId: null } as const
const GROUP = { kind: 'group', group: 'g' as GroupId, over: EMU } as const

describe('where the intro moves', () => {
  it('arms only while it has never been written, and every arm lands on the same due', () => {
    const off = { at: 'off' } as const
    const due = nextIntro(off, ARM)
    expect(due).toBe(DUE)
    expect(nextIntro(OFF, ARM)).toBe(due)
    expect(nextIntro(DUE, ARM)).toBe(DUE)
    expect(nextIntro(EXAMPLES, ARM)).toBe(EXAMPLES)
    expect(nextIntro(DONE, ARM)).toBe(DONE)
    expect(nextIntro(off, LEAVE)).toBe(off)
    expect(nextIntro(off, FINISH)).toBe(off)
  })

  it('leaves the steps only from due, and clears the requests only from examples', () => {
    expect(nextIntro(DUE, LEAVE)).toBe(EXAMPLES)
    expect(nextIntro(EXAMPLES, LEAVE)).toBe(EXAMPLES)
    expect(nextIntro(DONE, LEAVE)).toBe(DONE)
    expect(nextIntro(OFF, LEAVE)).toBe(OFF)
    expect(nextIntro(EXAMPLES, FINISH)).toBe(DONE)
    expect(nextIntro(DUE, FINISH)).toBe(DUE)
    expect(nextIntro(DONE, FINISH)).toBe(DONE)
    expect(nextIntro(OFF, FINISH)).toBe(OFF)
  })
})

describe('when the intro covers the screen', () => {
  const places: readonly [string, Setup, boolean][] = [
    ['the chat', { at: 'chat', live: LIVE }, true],
    ['a fixture', { at: 'pinned' }, false],
    ['the first connection', { at: 'saved', live: LIVE, from: 'first-run' }, true],
    ['settings', { at: 'saved', live: LIVE, from: 'settings' }, false],
    ['the form', { at: 'form', live: null, notice: null }, false],
    ['a check', { at: 'checking', live: null, target: LOCAL, step: 'hermes' }, false],
    ['a failed check', { at: 'failed', live: null, target: LOCAL, failure: 'cant-save' }, false]
  ]

  it.each(places)('covers %s only while the steps are due', (_where, setup, covered) => {
    expect(introInFront(setup, DUE)).toBe(covered)
    expect(introInFront(setup, OFF)).toBe(false)
    expect(introInFront(setup, EXAMPLES)).toBe(false)
    expect(introInFront(setup, DONE)).toBe(false)
  })
})

describe('the three steps', () => {
  it('names the machine only on the first step', () => {
    const [first, second, third] = introSteps(LOCAL)
    expect(first).toEqual({
      title: 'Highwing now uses the Hermes on this computer.',
      lead: 'This Hermes has bots. A bot is a profile with its own chats, listed on the left. Highwing opens the default bot.',
      primary: 'Next'
    })
    expect(introSteps(REMOTE)[0].title).toBe('Highwing now uses the Hermes on hermes-host.')
    expect(introSteps(GATEWAY)[0].title).toBe('Highwing now uses the Hermes on hermes.example.com.')
    expect(second).toEqual({
      title: 'Each bot keeps its own chats.',
      lead: "Bot Chat is that bot's standing chat. New chat starts another with the same bot. Choosing a bot shows that bot's chats.",
      primary: 'Next'
    })
    expect(third).toEqual({
      title: 'Start with the default bot.',
      lead: 'A few example requests sit above the message box. Choose one to send it, or write your own.',
      primary: 'Open chat'
    })
    expect(introSteps(REMOTE)[1]).toEqual(second)
    expect(introSteps(GATEWAY)[2]).toEqual(third)
  })
})

describe('the example requests', () => {
  it.each([
    ['an unstarted chat of the default bot', UNSTARTED, EMU, EXAMPLE_REQUESTS],
    ['a chat of the default bot that already has messages', OCCUPIED, EMU, EXAMPLE_REQUESTS],
    ['another bot', OTHER, EMU, []],
    ['a group', GROUP, EMU, []],
    ['no chat', null, EMU, []],
    ['the shown chat when no bot is the default', OWN, null, EXAMPLE_REQUESTS],
    ['the shown chat of a named bot when no bot is the default', UNSTARTED, null, EXAMPLE_REQUESTS]
  ] as const)('offers them on %s', (_where, shown, id, requests) => {
    expect(examplesFor(EXAMPLES, shown, { at: 'listed', id })).toEqual(requests)
  })

  it('offers nothing until the roster has answered, and nothing before the requests are up', () => {
    expect(examplesFor(EXAMPLES, UNSTARTED, { at: 'pending' })).toEqual([])
    expect(examplesFor(EXAMPLES, UNSTARTED, { at: 'pending' })).toBe(examplesFor(DUE, OCCUPIED, { at: 'listed', id: EMU }))
    for (const intro of [OFF, DUE, DONE]) expect(examplesFor(intro, UNSTARTED, { at: 'listed', id: EMU })).toEqual([])
  })

  it('keeps one list for every chat that shows them', () => {
    expect(examplesFor(EXAMPLES, UNSTARTED, { at: 'listed', id: EMU })).toBe(EXAMPLE_REQUESTS)
    expect(examplesFor(EXAMPLES, OCCUPIED, { at: 'listed', id: EMU })).toBe(EXAMPLE_REQUESTS)
    expect(examplesFor(EXAMPLES, OWN, { at: 'listed', id: null })).toBe(EXAMPLE_REQUESTS)
  })
})
