import type { Feed, Hermes } from '@highwing/hermes'
import type { Command, GroupId, OpenChat, Outcome, Session, SessionId, SettledTurn } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DUE, OFF, type Intro } from '../src/intro'
import type { Setup } from '../src/ipc-contract'
import type { ConnectionOwner } from '../src/main/connection'
import { noticeOf, notifyTurnEnds, type TurnNotice } from '../src/main/notify'

const fixture = loadFixture('fixtures/errand.jsonl')
const STORY = fixture.header.sessionId as SessionId
const OTHER = 'other-chat' as SessionId

let moments: readonly Session[] = []
let running: Session
let ended: Session

beforeAll(async () => {
  const sessions: Session[] = []
  for await (const { session } of play(fixture)) sessions.push(session)
  moments = sessions
  const at = sessions.findIndex((session, index) => index > 0 && session.run.state === 'idle' && sessions[index - 1]!.run.state === 'running')
  running = sessions[at - 1]!
  ended = sessions[at]!
})

const endingAs = (outcome: Outcome): Session => {
  const last = ended.history.at(-1)!
  return { ...ended, history: [...ended.history.slice(0, -1), { ...last, outcome } as SettledTurn] }
}

describe('noticeOf', () => {
  it('says Hermes finished, with the start of the reply, once over the whole errand', () => {
    const notices = moments.slice(1).flatMap((after, index) => noticeOf(moments[index]!, after) ?? [])
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ sessionId: STORY, turnId: ended.history.at(-1)!.id, title: 'Hermes finished' })
    expect(notices[0]!.body).toMatch(/^Done\. I created/)
    expect(notices[0]!.body.length).toBeLessThanOrEqual(140)
  })

  it('says Message complete when the turn ends with no reply after its last step', () => {
    const last = ended.history.at(-1)!
    const silent: Session = { ...ended, history: [...ended.history.slice(0, -1), { ...last, items: last.items.filter(item => item.kind !== 'text') }] }
    expect(noticeOf(running, silent)).toMatchObject({ title: 'Hermes finished', body: 'Message complete.' })
  })

  it('says the turn failed in the words the thread shows', () => {
    const failed = (code: string | null) => endingAs({ kind: 'failed', message: 'HTTP 401 from provider', code, retryable: false })
    expect(noticeOf(running, failed('auth_permanent'))).toMatchObject({
      title: 'Turn failed', body: "Hermes couldn't sign in to its model provider. Check the provider's key or sign-in in Hermes."
    })
    expect(noticeOf(running, failed(null))).toMatchObject({ title: 'Turn failed', body: 'HTTP 401 from provider' })
  })

  it('says Hermes finished for a stopped turn, as Hermes Desktop does', () => {
    expect(noticeOf(running, endingAs({ kind: 'stopped' }))).toMatchObject({ title: 'Hermes finished' })
  })

  it('stays quiet for a turn that ended while Highwing was away', () => {
    expect(noticeOf(running, endingAs({ kind: 'lost' }))).toBeNull()
  })

  it.each(['catching-up', 'rebuilding', 'offline', 'opening'] as const)('stays quiet for an end heard while %s', state => {
    expect(noticeOf({ ...running, sync: { state } }, ended)).toBeNull()
  })

  it('stays quiet for history loaded at open', () => {
    expect(noticeOf({ ...ended, sync: { state: 'opening' }, history: [] }, ended)).toBeNull()
    expect(noticeOf(ended, ended)).toBeNull()
  })
})

function changing<T>(initial: T): Feed<T> & { set(next: T): void } {
  let value = initial
  const listeners = new Set<(value: T) => void>()
  return {
    get: () => value,
    subscribe: listener => (listeners.add(listener), () => void listeners.delete(listener)),
    set: next => {
      value = next
      for (const listener of [...listeners]) listener(next)
    }
  }
}

const showing = (sessionId: SessionId | null): OpenChat => ({ shown: sessionId === null ? null : { kind: 'chat', bot: null, sessionId }, opening: null, missing: null })

function stubHermes(first: Session) {
  const open = changing(showing(first.id))
  const sessions = new Map<SessionId, ReturnType<typeof changing<Session>>>()
  const sessionFeed = (id: SessionId) => sessions.get(id) ?? sessions.set(id, changing({ ...first, id })).get(id)!
  sessionFeed(first.id)
  const hermes = {
    open,
    watch: (id: SessionId, listener: (session: Session) => void) => {
      const feed = sessionFeed(id)
      listener(feed.get())
      return feed.subscribe(listener)
    }
  } as unknown as Hermes
  return { hermes, open, publish: (session: Session) => sessionFeed(session.id).set(session) }
}

