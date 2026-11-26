import type { Hermes } from '@highwing/hermes'
import { onThisComputer, type BotId, type CommandOutcome, type Session, type SessionId } from '@highwing/hermes/domain'
import {
  CHANNEL, isAppTopic, isPreviewCommand, MAX_ATTACHMENTS, parseBotId, parseCommand, parseDraft, parseDropped, parseFileRequest, parseImageRequest, parseTopic,
  type AppTopic, type FileAction, type FileOutcome, type ImageOutcome, type ImageType, type PictureChoice, type PictureFile, type Push, type SessionPatch, type Setup, type StageResult,
  type Tail, type Topic
} from '../ipc-contract'
import { basename } from 'node:path'
import type { AttachmentStore, AttachSources, StageSource } from './attachments'
import type { ConnectionOwner } from './connection'
import type { DraftStore } from './drafts'
import { openablePath, type Opener } from './files'
import type { ImageLoader } from './images'
import type { ModeStore } from './mode'
import type { PreviewPane } from './preview'
import type { Saver } from './saves'

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

/** The pane's side of a window: its topic, its commands, and the files a window previews. */
export type PreviewOwner = Pick<PreviewPane, 'preview' | 'show' | 'run'>
export type ModeOwner = Pick<ModeStore, 'mode' | 'set'>
interface Owners { readonly owner: ConnectionOwner; readonly pane: PreviewOwner; readonly mode: ModeOwner }

/** A Hermes topic is bound to the connection that is live when the window asks. A window that sees a new epoch asks again. */
const onHermes = (source: (hermes: Hermes, topic: Topic) => Source) => ({ owner }: Owners, topic: Topic): Source =>
  owner.hermes === null ? NEVER : source(owner.hermes, topic)

const SOURCES: { readonly [K in Kind]: (owners: Owners, topic: Topic) => Source } = {
  setup: ({ owner }) => current(owner.setup),
  preview: ({ pane }) => current(pane.preview),
  mode: ({ mode }) => current(mode.mode),
  link: onHermes(hermes => current(hermes.link)),
  sidebar: onHermes(hermes => current(hermes.sidebar)),
  slash: onHermes(hermes => current(hermes.slash)),
  bots: onHermes(hermes => current(hermes.bots)),
  open: onHermes(hermes => current(hermes.open)),
  relay: onHermes(hermes => current(hermes.relay)),
  groups: onHermes(hermes => current(hermes.groups)),
  session: onHermes((hermes, topic) => listener => hermes.watch(topic.slice('session:'.length) as SessionId, listener))
}
const kindOf = (topic: Topic): Kind => (isAppTopic(topic) ? topic : 'session')

function tail<T>(pushed: readonly T[], next: readonly T[]): Tail<T> {
  let from = 0
  while (from < pushed.length && from < next.length && pushed[from] === next[from]) from++
  return { from, items: next.slice(from) }
}

export function sessionPatch(pushed: Session, next: Session): SessionPatch {
  const { history, run, ...fields } = next
  const changed = Object.fromEntries(Object.entries(fields).filter(([key, value]) => pushed[key as keyof Session] !== value)) as SessionPatch['changed']
  if (run.state === 'idle') return { changed, history: tail(pushed.history, history), run }
  const { turn: { items, ...turn }, ...head } = run
  return { changed, history: tail(pushed.history, history), run: { state: 'running', head, turn, items: tail(pushed.run.state === 'running' ? pushed.run.turn.items : [], items) } }
}

interface Served {
  readonly topic: Topic
  readonly servedBy: Hermes | null
  current(): unknown
  stop(): void
}

function serveTopic(topic: Topic, servedBy: Hermes | null, source: Source, send: (push: Push) => void): Served {
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
    servedBy,
    current: () => latest,
    stop() {
      stop()
      if (cooling !== null) clearTimeout(cooling)
    }
  }
}

const DONE: CommandOutcome<void> = { ok: true, value: undefined }
const REFUSED: CommandOutcome<never> = { ok: false, refusal: { kind: 'rejected', message: 'Highwing refused a malformed request from its window.' } }
const NOT_SAVED: CommandOutcome<never> = { ok: false, refusal: { kind: 'rejected', message: "Highwing couldn't write the file." } }
const FILE_REFUSED: FileOutcome = { ok: false, reason: 'refused' }
const FILE_DONE: FileOutcome = { ok: true }
const IMAGE_REFUSED: ImageOutcome = { ok: false }

const isLocal = (setup: Setup) => setup.at === 'pinned' || (setup.live !== null && onThisComputer(setup.live.target))

type FileActions = { readonly [A in FileAction]: (session: Session, path: string) => Promise<FileOutcome> }

/** Each action takes the path as the window named it. Only a path a finished step of the session named goes anywhere. */
function fileActions(opener: Opener, pane: PreviewOwner): FileActions {
  const named = (act: (path: string) => Promise<FileOutcome>) => async (session: Session, path: string) => {
    const target = openablePath(session, path)
    return target === null ? FILE_REFUSED : act(target)
  }
  return {
    open: named(path => opener.open(path)),
    show: named(path => opener.show(path)),
    preview: async (session, path) => (pane.show(path, null, session) ? FILE_DONE : FILE_REFUSED)
  }
}

