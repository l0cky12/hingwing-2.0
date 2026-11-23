import type { Hermes } from '@highwing/hermes'
import type { Session } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { applyPush, CHANNEL, isWebLink, parseCommand, validators, type Push, type Topic } from '../src/ipc-contract'
import { pinnedConnection } from '../src/main/connection'
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

  it('read a target with the parser the settings file uses', () => {
    expect(parseCommand({ do: 'checkTarget', target: { kind: 'remote', host: ' hermes-host.example-tailnet.ts.net ', port: 22 } }))
      .toEqual({ do: 'checkTarget', target: { kind: 'remote', host: 'hermes-host.example-tailnet.ts.net' } })
    expect(parseCommand({ do: 'checkTarget', target: { kind: 'local' } })).toEqual({ do: 'checkTarget', target: { kind: 'local' } })
    expect(parseCommand({ do: 'editTarget', target: { kind: 'local' } })).toEqual({ do: 'editTarget' })
  })

  it.each([
    ['a target ssh would read as an option', { do: 'checkTarget', target: { kind: 'remote', host: '-oProxyCommand=true' } }],
    ['a check with no target', { do: 'checkTarget' }],
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
    expect(Object.keys(validators).sort()).toEqual([
      'answer', 'archive', 'checkTarget', 'create', 'discard', 'editTarget', 'keepTarget', 'loadEarlier', 'openChat', 'reconnect', 'rename', 'send', 'stop'
    ])
  })
})

describe('serveWindows', () => {
  afterEach(() => vi.useRealTimers())

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
    const event = (url = 'app://index.html'): IpcEvent => ({
      sender: { id: 1, send: (_channel, _id, push) => void pushes.push(push as Push), isDestroyed: () => false, once: (_name, listener) => destroyed.push(listener) },
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
    const copied: string[] = []
    const served = serveWindows(pinnedConnection(hermes), ipc, url => url.startsWith('app://'), text => void copied.push(text))
    return { listeners, handlers, pushes, destroyed, event, emit: (session: Session) => emit(session), commands, copied, served }
  }

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

  it('serves the setup state as a full value, and refuses a setup command a fixture run has no use for', async () => {
    const { listeners, handlers, pushes, event, commands } = harness()
    listeners.get(CHANNEL.watch)!(event(), 3, 'setup')
    expect(pushes).toEqual([{ topic: 'setup', rev: 1, full: { at: 'pinned' } }])
    await expect(handlers.get(CHANNEL.run)!(event(), { do: 'editTarget' })).resolves.toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(commands).toEqual([])
  })

  it('runs a valid command from the app page and refuses a malformed one or a foreign frame', async () => {
    const { handlers, event, commands } = harness()
    const run = handlers.get(CHANNEL.run)!
    await expect(run(event(), { do: 'stop', sessionId: 's1' })).resolves.toEqual({ ok: true, value: undefined })
    await expect(run(event(), { do: 'stop' })).resolves.toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    await expect(run(event('https://example.com/'), { do: 'stop', sessionId: 's1' })).resolves.toMatchObject({ ok: false })
    expect(commands).toEqual([{ do: 'stop', sessionId: 's1' }])
  })

  it('writes a string from the app page to the clipboard', () => {
    const { handlers, event, copied } = harness()
    expect(handlers.get(CHANNEL.copy)!(event(), 'cp notes.md notes.md.bak')).toBe(true)
    expect(copied).toEqual(['cp notes.md notes.md.bak'])
  })

  it.each([
    ['a foreign frame', 'https://example.com/', 'cp notes.md notes.md.bak'],
    ['a value that is not text', 'app://index.html', { text: 'cp' }]
  ])('writes nothing to the clipboard for %s', (_, url, value) => {
    const { handlers, event, copied } = harness()
    expect(handlers.get(CHANNEL.copy)!(event(url), value)).toBe(false)
    expect(copied).toEqual([])
  })

  it('stops handling copies once disposed', () => {
    const { handlers, served } = harness()
    served.dispose()
    expect(handlers.has(CHANNEL.copy)).toBe(false)
  })
})

describe('isWebLink', () => {
  it.each(['https://example.com/style-guide', 'http://localhost:8080/', 'mailto:someone@example.com'])('opens %s', url => {
    expect(isWebLink(url)).toBe(true)
  })

  it.each(['javascript:alert(1)', 'file:///etc/passwd', '/style-guide', 'style-guide.md', '', 'http//missing-colon'])('refuses %s', url => {
    expect(isWebLink(url)).toBe(false)
  })
})
