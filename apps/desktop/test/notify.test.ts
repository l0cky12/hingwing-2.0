import type { Feed, Hermes } from '@highwing/hermes'
import type { Command, GroupId, Job, JobId, OpenChat, Outcome, Session, SessionId, SettledTurn } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DUE, OFF, type Intro } from '../src/intro'
import type { Notices, Setup } from '../src/ipc-contract'
import type { ConnectionOwner } from '../src/main/connection'
import { asksOf, jobNotices, noticeOf, notify, type Notice } from '../src/main/notify'

const fixture = loadFixture('fixtures/errand.jsonl')
const STORY = fixture.header.sessionId as SessionId
const OTHER = 'other-chat' as SessionId

let moments: readonly Session[] = []
let running: Session
let ended: Session
let asking: Session

beforeAll(async () => {
  const sessions: Session[] = []
  for await (const { session } of play(fixture)) sessions.push(session)
  moments = sessions
  const at = sessions.findIndex((session, index) => index > 0 && session.run.state === 'idle' && sessions[index - 1]!.run.state === 'running')
  running = sessions[at - 1]!
  ended = sessions[at]!
  asking = sessions.find(session => asksOf(session).length > 0)!
})

const endingAs = (outcome: Outcome): Session => {
  const last = ended.history.at(-1)!
  return { ...ended, history: [...ended.history.slice(0, -1), { ...last, outcome } as SettledTurn] }
}

