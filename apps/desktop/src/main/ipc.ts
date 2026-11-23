import type { Hermes } from '@highwing/hermes'
import type { CommandOutcome, Session, SessionId } from '@highwing/hermes/domain'
import { CHANNEL, parseCommand, parseTopic, type Push, type SessionPatch, type Tail, type Topic } from '../ipc-contract'

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

const feedSource = <T>(feed: { get(): T; subscribe(listener: (value: T) => void): () => void }): Source => listener => {
  listener(feed.get())
  return feed.subscribe(listener)
}

const SOURCES: { readonly [K in 'link' | 'sidebar' | 'slash' | 'session']: (hermes: Hermes, topic: Topic) => Source } = {
  link: hermes => feedSource(hermes.link),
  sidebar: hermes => feedSource(hermes.sidebar),
  slash: hermes => feedSource(hermes.slash),
  session: (hermes, topic) => listener => hermes.watch(topic.slice('session:'.length) as SessionId, listener)
}
const kindOf = (topic: Topic) => (topic === 'link' || topic === 'sidebar' || topic === 'slash' ? topic : 'session')

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

function serveTopic(topic: Topic, source: Source, send: (push: Push) => void): () => void {
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
  return () => {
    stop()
    if (cooling !== null) clearTimeout(cooling)
  }
}

const REFUSED: CommandOutcome<never> = { ok: false, refusal: { kind: 'rejected', message: 'Highwing refused a malformed request from its window.' } }

export function serveWindows(hermes: Hermes, ipc: IpcMainLike, isAppUrl: (url: string) => boolean): { dispose(): void } {
  const windows = new Map<number, Map<number, () => void>>()
  const trusted = ({ senderFrame }: IpcEvent) => senderFrame !== null && senderFrame.parent === null && isAppUrl(senderFrame.url)

  const stopWindow = (windowId: number) => {
    for (const stop of windows.get(windowId)?.values() ?? []) stop()
    windows.delete(windowId)
  }
  const subscriptionsOf = (sender: WindowSender) => {
    const held = windows.get(sender.id)
    if (held !== undefined) return held
    const created = new Map<number, () => void>()
    windows.set(sender.id, created)
    sender.once('destroyed', () => stopWindow(sender.id))
    return created
  }

  ipc.on(CHANNEL.watch, (event, id, raw) => {
    const topic = parseTopic(raw)
    if (!trusted(event) || topic === null || typeof id !== 'number') return
    const subscriptions = subscriptionsOf(event.sender)
    subscriptions.get(id)?.()
    subscriptions.set(id, serveTopic(topic, SOURCES[kindOf(topic)](hermes, topic), push => {
      if (!event.sender.isDestroyed()) event.sender.send(CHANNEL.push, id, push)
    }))
  })
  ipc.on(CHANNEL.unwatch, (event, id) => {
    const subscriptions = windows.get(event.sender.id)
    if (typeof id !== 'number' || subscriptions === undefined) return
    subscriptions.get(id)?.()
    subscriptions.delete(id)
  })
  ipc.handle(CHANNEL.run, async (event, raw) => {
    const command = parseCommand(raw)
    return trusted(event) && command !== null ? hermes.run(command) : REFUSED
  })

  return {
    dispose() {
      for (const windowId of [...windows.keys()]) stopWindow(windowId)
      ipc.removeAllListeners(CHANNEL.watch)
      ipc.removeAllListeners(CHANNEL.unwatch)
      ipc.removeHandler(CHANNEL.run)
    }
  }
}