function observe(hermes: Hermes, focused = false, at: Intro = OFF) {
  const shown: { notice: TurnNotice; click: () => void }[] = []
  const raise = vi.fn()
  const setup = changing<Setup>({ at: 'pinned' })
  const intro = changing(at)
  const ran: Command[] = []
  const owner = { setup, hermes: hermes as Hermes | null, run: (async (command: Command) => (ran.push(command), { ok: true, value: undefined })) as ConnectionOwner['run'] }
  const stop = notifyTurnEnds(owner, intro, { notifier: { show: (notice, click) => shown.push({ notice, click }) }, focused: () => focused, raise })
  return { shown, raise, stop, owner, setup, ran }
}

describe('notifyTurnEnds', () => {
  it('watches no chat while a group chat is open, so the chat it covers ends its turn unsaid', () => {
    const stub = stubHermes(running)
    const { shown } = observe(stub.hermes)
    stub.open.set({ shown: { kind: 'group', group: 'launch-plan' as GroupId, over: null }, opening: null, missing: null })
    stub.publish(ended)
    expect(shown).toEqual([])
  })

  it('notifies once when the shown chat ends a turn while no window has focus', () => {
    const stub = stubHermes(running)
    const { shown } = observe(stub.hermes)
    stub.publish(ended)
    expect(shown.map(({ notice }) => notice.title)).toEqual(['Hermes finished'])
  })

  it('stays quiet while a window has focus', () => {
    const stub = stubHermes(running)
    const { shown } = observe(stub.hermes, true)
    stub.publish(ended)
    expect(shown).toEqual([])
  })

  it('stays quiet for a chat that was already settled when it was shown', () => {
    const stub = stubHermes(ended)
    const { shown } = observe(stub.hermes)
    stub.publish({ ...ended })
    expect(shown).toEqual([])
  })

  it('notifies once for a turn id it already told about', () => {
    const stub = stubHermes(running)
    const { shown } = observe(stub.hermes)
    stub.publish(ended)
    stub.publish(running)
    stub.publish(ended)
    expect(shown).toHaveLength(1)
  })

  it('follows the shown chat and stops watching the one before', () => {
    const stub = stubHermes(running)
    const { shown } = observe(stub.hermes)
    stub.publish({ ...running, id: OTHER })
    stub.open.set(showing(OTHER))
    stub.publish(ended)
    stub.publish({ ...ended, id: OTHER })
    expect(shown.map(({ notice }) => notice.sessionId)).toEqual([OTHER])
  })

  it('follows a new connection to its Hermes', () => {
    const old = stubHermes(running)
    const { shown, owner, setup } = observe(old.hermes)
    const next = stubHermes({ ...running, id: OTHER })
    owner.hermes = next.hermes
    setup.set({ at: 'pinned' })
    old.publish(ended)
    next.publish({ ...ended, id: OTHER })
    expect(shown.map(({ notice }) => notice.sessionId)).toEqual([OTHER])
  })

  it('raises the window on a click and leaves the launch chat while the intro covers it', () => {
    const stub = stubHermes(running)
    const { shown, raise, ran, setup } = observe(stub.hermes, false, DUE)
    stub.publish(ended)
    setup.set({ at: 'chat', live: { target: { kind: 'local' }, epoch: 1 } })
    shown[0]!.click()
    expect(raise).toHaveBeenCalledOnce()
    expect(ran).toEqual([])
  })

  it('raises the window on a click and opens the chat even while it is shown, so a pending switch to another bot gives way', () => {
    const stub = stubHermes(running)
    const { shown, raise, ran } = observe(stub.hermes)
    stub.publish(ended)
    shown[0]!.click()
    expect(raise).toHaveBeenCalledOnce()
    expect(ran).toEqual([{ do: 'open', ref: { kind: 'chat', sessionId: STORY } }])
  })

  it('raises the window and opens nothing on a click from a connection that was replaced', () => {
    const old = stubHermes(running)
    const { shown, raise, owner, setup, ran } = observe(old.hermes)
    old.publish(ended)
    const next = stubHermes({ ...running, id: OTHER })
    owner.hermes = next.hermes
    setup.set({ at: 'pinned' })
    old.open.set(showing(OTHER))
    shown[0]!.click()
    expect(raise).toHaveBeenCalledOnce()
    expect(ran).toEqual([])
  })

  it('opens the chat again on a click when another chat is shown', () => {
    const stub = stubHermes(running)
    const { shown, raise, ran } = observe(stub.hermes)
    stub.publish(ended)
    stub.open.set(showing(OTHER))
    shown[0]!.click()
    expect(raise).toHaveBeenCalledOnce()
    expect(ran).toEqual([{ do: 'open', ref: { kind: 'chat', sessionId: STORY } }])
  })

  it('stops when told to', () => {
    const stub = stubHermes(running)
    const { shown, stop } = observe(stub.hermes)
    stop()
    stub.publish(ended)
    expect(shown).toEqual([])
  })
})
