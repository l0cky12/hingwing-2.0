import type { Hermes } from '@highwing/hermes'
import type { Session } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { applyPush, CHANNEL, parseCommand, parseFileRequest, validators, type FileOutcome, type Push, type Topic } from '../src/ipc-contract'
import type { Opener } from '../src/main/files'
import { COALESCE_MS, serveWindows, sessionPatch, type IpcEvent, type IpcMainLike } from '../src/main/ipc'

const fixture = loadFixture('fixtures/errand.jsonl')
const topic = `session:${fixture.header.sessionId}` as const
let moments: readonly Session[] = []

beforeAll(async () => {
  const sessions: Session[] = []
  for await (const { session } of play(fixture)) sessions.push(session)
  moments = sessions
})

const itemsOf = (session: Session) => (session.run.state === 'running' ? session.run.turn.items : [])
const patchPush = (rev: number, before: Session, after: Session): Push<typeof topic> => ({ topic, rev, patch: sessionPatch(before, after) })

describe('applyPush', () => {
  it('rebuilds every moment of the errand from the one before, keeping untouched items by reference', () => {
    for (let index = 1; index < moments.length; index++) {
      const [before, after] = [moments[index - 1]!, moments[index]!]
      const next = applyPush(before, 4, patchPush(5, before, after))
      if (next === 'need-full') throw new Error(`moment ${index} asked for a full value`)
      expect(next.rev).toBe(5)
      expect(next.value, `moment ${index}`).toEqual(after)
      const kept = itemsOf(before).filter((item, at) => itemsOf(after)[at] === item)
      kept.forEach(item => expect(itemsOf(next.value as Session)).toContain(item))
    }
  })

  it('appends a new item without resending the ones before it', () => {
    const index = moments.findIndex((after, at) => at > 0 && itemsOf(after).length > itemsOf(moments[at - 1]!).length && itemsOf(moments[at - 1]!).length > 0)
    const [before, after] = [moments[index - 1]!, moments[index]!]
    const push = patchPush(2, before, after)
    if (!('patch' in push) || push.patch.run.state !== 'running') throw new Error('expected a running patch')
    expect(push.patch.run.items.from).toBe(itemsOf(before).length)
    const next = applyPush(before, 1, push)
    expect(next !== 'need-full' && itemsOf(next.value as Session)[0]).toBe(itemsOf(before)[0])
  })

  it('replaces the last item in place when a delta grows it', () => {
    const index = moments.findIndex((after, at) => {
      const before = moments[at - 1]
      return before !== undefined && itemsOf(after).length === itemsOf(before).length && itemsOf(after).length > 0 && itemsOf(after).at(-1) !== itemsOf(before).at(-1)
    })
    const [before, after] = [moments[index - 1]!, moments[index]!]
    const push = patchPush(2, before, after)
    if (!('patch' in push) || push.patch.run.state !== 'running') throw new Error('expected a running patch')
    expect(push.patch.run.items).toEqual({ from: itemsOf(before).length - 1, items: [itemsOf(after).at(-1)] })
    expect(applyPush(before, 1, push)).toEqual({ value: after, rev: 2 })
  })

  it('takes a full value whatever it held', () => {
    const [first, last] = [moments[0]!, moments.at(-1)!]
    expect(applyPush<typeof topic>(first, 7, { topic, rev: 1, full: last })).toEqual({ value: last, rev: 1 })
    expect(applyPush<'link'>(undefined, 0, { topic: 'link', rev: 1, full: { state: 'online' } })).toEqual({ value: { state: 'online' }, rev: 1 })
  })

  it('asks for a full value on a revision gap or with nothing held', () => {
    const [before, after] = [moments[0]!, moments[1]!]
    expect(applyPush(before, 3, patchPush(5, before, after))).toBe('need-full')
    expect(applyPush(undefined, 0, patchPush(1, before, after))).toBe('need-full')
  })
})