describe('noticeOf', () => {
  it('says Hermes finished, with the start of the reply, once over the whole errand', () => {
    const notices = moments.slice(1).flatMap((after, index) => noticeOf(moments[index]!, after) ?? [])
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ kind: 'replies', key: `${STORY} ${ended.history.at(-1)!.id}`, opens: STORY, title: 'Hermes finished' })
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

function stubHermes(shown: SessionId | null = STORY) {
  const open = changing(showing(shown))
  const jobs = changing<readonly Job[] | null>(null)
  const listeners = new Set<(session: Session, previous: Session) => void>()
  const held = new Map<SessionId, Session>()
  const hermes = {
    open,
    jobs,
    changes: (listener: (session: Session, previous: Session) => void) => (listeners.add(listener), () => void listeners.delete(listener))
  } as unknown as Hermes
  const publish = (session: Session) => {
    const previous = held.get(session.id) ?? session
    held.set(session.id, session)
    for (const listener of [...listeners]) listener(session, previous)
  }
  return { hermes, open, jobs, publish }
}

const ON: Notices = { asks: true, replies: true, jobs: true }

function observe(hermes: Hermes, focused = false, kinds: Notices = ON, at: Intro = OFF) {
  const shown: { notice: Notice; click: () => void }[] = []
  const raise = vi.fn()
  const setup = changing<Setup>({ at: 'pinned' })
  const intro = changing(at)
  const ran: Command[] = []
  const owner = { setup, hermes: hermes as Hermes | null, run: (async (command: Command) => (ran.push(command), { ok: true, value: undefined })) as ConnectionOwner['run'] }
  const stop = notify(owner, intro, { notifier: { show: (notice, click) => shown.push({ notice, click }) }, focused: () => focused, raise, kinds: () => kinds })
  return { shown, raise, stop, owner, setup, ran }
}

const titles = (shown: readonly { notice: Notice }[]) => shown.map(({ notice }) => notice.title)

const job = (ranAt: string | null, failed = false): Job => ({ id: 'digest' as JobId, name: 'Morning digest', ranAt, failed, error: failed ? 'Model timed out' : null })

describe('asksOf', () => {
  it('names the approval the running turn waits on', () => {
    expect(asksOf(asking)).toEqual([expect.objectContaining({ kind: 'asks', opens: STORY, title: 'Approval needed' })])
  })

  it('is empty once the turn has settled', () => {
    expect(asksOf(ended)).toEqual([])
  })
})

describe('jobNotices', () => {
  it('counts runs from the first list, so a job that ran before Highwing listed it says nothing', () => {
    expect(jobNotices(null, [job('2026-11-26T08:00:00')])).toEqual([])
  })

  it('says a job finished once for each new run, and opens no chat', () => {
    expect(jobNotices([job(null)], [job('2026-11-26T08:00:00')])).toEqual([
      { kind: 'jobs', key: 'digest 2026-11-26T08:00:00', opens: null, title: 'Scheduled job finished', body: 'Morning digest' }
    ])
    expect(jobNotices([job('2026-11-26T08:00:00')], [job('2026-11-26T08:00:00')])).toEqual([])
  })

  it('says a job failed, with what went wrong', () => {
    expect(jobNotices([job(null)], [job('2026-11-26T08:00:00', true)])).toMatchObject([{ title: 'Scheduled job failed', body: 'Morning digest: Model timed out' }])
  })

  it('says a job new since the last list ran', () => {
    expect(jobNotices([], [job('2026-11-26T08:00:00')])).toHaveLength(1)
  })
})

describe('notify', () => {
  it('notifies once when the shown chat ends a turn while no window has focus', () => {
    const stub = stubHermes()
    const { shown } = observe(stub.hermes)
    stub.publish(running)
    stub.publish(ended)
    expect(titles(shown)).toEqual(['Hermes finished'])
  })

  it('stays quiet for the shown chat while a window has focus', () => {
    const stub = stubHermes()
    const { shown } = observe(stub.hermes, true)
    stub.publish(running)
    stub.publish(ended)
    expect(shown).toEqual([])
  })

  it('notifies the shown chat while Settings covers it in a focused window', () => {
    const stub = stubHermes()
    const { shown, setup } = observe(stub.hermes, true)
    setup.set({ at: 'form', live: { target: { kind: 'local' }, epoch: 1 }, notice: null })
    stub.publish(asking)
    stub.publish(ended)
    expect(titles(shown)).toEqual(['Approval needed', 'Hermes finished'])
  })

  it('notifies a turn ending in a chat that is not shown, even while a window has focus', () => {
    const stub = stubHermes(OTHER)
    const { shown } = observe(stub.hermes, true)
    stub.publish(running)
    stub.publish(ended)
    expect(shown.map(({ notice }) => notice.opens)).toEqual([STORY])
  })

  it('notifies a turn ending in a chat a group chat covers, since that chat is not on screen', () => {
    const stub = stubHermes()
    const { shown } = observe(stub.hermes, true)
    stub.open.set({ shown: { kind: 'group', group: 'launch-plan' as GroupId, over: null }, opening: null, missing: null })
    stub.publish(running)
    stub.publish(ended)
    expect(titles(shown)).toEqual(['Hermes finished'])
  })

  it('notifies once for a turn id it already told about', () => {
    const stub = stubHermes()
    const { shown } = observe(stub.hermes)
    stub.publish(running)
    stub.publish(ended)
    stub.publish(running)
    stub.publish(ended)
    expect(shown).toHaveLength(1)
  })

  it('notifies an approval in a chat that is not on screen once, however often the chat changes', () => {
    const stub = stubHermes(OTHER)
    const { shown } = observe(stub.hermes, true)
    stub.publish(asking)
    stub.publish({ ...asking })
    stub.publish({ ...asking })
    expect(titles(shown)).toEqual(['Approval needed'])
  })

  it('never notifies an approval first seen on screen, even after the user looks away', () => {
    const stub = stubHermes()
    const { shown } = observe(stub.hermes, true)
    stub.publish(asking)
    stub.open.set(showing(OTHER))
    stub.publish({ ...asking })
    expect(shown).toEqual([])
  })

  it.each([['asks', 'Approval needed'], ['replies', 'Hermes finished']] as const)('stays quiet for %s while its switch is off', (kind, title) => {
    const stub = stubHermes(OTHER)
    const { shown } = observe(stub.hermes, true, { ...ON, [kind]: false })
    stub.publish(running)
    stub.publish(kind === 'asks' ? asking : ended)
    expect(titles(shown)).not.toContain(title)
  })

  it('notifies a scheduled job that ran after the first list, whatever is on screen, and a click only raises the window', () => {
    const stub = stubHermes()
    const { shown, raise, ran } = observe(stub.hermes, true)
    stub.jobs.set([job(null)])
    stub.jobs.set([job('2026-11-26T08:00:00')])
    stub.jobs.set([job('2026-11-26T08:00:00')])
    expect(titles(shown)).toEqual(['Scheduled job finished'])
    shown[0]!.click()
    expect(raise).toHaveBeenCalledOnce()
    expect(ran).toEqual([])
  })

  it('stays quiet for scheduled jobs while their switch is off', () => {
    const stub = stubHermes()
    const { shown } = observe(stub.hermes, false, { ...ON, jobs: false })
    stub.jobs.set([job(null)])
    stub.jobs.set([job('2026-11-26T08:00:00')])
    expect(shown).toEqual([])
  })

  it('follows a new connection to its Hermes', () => {
    const old = stubHermes(null)
    const { shown, owner, setup } = observe(old.hermes)
    const next = stubHermes(null)
    owner.hermes = next.hermes
    setup.set({ at: 'pinned' })
    old.publish(running)
    old.publish(ended)
    next.publish({ ...running, id: OTHER })
    next.publish({ ...ended, id: OTHER })
    expect(shown.map(({ notice }) => notice.opens)).toEqual([OTHER])
  })

  it('raises the window on a click and leaves the launch chat while the intro covers it', () => {
    const stub = stubHermes()
    const { shown, raise, ran, setup } = observe(stub.hermes, false, ON, DUE)
    stub.publish(running)
    stub.publish(ended)
    setup.set({ at: 'chat', live: { target: { kind: 'local' }, epoch: 1 } })
    shown[0]!.click()
    expect(raise).toHaveBeenCalledOnce()
    expect(ran).toEqual([])
  })

  it('raises the window on a click and opens the chat even while it is shown, so a pending switch to another bot gives way', () => {
    const stub = stubHermes()
    const { shown, raise, ran } = observe(stub.hermes)
    stub.publish(running)
    stub.publish(ended)
    shown[0]!.click()
    expect(raise).toHaveBeenCalledOnce()
    expect(ran).toEqual([{ do: 'open', ref: { kind: 'chat', sessionId: STORY } }])
  })

  it('raises the window and opens nothing on a click from a connection that was replaced', () => {
    const old = stubHermes()
    const { shown, raise, owner, setup, ran } = observe(old.hermes)
    old.publish(running)
    old.publish(ended)
    const next = stubHermes()
    owner.hermes = next.hermes
    setup.set({ at: 'pinned' })
    shown[0]!.click()
    expect(raise).toHaveBeenCalledOnce()
    expect(ran).toEqual([])
  })

  it('stops when told to', () => {
    const stub = stubHermes()
    const { shown, stop } = observe(stub.hermes)
    stop()
    stub.publish(running)
    stub.publish(ended)
    stub.jobs.set([job(null)])
    stub.jobs.set([job('2026-11-26T08:00:00')])
    expect(shown).toEqual([])
  })
})
