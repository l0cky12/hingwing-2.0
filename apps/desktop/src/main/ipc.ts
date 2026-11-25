import type { Hermes } from '@highwing/hermes'
import type { CommandOutcome, Session, SessionId } from '@highwing/hermes/domain'
import { CHANNEL, isAppTopic, parseCommand, parseDraft, parseFileRequest, parseImageRequest, parseTopic, type AppTopic, type FileOutcome, type ImageOutcome, type Push, type SessionPatch, type Setup, type Tail, type Topic } from '../ipc-contract'
import type { ConnectionOwner } from './connection'
import type { DraftStore } from './drafts'
import { openablePath, type Opener } from './files'
import type { ImageLoader } from './images'

export const COALESCE_MS = 16

export interface WindowSender {
  readonly id: number
  send(channel: string, ...args: unknown[]): void
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
}
export interface IpcEvent {
  readonly sender: WindowSender
  readonly senderFrame: { readonly url: string; readonly parent: unknown } | null
}
export interface IpcMainLike {
  on(channel: string, listener: (event: IpcEvent, ...args: unknown[]) => void): unknown
  handle(channel: string, listener: (event: IpcEvent, ...args: unknown[]) => unknown): void
  removeAllListeners(channel: string): unknown
  removeHandler(channel: string): void
}

type Source = (listener: (value: unknown) => void) => () => void
type Kind = AppTopic | 'session'

const current = <T>(feed: { get(): T; subscribe(listener: (value: T) => void): () => void }): Source => listener => {
  listener(feed.get())
  return feed.subscribe(listener)
}
const NEVER: Source = () => () => {}

/** A Hermes topic is bound to the connection that is live when the window asks. A window that sees a new epoch asks again. */
const onHermes = (source: (hermes: Hermes, topic: Topic) => Source) => (owner: ConnectionOwner, topic: Topic): Source =>
  owner.hermes === null ? NEVER : source(owner.hermes, topic)

const SOURCES: { readonly [K in Kind]: (owner: ConnectionOwner, topic: Topic) => Source } = {
  setup: owner => current(owner.setup),
  link: onHermes(hermes => current(hermes.link)),
  sidebar: onHermes(hermes => current(hermes.sidebar)),
  slash: onHermes(hermes => current(hermes.slash)),
  bots: onHermes(hermes => current(hermes.bots)),
  open: onHermes(hermes => current(hermes.open)),
  session: onHermes((hermes, topic) => listener => hermes.watch(topic.slice('session:'.length) as SessionId, listener))
}
const kindOf = (topic: Topic): Kind => (isAppTopic(topic) ? topic : 'session')

function tail<T>(pushed: readonly T[], next: readonly T[]): Tail<T> {
  let from = 0
  while (from < pushed.length && from < next.length && pushed[from] === next[from]) from++
  return { from, items: next.slice(from) }
}

export function sessionPatch(pushed: Session, next: Session): SessionPatch {
  const { history, run, ...rest } = next
  if (run.state === 'idle') return { rest, history: tail(pushed.history, history), run }
  const { turn: { items, ...turn }, ...head } = run
  return { rest, history: tail(pushed.history, history), run: { state: 'running', head, turn, items: tail(pushed.run.state === 'running' ? pushed.run.turn.items : [], items) } }
}

interface Served {
  readonly topic: Topic
  current(): unknown
  stop(): void
}

function serveTopic(topic: Topic, source: Source, send: (push: Push) => void): Served {
  let pushed: unknown
  let latest: unknown
  let rev = 0
  let cooling: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (latest === pushed) {
      cooling = null
      return
    }
    rev++
    send((pushed !== undefined && kindOf(topic) === 'session'
      ? { topic, rev, patch: sessionPatch(pushed as Session, latest as Session) }
      : { topic, rev, full: latest }) as Push)
    pushed = latest
    cooling = setTimeout(flush, COALESCE_MS)
  }
  const stop = source(value => {
    latest = value
    if (cooling === null) flush()
  })
  return {
    topic,
    current: () => latest,
    stop() {
      stop()
      if (cooling !== null) clearTimeout(cooling)
    }
  }
}