describe('validators', () => {
  it('keep only the known fields of a good command', () => {
    expect(parseCommand({ do: 'send', sessionId: 's1', text: 'hello', extra: 'dropped' })).toEqual({ do: 'send', sessionId: 's1', text: 'hello' })
    expect(parseCommand({ do: 'answer', sessionId: 's1', promptId: 'p1', reply: { kind: 'choice', value: 'once', x: 1 } }))
      .toEqual({ do: 'answer', sessionId: 's1', promptId: 'p1', reply: { kind: 'choice', value: 'once' } })
    expect(parseCommand({ do: 'reconnect', start: true })).toEqual({ do: 'reconnect', start: true })
  })

  it.each([
    ['not an object', 'send'],
    ['an unknown verb', { do: 'format-disk' }],
    ['a verb from the prototype', { do: 'toString' }],
    ['an empty session id', { do: 'stop', sessionId: '' }],
    ['a blank message', { do: 'send', sessionId: 's1', text: '   ' }],
    ['a reply of the wrong kind', { do: 'answer', sessionId: 's1', promptId: 'p1', reply: { kind: 'choice', value: 1 } }],
    ['a non-boolean start', { do: 'reconnect', start: 'yes' }],
    ['a missing cwd', { do: 'create', draftId: 'd1' }]
  ])('refuse %s', (_, raw) => {
    expect(parseCommand(raw)).toBeNull()
  })

  it('cover every command verb', () => {
    expect(Object.keys(validators).sort()).toEqual(['answer', 'archive', 'create', 'discard', 'loadEarlier', 'reconnect', 'rename', 'send', 'stop'])
  })
})

function harness() {
  const listeners = new Map<string, (event: IpcEvent, ...args: unknown[]) => void>()
  const handlers = new Map<string, (event: IpcEvent, ...args: unknown[]) => unknown>()
  const ipc: IpcMainLike = {
    on: (channel, listener) => listeners.set(channel, listener),
    handle: (channel, handler) => void handlers.set(channel, handler),
    removeAllListeners: channel => listeners.delete(channel),
    removeHandler: channel => void handlers.delete(channel)
  }
  const pushes: Push[] = []
  const destroyed: (() => void)[] = []
  const event = (url = 'app://index.html', senderId = 1): IpcEvent => ({
    sender: { id: senderId, send: (_channel, _id, push) => void pushes.push(push as Push), isDestroyed: () => false, once: (_name, listener) => destroyed.push(listener) },
    senderFrame: { url, parent: null }
  })
  let emit: (session: Session) => void = () => {}
  const commands: unknown[] = []
  const hermes = {
    watch: (_id: unknown, listener: (session: Session) => void) => {
      emit = listener
      listener(moments[0]!)
      return () => { emit = () => {} }
    },
    run: async (command: unknown) => {
      commands.push(command)
      return { ok: true, value: undefined }
    }
  } as unknown as Hermes
  const opened: { action: string; path: string }[] = []
  const opener: Opener = {
    open: async path => (opened.push({ action: 'open', path }), { ok: true }),
    show: async path => (opened.push({ action: 'show', path }), { ok: true })
  }
  const served = serveWindows(hermes, ipc, url => url.startsWith('app://'), opener)
  return { listeners, handlers, pushes, destroyed, event, emit: (session: Session) => emit(session), commands, opened, served }
}

describe('serveWindows', () => {
  afterEach(() => vi.useRealTimers())

  it('sends one full value, then coalesced tail patches the window can apply', () => {
    vi.useFakeTimers()
    const { listeners, pushes, event, emit } = harness()
    listeners.get(CHANNEL.watch)!(event(), 7, topic)
    expect(pushes).toEqual([{ topic, rev: 1, full: moments[0] }])

    moments.slice(1, 6).forEach(emit)
    expect(pushes).toHaveLength(1)
    vi.advanceTimersByTime(COALESCE_MS)
    expect(pushes).toHaveLength(2)
    expect(pushes[1]).toMatchObject({ topic, rev: 2, patch: expect.anything() })

    vi.advanceTimersByTime(COALESCE_MS)
    emit(moments[6]!)
    expect(pushes).toHaveLength(3)

    let held: { value: unknown; rev: number } = { value: undefined, rev: 0 }
    for (const push of pushes) {
      const next = applyPush(held.value as Session | undefined, held.rev, push as Push<Topic>)
      if (next === 'need-full') throw new Error('the window fell behind')
      held = next
    }
    expect(held).toEqual({ value: moments[6], rev: 3 })
  })

  it('stops pushing when the window unwatches or is destroyed', () => {
    vi.useFakeTimers()
    const { listeners, pushes, event, emit, destroyed } = harness()
    listeners.get(CHANNEL.watch)!(event(), 1, topic)
    listeners.get(CHANNEL.unwatch)!(event(), 1)
    emit(moments[1]!)
    vi.advanceTimersByTime(COALESCE_MS * 4)
    expect(pushes).toHaveLength(1)

    listeners.get(CHANNEL.watch)!(event(), 2, topic)
    destroyed.forEach(listener => listener())
    emit(moments[2]!)
    vi.advanceTimersByTime(COALESCE_MS * 4)
    expect(pushes).toHaveLength(2)
  })

  it('runs a valid command from the app page and refuses a malformed one or a foreign frame', async () => {
    const { handlers, event, commands } = harness()
    const run = handlers.get(CHANNEL.run)!
    await expect(run(event(), { do: 'stop', sessionId: 's1' })).resolves.toEqual({ ok: true, value: undefined })
    await expect(run(event(), { do: 'stop' })).resolves.toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    await expect(run(event('https://example.com/'), { do: 'stop', sessionId: 's1' })).resolves.toMatchObject({ ok: false })
    expect(commands).toEqual([{ do: 'stop', sessionId: 's1' }])
  })
})

