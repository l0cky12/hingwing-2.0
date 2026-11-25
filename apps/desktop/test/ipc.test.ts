import type { Hermes } from '@highwing/hermes'
import type { Bots, Link, OpenChat, RelayDesk, Session, Sidebar, SlashCatalog } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { applyPush, CHANNEL, isWebLink, parseCommand, parseDraft, parseFileRequest, validators, type AppTopics, type Draft, type FileOutcome, type ImageOutcome, type ImageRequest, type Preview, type PreviewCommand, type Push, type Topic } from '../src/ipc-contract'
import { pinnedConnection } from '../src/main/connection'
import type { Opener } from '../src/main/files'
import type { ImageContext } from '../src/main/images'
import { COALESCE_MS, serveWindows, sessionPatch, type IpcEvent, type IpcMainLike, type Pane } from '../src/main/ipc'

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
    expect(parseCommand({ do: 'open', ref: { kind: 'bot', bot: 'research', sessionId: 's9' }, sessionId: 's9' })).toEqual({ do: 'open', ref: { kind: 'bot', bot: 'research' } })
    expect(parseCommand({ do: 'open', ref: { kind: 'new', bot: 'research', draftId: 'd1', sessionId: 's9' } })).toEqual({ do: 'open', ref: { kind: 'new', bot: 'research', draftId: 'd1' } })
    expect(parseCommand({ do: 'open', ref: { kind: 'new', bot: null, draftId: 'd1' } })).toEqual({ do: 'open', ref: { kind: 'new', bot: null, draftId: 'd1' } })
    expect(parseCommand({ do: 'open', ref: { kind: 'chat', sessionId: 's9', bot: 'research' } })).toEqual({ do: 'open', ref: { kind: 'chat', sessionId: 's9' } })
    expect(parseCommand({ do: 'start', chat: { kind: 'bot', bot: 'research', sessionId: null, draftId: 'd1' }, text: 'hello', sessionId: 's9' }))
      .toEqual({ do: 'start', chat: { kind: 'bot', bot: 'research', sessionId: null }, text: 'hello' })
    expect(parseCommand({ do: 'start', chat: { kind: 'new', bot: null, draftId: 'd1', sessionId: null }, text: 'hello' }))
      .toEqual({ do: 'start', chat: { kind: 'new', bot: null, draftId: 'd1', sessionId: null }, text: 'hello' })
    const model = { id: 'careful-large', provider: 'acme', providerName: 'Acme' }
    expect(parseCommand({ do: 'pickModel', sessionId: 's1', model: { ...model, price: 9 } })).toEqual({ do: 'pickModel', sessionId: 's1', model })
    expect(parseCommand({ do: 'setYolo', sessionId: 's1', on: false, extra: 1 })).toEqual({ do: 'setYolo', sessionId: 's1', on: false })
    expect(parseCommand({ do: 'pickModel', sessionId: 's1', model, confirm: 'tok' })).toEqual({ do: 'pickModel', sessionId: 's1', model, confirm: 'tok' })
  })

  it('keep the four fields of a new bot, and the bot whose models are listed or null for the socket\'s own', () => {
    const model = { id: 'careful-large', provider: 'acme', providerName: 'Acme' }
    const draft = { name: 'Rae', description: '', model, persona: 'You write short reports.\n' }
    expect(parseCommand({ do: 'createBot', draft: { ...draft, extra: 1, model: { ...model, price: 9 } }, extra: 1 })).toEqual({ do: 'createBot', draft })
    expect(parseCommand({ do: 'createBot', draft: { ...draft, model: null } })).toEqual({ do: 'createBot', draft: { ...draft, model: null } })
    expect(parseCommand({ do: 'botModels', bot: null, extra: 1 })).toEqual({ do: 'botModels', bot: null })
    expect(parseCommand({ do: 'botModels', bot: 'research' })).toEqual({ do: 'botModels', bot: 'research' })
  })

  it('keep a rewind to a stored row and the text to send there', () => {
    expect(parseCommand({ do: 'rewind', sessionId: 's1', rowId: 7, text: 'again', extra: 1 })).toEqual({ do: 'rewind', sessionId: 's1', rowId: 7, text: 'again' })
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
    ['a rewind to row zero', { do: 'rewind', sessionId: 's1', rowId: 0, text: 'again' }],
    ['a rewind to a fractional row', { do: 'rewind', sessionId: 's1', rowId: 1.5, text: 'again' }],
    ['a rewind to a row named as text', { do: 'rewind', sessionId: 's1', rowId: '7', text: 'again' }],
    ['a rewind with a blank message', { do: 'rewind', sessionId: 's1', rowId: 7, text: ' ' }],
    ['an open that names no chat', { do: 'open' }],
    ['an open of a kind of chat Highwing does not know', { do: 'open', ref: { kind: 'session', sessionId: 's1' } }],
    ['an open of a bot with no name', { do: 'open', ref: { kind: 'bot', bot: ' ' } }],
    ['an open of a new chat with no draft id', { do: 'open', ref: { kind: 'new', bot: 'research', draftId: ' ' } }],
    ['an open of a new chat whose bot is not a name or null', { do: 'open', ref: { kind: 'new', draftId: 'd1' } }],
    ['a first message with no chat', { do: 'start', text: 'hello' }],
    ['a first message to a chat that has a session', { do: 'start', chat: { kind: 'new', bot: null, draftId: 'd1', sessionId: 's1' }, text: 'hello' }],
    ['a first message to a chat with no session named', { do: 'start', chat: { kind: 'bot', bot: 'research' }, text: 'hello' }],
    ['a first message to a plain chat', { do: 'start', chat: { kind: 'chat', bot: null, sessionId: null }, text: 'hello' }],
    ['a first message to a chat picked from the list', { do: 'start', chat: { kind: 'chat', sessionId: 's1' }, text: 'hello' }],
    ['an open of a picked chat with no session', { do: 'open', ref: { kind: 'chat', sessionId: ' ' } }],
    ['a new bot with no name', { do: 'createBot', draft: { name: ' ', description: '', model: null, persona: '' } }],
    ['a new bot whose description is not text', { do: 'createBot', draft: { name: 'Rae', description: 7, model: null, persona: '' } }],
    ['a new bot whose persona is missing', { do: 'createBot', draft: { name: 'Rae', description: '', model: null } }],
    ['a new bot whose model is not a model', { do: 'createBot', draft: { name: 'Rae', description: '', model: { id: 'm' }, persona: '' } }],
    ['a new bot whose model is left out', { do: 'createBot', draft: { name: 'Rae', description: '', persona: '' } }],
    ['a new bot with no draft', { do: 'createBot' }],
    ['a model list for a bot with no name', { do: 'botModels', bot: ' ' }],
    ['a model list that names no bot', { do: 'botModels' }],
    ['a blank first message', { do: 'start', chat: { kind: 'bot', bot: 'research', sessionId: null }, text: '' }],
    ['a reply of the wrong kind', { do: 'answer', sessionId: 's1', promptId: 'p1', reply: { kind: 'choice', value: 1 } }],
    ['a non-boolean start', { do: 'reconnect', start: 'yes' }],
    ['a YOLO switch with a word for on', { do: 'setYolo', sessionId: 's1', on: 'on' }],
    ['a YOLO switch with no chat', { do: 'setYolo', on: true }],
    ['a pick with no provider', { do: 'pickModel', sessionId: 's1', model: { id: 'm', provider: '', providerName: '' } }],
    ['a pick with a blank confirm token', { do: 'pickModel', sessionId: 's1', model: { id: 'm', provider: 'p', providerName: 'P' }, confirm: ' ' }]
  ])('refuse %s', (_, raw) => {
    expect(parseCommand(raw)).toBeNull()
  })

  it('keep a web page to preview or browse, and where the page sits', () => {
    expect(parseCommand({ do: 'preview', url: 'http://localhost:5173/', label: 'x' })).toEqual({ do: 'preview', url: 'http://localhost:5173/' })
    expect(parseCommand({ do: 'browse', url: 'https://example.com/docs' })).toEqual({ do: 'browse', url: 'https://example.com/docs' })
    expect(parseCommand({ do: 'placePreview', rect: { x: 600, y: 56, width: 580, height: 804, z: 1 } })).toEqual({ do: 'placePreview', rect: { x: 600, y: 56, width: 580, height: 804 } })
    expect(parseCommand({ do: 'placePreview', rect: null })).toEqual({ do: 'placePreview', rect: null })
  })

  it.each([
    'mailto:someone@example.com', 'file:///etc/passwd', 'javascript:alert(1)', '/tmp/site/index.html', 'highwing://chat', ''
  ])('refuse to preview or browse %s', url => {
    expect(parseCommand({ do: 'preview', url })).toBeNull()
    expect(parseCommand({ do: 'browse', url })).toBeNull()
  })

  it.each([
    ['no rect', {}],
    ['a negative place', { rect: { x: -1, y: 0, width: 10, height: 10 } }],
    ['a size that is no number', { rect: { x: 0, y: 0, width: '10', height: 10 } }],
    ['an endless size', { rect: { x: 0, y: 0, width: Infinity, height: 10 } }]
  ])('refuse a place for the page with %s', (_, raw) => {
    expect(parseCommand({ do: 'placePreview', ...raw })).toBeNull()
  })

  it('cover every command verb', () => {
    expect(Object.keys(validators).sort()).toEqual([
      'answer', 'archive', 'botModels', 'browse', 'checkTarget', 'closePreview', 'contextBreakdown', 'createBot', 'discard', 'editTarget', 'keepTarget', 'loadEarlier', 'models', 'open', 'openChat',
      'pickModel', 'placePreview', 'preview', 'reconnect', 'reloadPreview', 'rename', 'rewind', 'send', 'setYolo', 'start', 'stop'
    ])
  })
})