export interface Attaching { readonly store: Pick<AttachmentStore, 'stage' | 'read'>; readonly sources: AttachSources }

export interface Pictures {
  pick(bot: BotId): Promise<CommandOutcome<PictureChoice>>
  choose(): Promise<CommandOutcome<PictureFile>>
}

export function serveWindows(
  owner: ConnectionOwner, ipc: IpcMainLike, isAppUrl: (url: string) => boolean, opener: Opener, images: ImageLoader, drafts: Pick<DraftStore, 'keep' | 'load'>,
  pane: PreviewOwner, pictures: Pictures, attaching: Attaching,
  saver: Saver, mode: ModeOwner
): { dispose(): void } {
  const windows = new Map<number, Map<number, Served>>()
  const owners: Owners = { owner, pane, mode }
  const files = fileActions(opener, pane)
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
    subscriptions.set(id, serveTopic(topic, owner.hermes, SOURCES[kindOf(topic)](owners, topic), push => {
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
    if (!trusted(event) || command === null) return REFUSED
    if (isPreviewCommand(command)) return pane.run(command)
    if (command.do === 'setMode') {
      mode.set(command.mode)
      return DONE
    }
    if (command.do !== 'export') return owner.run(command)
    const rendered = await owner.run(command)
    if (!rendered.ok) return rendered
    return saver.save(rendered.value).then(path => ({ ok: true, value: path }), () => NOT_SAVED)
  })

  ipc.handle(CHANNEL.file, async (event, raw) => {
    const request = parseFileRequest(raw)
    if (!trusted(event) || request === null) return FILE_REFUSED
    const watched = [...(windows.get(event.sender.id)?.values() ?? [])].find(served => served.topic === `session:${request.sessionId}`)
    const session = watched?.current() as Session | undefined
    return session === undefined ? FILE_REFUSED : files[request.action](session, request.path)
  })

  ipc.handle(CHANNEL.image, async (event, raw) => {
    const request = parseImageRequest(raw)
    if (!trusted(event) || request === null) return IMAGE_REFUSED
    if (request.kind === 'attachment') {
      const held = await attaching.store.read(request.id)
      return held?.kind === 'image' ? { ok: true, type: held.mime as ImageType, bytes: held.bytes } : IMAGE_REFUSED
    }
    const watched = request.kind === 'tool' ? [...(windows.get(event.sender.id)?.values() ?? [])].find(served => served.topic === `session:${request.sessionId}`) : undefined
    return images.load(request, { session: watched?.current() as Session | undefined, local: watched !== undefined && watched.servedBy === owner.hermes && isLocal(owner.setup.get()) })
  })

  ipc.handle(CHANNEL.drafts, async event => (trusted(event) ? drafts.load() : []))
  ipc.on(CHANNEL.keepDraft, (event, raw) => {
    const draft = parseDraft(raw)
    if (trusted(event) && draft !== null) drafts.keep(draft)
  })

  ipc.handle(CHANNEL.pickPicture, async (event, raw) => {
    const bot = parseBotId(raw)
    return trusted(event) && bot !== null ? pictures.pick(bot) : REFUSED
  })
  ipc.handle(CHANNEL.choosePicture, async event => (trusted(event) ? pictures.choose() : REFUSED))

  const { store, sources } = attaching
  const notHere = (name: string): StageResult => ({ ok: false, name, reason: `${name} isn't a file on this computer, so Highwing can't attach it.` })
  const nameOf = (file: StageSource | StageResult) => (typeof file === 'string' ? basename(file) : 'ok' in file ? (file.ok ? file.attachment.name : file.name) : file.name)
  const overCap = (name: string): StageResult => ({ ok: false, name, reason: `A message holds up to ${MAX_ATTACHMENTS} attachments, so ${name} wasn't attached.` })
  const stageOneByOne = async (files: readonly (StageSource | StageResult)[]): Promise<readonly StageResult[]> => {
    const results: StageResult[] = []
    for (const [index, file] of files.entries()) {
      if (index >= MAX_ATTACHMENTS) results.push(overCap(nameOf(file)))
      else results.push(typeof file === 'object' && 'ok' in file ? file : await store.stage(file))
    }
    return results
  }
  ipc.handle(CHANNEL.attachPick, async event => (trusted(event) ? stageOneByOne(await sources.pick()) : []))
  ipc.handle(CHANNEL.attachPaste, async event => {
    const pasted = trusted(event) ? await sources.pasted() : null
    return pasted === null ? [] : stageOneByOne([pasted])
  })
  ipc.handle(CHANNEL.attachDrop, async (event, raw) => {
    const dropped = parseDropped(raw)
    return trusted(event) && dropped !== null ? stageOneByOne(dropped.map(({ name, path }) => path ?? notHere(name))) : []
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
      ipc.removeHandler(CHANNEL.pickPicture)
      ipc.removeHandler(CHANNEL.choosePicture)
      ipc.removeHandler(CHANNEL.attachPick)
      ipc.removeHandler(CHANNEL.attachPaste)
      ipc.removeHandler(CHANNEL.attachDrop)
    }
  }
}