describe('the file call', () => {
  const NOTES = '/tmp/hermes-proto-work/notes.md'
  const diffMoment = () => moments.find(session => itemsOf(session).some(item => item.kind === 'tool' && item.status.s === 'done' && item.status.diffs.some(diff => diff.path === NOTES)))!
  const asked = (action: 'open' | 'show', path: string, sessionId: string = fixture.header.sessionId) => ({ action, sessionId, path })

  function watching(senderId = 1) {
    const rig = harness()
    rig.listeners.get(CHANNEL.watch)!(rig.event(undefined, senderId), 1, topic)
    rig.emit(diffMoment())
    const file = rig.handlers.get(CHANNEL.file)!
    return { ...rig, file: (raw: unknown, event = rig.event(undefined, senderId)) => file(event, raw) as Promise<FileOutcome> }
  }

  it('opens a path a step of the watched session named, once, with the absolute path', async () => {
    const { file, opened } = watching()
    await expect(file(asked('open', NOTES))).resolves.toEqual({ ok: true })
    expect(opened).toEqual([{ action: 'open', path: NOTES }])
    await expect(file(asked('show', NOTES))).resolves.toEqual({ ok: true })
    expect(opened).toEqual([{ action: 'open', path: NOTES }, { action: 'show', path: NOTES }])
  })

  it.each([
    ['a path no step named', '/tmp/hermes-proto-work/other.md'],
    ['a path that climbs out of what a step named', '/tmp/hermes-proto-work/../../etc/passwd'],
    ['the folder that holds what a step named', '/tmp/hermes-proto-work'],
    ['a file url for a path a step named', `file://${NOTES}`],
    ['a web url', 'https://example.com/notes.md'],
    ['a relative path', 'notes.md']
  ])('refuses %s', async (_, path) => {
    const { file, opened } = watching()
    await expect(file(asked('open', path))).resolves.toEqual({ ok: false, reason: 'refused' })
    await expect(file(asked('show', path))).resolves.toEqual({ ok: false, reason: 'refused' })
    expect(opened).toEqual([])
  })

  it('refuses a path before any step has named it', async () => {
    const rig = harness()
    rig.listeners.get(CHANNEL.watch)!(rig.event(), 1, topic)
    await expect(rig.handlers.get(CHANNEL.file)!(rig.event(), asked('open', NOTES))).resolves.toEqual({ ok: false, reason: 'refused' })
    expect(rig.opened).toEqual([])
  })

  it('refuses a session this window does not watch, whatever another window watches', async () => {
    const { file, opened, listeners, event } = watching()
    await expect(file(asked('open', NOTES, 'someone-else'))).resolves.toEqual({ ok: false, reason: 'refused' })
    await expect(file(asked('open', NOTES), event(undefined, 2))).resolves.toEqual({ ok: false, reason: 'refused' })
    listeners.get(CHANNEL.unwatch)!(event(), 1)
    await expect(file(asked('open', NOTES))).resolves.toEqual({ ok: false, reason: 'refused' })
    expect(opened).toEqual([])
  })

  it('refuses a foreign frame and a malformed request', async () => {
    const { file, opened, event } = watching()
    await expect(file(asked('open', NOTES), event('https://example.com/'))).resolves.toEqual({ ok: false, reason: 'refused' })
    for (const raw of [null, 'open', { ...asked('open', NOTES), action: 'delete' }, asked('open', '  '), { action: 'open', path: NOTES }]) {
      await expect(file(raw)).resolves.toEqual({ ok: false, reason: 'refused' })
    }
    expect(opened).toEqual([])
  })

  it('stops answering once disposed', () => {
    const { handlers, served } = watching()
    served.dispose()
    expect(handlers.has(CHANNEL.file)).toBe(false)
  })
})

describe('parseFileRequest', () => {
  it('keeps the three known fields', () => {
    expect(parseFileRequest({ action: 'show', sessionId: 's1', path: '/a/b', extra: 1 })).toEqual({ action: 'show', sessionId: 's1', path: '/a/b' })
  })
})