const still = <T>(value: T) => ({ get: () => value, subscribe: () => () => {} })
const LINK: Link = { state: 'blocked', why: 'hermes-missing', message: 'A link of this test.' }
const SIDEBAR: Sidebar = { bot: null, status: 'stale', rows: [] }
const NO_BOTS: Bots = { state: 'listed', roster: { featured: null, sections: [] } }
const NOTHING_OPEN: OpenChat = { shown: null, opening: null }
const NO_RELAYS: RelayDesk = { supported: false, bySession: {} }

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
  let catalog: SlashCatalog = []
  const catalogListeners = new Set<(value: SlashCatalog) => void>()
  let bots: Bots = { state: 'loading' }
  const botsListeners = new Set<(value: Bots) => void>()
  let open = NOTHING_OPEN
  const openListeners = new Set<(value: OpenChat) => void>()
  const hermes = {
    link: still(LINK),
    sidebar: still(SIDEBAR),
    open: {
      get: () => open,
      subscribe: (listener: (value: OpenChat) => void) => {
        openListeners.add(listener)
        return () => void openListeners.delete(listener)
      }
    },
    bots: {
      get: () => bots,
      subscribe: (listener: (value: Bots) => void) => {
        botsListeners.add(listener)
        return () => void botsListeners.delete(listener)
      }
    },
    relay: still(NO_RELAYS),
    slash: {
      get: () => catalog,
      subscribe: (listener: (value: SlashCatalog) => void) => {
        catalogListeners.add(listener)
        return () => void catalogListeners.delete(listener)
      }
    },
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
  const loaded: { request: ImageRequest; context: ImageContext }[] = []
  const opener: Opener = {
    open: async path => (opened.push({ action: 'open', path }), { ok: true }),
    show: async path => (opened.push({ action: 'show', path }), { ok: true }),
    browse: async () => { throw new Error('a window never browses through the opener') }
  }
  const kept: Draft[] = []
  const stored: readonly Draft[] = [{ key: 'new', bot: null, text: 'kept on disk' }]
  const previewed: { request: string; label: string | null; session: Session | undefined }[] = []
  const toPane: PreviewCommand[] = []
  const pane: Pane = {
    preview: still<Preview>({ state: 'closed' }),
    show: (request, label, session) => (previewed.push({ request, label, session }), request.startsWith('/')),
    run: async command => (toPane.push(command), { ok: true, value: undefined })
  }
  const served = serveWindows(
    pinnedConnection(hermes), ipc, url => url.startsWith('app://'), opener, { load: async (request, context) => (loaded.push({ request, context }), { ok: false }) },
    { keep: draft => void kept.push(draft), load: async () => stored }, pane
  )
  const setCatalog = (next: SlashCatalog) => {
    catalog = next
    catalogListeners.forEach(listener => listener(next))
  }
  const setBots = (next: Bots) => {
    bots = next
    botsListeners.forEach(listener => listener(next))
  }
  const setOpen = (next: OpenChat) => {
    open = next
    openListeners.forEach(listener => listener(next))
  }
  return { listeners, handlers, pushes, destroyed, event, emit: (session: Session) => emit(session), commands, opened, loaded, kept, stored, previewed, toPane, served, setCatalog, setBots, setOpen }
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

  it('serves the slash catalog as full values, the empty one first', () => {
    vi.useFakeTimers()
    const { listeners, pushes, event, setCatalog } = harness()
    listeners.get(CHANNEL.watch)!(event(), 3, 'slash')
    const listed: SlashCatalog = [{ kind: 'command', name: 'status', description: 'Show session, model, token, and context info' }]
    vi.advanceTimersByTime(COALESCE_MS)
    setCatalog(listed)
    expect(pushes).toEqual([{ topic: 'slash', rev: 1, full: [] }, { topic: 'slash', rev: 2, full: listed }])
  })

  it('serves every app topic a full value from its own feed, and nothing for a name that is no topic', () => {
    const { listeners, pushes, event } = harness()
    const served: AppTopics = { setup: { at: 'pinned' }, link: LINK, sidebar: SIDEBAR, slash: [], bots: { state: 'loading' }, open: NOTHING_OPEN, relay: NO_RELAYS, preview: { state: 'closed' } }
    const watch = listeners.get(CHANNEL.watch)!
    Object.keys(served).forEach((name, id) => watch(event(), id, name))
    expect(pushes).toEqual(Object.entries(served).map(([name, full]) => ({ topic: name, rev: 1, full })))
    for (const name of ['toString', 'session:', 'bot', 7, null]) watch(event(), 99, name)
    expect(pushes).toHaveLength(Object.keys(served).length)
  })

  it('serves the bots as full values, and nothing when the hub publishes no change', () => {
    vi.useFakeTimers()
    const { listeners, pushes, event, setBots } = harness()
    listeners.get(CHANNEL.watch)!(event(), 4, 'bots')
    vi.advanceTimersByTime(COALESCE_MS)
    setBots(NO_BOTS)
    vi.advanceTimersByTime(COALESCE_MS)
    setBots(NO_BOTS)
    vi.advanceTimersByTime(COALESCE_MS)
    expect(pushes).toEqual([{ topic: 'bots', rev: 1, full: { state: 'loading' } }, { topic: 'bots', rev: 2, full: NO_BOTS }])
  })

  it('serves the open chat as full values, and passes a click on a bot to the hub', async () => {
    vi.useFakeTimers()
    const { listeners, handlers, pushes, event, setOpen, commands } = harness()
    listeners.get(CHANNEL.watch)!(event(), 5, 'open')
    vi.advanceTimersByTime(COALESCE_MS)
    const research = { shown: { kind: 'bot', bot: 'research', sessionId: 'local-0001' }, opening: null } as OpenChat
    setOpen(research)
    expect(pushes).toEqual([{ topic: 'open', rev: 1, full: NOTHING_OPEN }, { topic: 'open', rev: 2, full: research }])
    await handlers.get(CHANNEL.run)!(event(), { do: 'open', ref: { kind: 'bot', bot: 'research' } })
    await handlers.get(CHANNEL.run)!(event(), { do: 'start', chat: { kind: 'bot', bot: 'research', sessionId: null }, text: 'hello' })
    expect(commands).toEqual([{ do: 'open', ref: { kind: 'bot', bot: 'research' } }, { do: 'start', chat: { kind: 'bot', bot: 'research', sessionId: null }, text: 'hello' }])
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

  it('passes a command for the pane to the pane, and never to Hermes', async () => {
    const { handlers, event, commands, toPane } = harness()
    const run = handlers.get(CHANNEL.run)!
    const asked: PreviewCommand[] = [
      { do: 'preview', url: 'http://localhost:5173/' }, { do: 'browse', url: 'https://example.com/' }, { do: 'reloadPreview' },
      { do: 'placePreview', rect: { x: 600, y: 56, width: 580, height: 804 } }, { do: 'closePreview' }
    ]
    for (const command of asked) await expect(run(event(), command)).resolves.toEqual({ ok: true, value: undefined })
    await expect(run(event('https://example.com/'), { do: 'browse', url: 'https://example.com/' })).resolves.toMatchObject({ ok: false })
    await expect(run(event(), { do: 'browse', url: 'file:///etc/passwd' })).resolves.toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(toPane).toEqual(asked)
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
})

describe('isWebLink', () => {
  it.each(['https://example.com/style-guide', 'http://localhost:8080/', 'mailto:someone@example.com'])('opens %s', url => {
    expect(isWebLink(url)).toBe(true)
  })

  it.each(['javascript:alert(1)', 'file:///etc/passwd', '/style-guide', 'style-guide.md', '', 'http//missing-colon'])('refuses %s', url => {
    expect(isWebLink(url)).toBe(false)
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

  it('previews a path with the watched session, which the pane judges, and refuses what the pane refuses', async () => {
    const { file, previewed, opened } = watching()
    await expect(file({ ...asked('open', NOTES), action: 'preview' })).resolves.toEqual({ ok: true })
    await expect(file({ ...asked('open', 'notes.md'), action: 'preview' })).resolves.toEqual({ ok: false, reason: 'refused' })
    expect(previewed).toEqual([{ request: NOTES, label: null, session: diffMoment() }, { request: 'notes.md', label: null, session: diffMoment() }])
    expect(opened).toEqual([])
  })

  it('stops answering once disposed', () => {
    const { handlers, served } = watching()
    served.dispose()
    expect(handlers.has(CHANNEL.file)).toBe(false)
  })
})

describe('the image call', () => {
  const asked = { kind: 'tool', sessionId: fixture.header.sessionId, path: '/tmp/shot.png' }

  it('judges a tool image against the session this window watches, and says a pinned connection is local', async () => {
    const rig = harness()
    rig.listeners.get(CHANNEL.watch)!(rig.event(), 1, topic)
    rig.emit(moments[3]!)
    const call = rig.handlers.get(CHANNEL.image)!
    await expect(call(rig.event(), asked)).resolves.toEqual({ ok: false })
    expect(rig.loaded).toEqual([{ request: asked, context: { session: moments[3], local: true } }])
  })

  it('gives the loader no session for one this window does not watch', async () => {
    const rig = harness()
    await rig.handlers.get(CHANNEL.image)!(rig.event(), asked)
    expect(rig.loaded[0]?.context.session).toBeUndefined()
  })

  it('refuses a foreign frame and a malformed request without asking the loader', async () => {
    const rig = harness()
    const call = rig.handlers.get(CHANNEL.image)!
    const refused: ImageOutcome = { ok: false }
    await expect(call(rig.event('https://example.com/'), { kind: 'web', url: 'https://example.com/c.png' })).resolves.toEqual(refused)
    for (const raw of [null, 'x', { kind: 'web', url: 'file:///etc/passwd' }, { kind: 'tool', path: '/tmp/shot.png' }]) {
      await expect(call(rig.event(), raw)).resolves.toEqual(refused)
    }
    expect(rig.loaded).toEqual([])
  })

  it('stops answering once disposed', () => {
    const { handlers, served } = harness()
    served.dispose()
    expect(handlers.has(CHANNEL.image)).toBe(false)
  })
})

describe('the draft calls', () => {
  const draft = { key: 'chat:local-0102', bot: 'research', text: 'half a thought' }

  it('keep a draft from the app page and hand back the stored ones', async () => {
    const rig = harness()
    rig.listeners.get(CHANNEL.keepDraft)!(rig.event(), draft)
    rig.listeners.get(CHANNEL.keepDraft)!(rig.event(), { ...draft, text: '' })
    expect(rig.kept).toEqual([draft, { ...draft, text: '' }])
    await expect(rig.handlers.get(CHANNEL.drafts)!(rig.event())).resolves.toEqual(rig.stored)
  })

  it('refuse a foreign frame and a malformed draft', async () => {
    const rig = harness()
    const keep = rig.listeners.get(CHANNEL.keepDraft)!
    keep(rig.event('https://example.com/'), draft)
    for (const raw of [null, 'x', { ...draft, key: 'session:local-0102' }, { ...draft, key: 'bot:' }, { ...draft, text: 7 }, { ...draft, bot: '' }]) keep(rig.event(), raw)
    expect(rig.kept).toEqual([])
    await expect(rig.handlers.get(CHANNEL.drafts)!(rig.event('https://example.com/'))).resolves.toEqual([])
  })

  it('stop answering once disposed', () => {
    const { handlers, listeners, served } = harness()
    served.dispose()
    expect(handlers.has(CHANNEL.drafts)).toBe(false)
    expect(listeners.has(CHANNEL.keepDraft)).toBe(false)
  })
})

describe('parseDraft', () => {
  it('keeps the three known fields of each kind of key', () => {
    expect(parseDraft({ key: 'bot:research', bot: 'research', text: 'x', extra: 1 })).toEqual({ key: 'bot:research', bot: 'research', text: 'x' })
    expect(parseDraft({ key: 'new', bot: null, text: '' })).toEqual({ key: 'new', bot: null, text: '' })
  })
})

describe('parseFileRequest', () => {
  it('keeps the three known fields', () => {
    expect(parseFileRequest({ action: 'show', sessionId: 's1', path: '/a/b', extra: 1 })).toEqual({ action: 'show', sessionId: 's1', path: '/a/b' })
  })
})