const REFUSED: CommandOutcome<never> = { ok: false, refusal: { kind: 'rejected', message: 'Highwing refused a malformed request from its window.' } }
const FILE_REFUSED: FileOutcome = { ok: false, reason: 'refused' }
const IMAGE_REFUSED: ImageOutcome = { ok: false }

const isLocal = (setup: Setup) => setup.at === 'pinned' || setup.live?.target.kind === 'local'

export function serveWindows(owner: ConnectionOwner, ipc: IpcMainLike, isAppUrl: (url: string) => boolean, opener: Opener, images: ImageLoader, drafts: Pick<DraftStore, 'keep' | 'load'>): { dispose(): void } {
  const windows = new Map<number, Map<number, Served>>()
  const trusted = ({ senderFrame }: IpcEvent) => senderFrame !== null && senderFrame.parent === null && isAppUrl(senderFrame.url)

  const stopWindow = (windowId: number) => {
    for (const served of windows.get(windowId)?.values() ?? []) served.stop()
    windows.delete(windowId)
  }
  const subscriptionsOf = (sender: WindowSender) => {
    const held = windows.get(sender.id)
    if (held !== undefined) return held
    const created = new Map<number, Served>()
    windows.set(sender.id, created)
    sender.once('destroyed', () => stopWindow(sender.id))
    return created
  }

  ipc.on(CHANNEL.watch, (event, id, raw) => {
    const topic = parseTopic(raw)
    if (!trusted(event) || topic === null || typeof id !== 'number') return
    const subscriptions = subscriptionsOf(event.sender)
    subscriptions.get(id)?.stop()
    subscriptions.set(id, serveTopic(topic, SOURCES[kindOf(topic)](owner, topic), push => {
      if (!event.sender.isDestroyed()) event.sender.send(CHANNEL.push, id, push)
    }))
  })
  ipc.on(CHANNEL.unwatch, (event, id) => {
    const subscriptions = windows.get(event.sender.id)
    if (typeof id !== 'number' || subscriptions === undefined) return
    subscriptions.get(id)?.stop()
    subscriptions.delete(id)
  })
  ipc.handle(CHANNEL.run, async (event, raw) => {
    const command = parseCommand(raw)
    return trusted(event) && command !== null ? owner.run(command) : REFUSED
  })

  ipc.handle(CHANNEL.file, async (event, raw) => {
    const request = parseFileRequest(raw)
    if (!trusted(event) || request === null) return FILE_REFUSED
    const watched = [...(windows.get(event.sender.id)?.values() ?? [])].find(served => served.topic === `session:${request.sessionId}`)
    const session = watched?.current() as Session | undefined
    const target = session === undefined ? null : openablePath(session, request.path)
    return target === null ? FILE_REFUSED : opener[request.action](target)
  })

  ipc.handle(CHANNEL.image, async (event, raw) => {
    const request = parseImageRequest(raw)
    if (!trusted(event) || request === null) return IMAGE_REFUSED
    const watched = request.kind === 'tool' ? [...(windows.get(event.sender.id)?.values() ?? [])].find(served => served.topic === `session:${request.sessionId}`) : undefined
    return images.load(request, { session: watched?.current() as Session | undefined, local: isLocal(owner.setup.get()) })
  })

  ipc.handle(CHANNEL.drafts, async event => (trusted(event) ? drafts.load() : []))
  ipc.on(CHANNEL.keepDraft, (event, raw) => {
    const draft = parseDraft(raw)
    if (trusted(event) && draft !== null) drafts.keep(draft)
  })

  return {
    dispose() {
      for (const windowId of [...windows.keys()]) stopWindow(windowId)
      ipc.removeAllListeners(CHANNEL.watch)
      ipc.removeAllListeners(CHANNEL.unwatch)
      ipc.removeHandler(CHANNEL.run)
      ipc.removeHandler(CHANNEL.file)
      ipc.removeHandler(CHANNEL.image)
      ipc.removeHandler(CHANNEL.drafts)
      ipc.removeAllListeners(CHANNEL.keepDraft)
    }
  }
}
