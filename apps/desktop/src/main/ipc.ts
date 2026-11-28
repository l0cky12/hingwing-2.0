import type { Hermes } from '@highwing/hermes'
import { isTaskId, type BotId, type CommandOutcome, type Session, type SessionId } from '@highwing/hermes/domain'
import {
  CHANNEL, epochOf, isAppTopic, isLibraryCommand, isLocal, OTHER_CONNECTION, isPreviewCommand, isSetupCommand, MAX_ATTACHMENTS, parseBotId, parseCommand, parseDraft, parseDropped, parseFileRequest, parseImageRequest, parseRecording, parseRoutineId, parseTopic,
  type Accent, type AppTopic, type FileAction, type FileOutcome, type ImageOutcome, type ImageType, type Mode, type Notices, type OnClose, type PictureChoice, type PictureFile, type Push, type SessionPatch, type StageResult,
  type SendKey, type ShowWork, type SidebarWidth, type Snoozes, type Tail, type Theme, type Topic
} from '../ipc-contract'
import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Appearance } from '../appearance'
import type { AttachmentStore, AttachSources, StageSource } from './attachments'
import type { ConnectionOwner } from './connection'
import type { IntroOwner } from './intro'
import type { LibraryOwner } from './library'
import type { PluginCatalog } from './plugin-catalog'
import type { DraftStore } from './drafts'
import { openablePath, type Opener } from './files'
import { stepsOf } from './preview-page'
import type { ImageLoader } from './images'
import { snoozed, type PreferenceStore } from './preferences'
import type { PreviewPane } from './preview'
import { savedAs, type Saver } from './saves'
import { readRoutineRuns } from './routine-runs'
import { readBotMemory } from './memory'
import { readTaskBoard, readTaskChat } from './tasks'

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
type Shown<T> = Pick<PreferenceStore<T>, 'get' | 'subscribe' | 'set'>
export interface Preferences { readonly mode: Shown<Mode>; readonly theme: Shown<Theme>; readonly accent: Shown<Accent>; readonly sidebarWidth: Shown<SidebarWidth>; readonly sendKey: Shown<SendKey>; readonly showWork: Shown<ShowWork>; readonly spellCheck: Shown<boolean>; readonly snoozes: Shown<Snoozes>; readonly notices: Shown<Notices>; readonly onClose: Shown<OnClose>; readonly appearance: Shown<Appearance> }
interface Owners { readonly owner: ConnectionOwner; readonly pane: PreviewOwner; readonly preferences: Preferences; readonly intro: Pick<IntroOwner, 'intro'> }

/** A Hermes topic is bound to the connection that is live when the window asks. A window that sees a new epoch asks again. */
const onHermes = (source: (hermes: Hermes, topic: Topic) => Source) => ({ owner }: Owners, topic: Topic): Source =>
  owner.hermes === null ? NEVER : source(owner.hermes, topic)

const SOURCES: { readonly [K in Kind]: (owners: Owners, topic: Topic) => Source } = {
  setup: ({ owner }) => current(owner.setup),
  servers: ({ owner }) => current(owner.servers),
  preview: ({ pane }) => current(pane.preview),
  mode: ({ preferences }) => current(preferences.mode),
  theme: ({ preferences }) => current(preferences.theme),
  accent: ({ preferences }) => current(preferences.accent),
  sidebarWidth: ({ preferences }) => current(preferences.sidebarWidth),
  sendKey: ({ preferences }) => current(preferences.sendKey),
  showWork: ({ preferences }) => current(preferences.showWork),
  spellCheck: ({ preferences }) => current(preferences.spellCheck),
  snoozes: ({ preferences }) => current(preferences.snoozes),
  notices: ({ preferences }) => current(preferences.notices),
  onClose: ({ preferences }) => current(preferences.onClose),
  appearance: ({ preferences }) => current(preferences.appearance),
  intro: ({ intro }) => current(intro.intro),
  link: onHermes(hermes => current(hermes.link)),
  about: onHermes(hermes => current(hermes.about)),
  sidebar: onHermes(hermes => current(hermes.sidebar)),
  slash: onHermes(hermes => current(hermes.slash)),
  bots: onHermes(hermes => current(hermes.bots)),
  open: onHermes(hermes => current(hermes.open)),
  relay: onHermes(hermes => current(hermes.relay)),
  groups: onHermes(hermes => current(hermes.groups)),
  groupChat: onHermes(hermes => current(hermes.groupChat)),
  activity: onHermes(hermes => current(hermes.activity)),
  screen: onHermes(hermes => current(hermes.screen)),
  skills: onHermes(hermes => listener => hermes.watchSkills(listener)),
  routines: onHermes(hermes => current(hermes.routines)),
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
const FILE_REFUSED: FileOutcome = { ok: false, reason: 'refused' }
const FILE_DONE: FileOutcome = { ok: true }
const IMAGE_REFUSED: ImageOutcome = { ok: false }

/** Whether the action reaches a file on the machine Hermes runs on, wherever that is. The pane reads a page there itself. */
const FAR_ACTIONS: { readonly [A in FileAction]: boolean } = { open: false, show: false, preview: false, page: true }

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
    preview: async (session, path) => (pane.show(path, null, stepsOf(session)) ? FILE_DONE : FILE_REFUSED),
    page: async (session, path) => (pane.show(path, null, stepsOf(session), 'page') ? FILE_DONE : FILE_REFUSED)
  }
}

export interface Attaching { readonly store: Pick<AttachmentStore, 'stage' | 'read'>; readonly sources: AttachSources }

export interface Pictures {
  /** `live`: whether the connection the window asked for is still live. It can change while the file picker is open. */
  pick(bot: BotId, live: () => boolean): Promise<CommandOutcome<PictureChoice>>
  choose(): Promise<CommandOutcome<PictureFile>>
}

export function serveWindows(
  owner: ConnectionOwner, ipc: IpcMainLike, isAppUrl: (url: string) => boolean, opener: Opener, images: ImageLoader, drafts: Pick<DraftStore, 'keep' | 'load'>,
  pane: PreviewOwner, pictures: Pictures, attaching: Attaching,
  saver: Saver, library: LibraryOwner, preferences: Preferences, intro: Pick<IntroOwner, 'intro' | 'apply'>, catalog: PluginCatalog
): { dispose(): void } {
  const windows = new Map<number, Map<number, Served>>()
  const owners: Owners = { owner, pane, preferences, intro }
  const files = fileActions(opener, pane)
  const trusted = ({ senderFrame }: IpcEvent) => senderFrame !== null && senderFrame.parent === null && isAppUrl(senderFrame.url)
  const servedLive = (served: Served | undefined) => served !== undefined && served.servedBy === owner.hermes
  const servedHere = (served: Served | undefined) => servedLive(served) && isLocal(owner.setup.get())

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
  ipc.handle(CHANNEL.run, async (event, raw, epoch) => {
    const command = parseCommand(raw)
    if (!trusted(event) || command === null) return REFUSED
    if (isPreviewCommand(command)) return pane.run(command)
    if (command.do === 'setMode') {
      preferences.mode.set(command.mode)
      return DONE
    }
    if (command.do === 'setTheme') {
      preferences.theme.set(command.theme)
      return DONE
    }
    if (command.do === 'setAccent') {
      preferences.accent.set(command.accent)
      return DONE
    }
    if (command.do === 'setSidebarWidth') {
      preferences.sidebarWidth.set(command.width)
      return DONE
    }
    if (command.do === 'setOnClose') {
      preferences.onClose.set(command.onClose)
      return DONE
    }
    if (command.do === 'setSendKey') {
      preferences.sendKey.set(command.sendKey)
      return DONE
    }
    if (command.do === 'setShowWork') {
      preferences.showWork.set(command.showWork)
      return DONE
    }
    if (command.do === 'setSpellCheck') {
      preferences.spellCheck.set(command.spellCheck)
      return DONE
    }
    if (command.do === 'setAppearance') {
      preferences.appearance.set(command.appearance)
      return DONE
    }
    if (command.do === 'snooze') {
      preferences.snoozes.set(snoozed(preferences.snoozes.get(), command, Date.now()))
      return DONE
    }
    if (command.do === 'setNotice') {
      preferences.notices.set({ ...preferences.notices.get(), [command.kind]: command.on })
      return DONE
    }
    if (command.do === 'examples' || command.do === 'done') {
      // Publishing the requests while the saved screen is still up would flash it. Leave first.
      if (command.do === 'examples' && intro.intro.get().at === 'due') {
        const setup = owner.setup.get()
        if (setup.at === 'saved' && setup.from === 'first-run') {
          const outcome = await owner.run({ do: 'keepTarget' })
          if (!outcome.ok) return outcome
        }
      }
      await intro.apply(command)
      return DONE
    }
    if (command.do === 'pluginCatalog') return catalog.read()
    if (!isSetupCommand(command) && epoch !== epochOf(owner.setup.get())) return OTHER_CONNECTION
    if (isLibraryCommand(command)) return library.run(command, () => epoch === epochOf(owner.setup.get()))
    if (command.do !== 'export') return owner.run(command)
    const rendered = await owner.run(command)
    if (!rendered.ok) return rendered
    const { filename, content } = rendered.value
    return savedAs(saver.save(filename, to => writeFile(to, content)))
  })

  ipc.handle(CHANNEL.file, async (event, raw) => {
    const request = parseFileRequest(raw)
    if (!trusted(event) || request === null) return FILE_REFUSED
    const watched = [...(windows.get(event.sender.id)?.values() ?? [])].find(served => served.topic === `session:${request.sessionId}`)
    const session = watched?.current() as Session | undefined
    return session === undefined || !(FAR_ACTIONS[request.action] ? servedLive : servedHere)(watched) ? FILE_REFUSED : files[request.action](session, request.path)
  })

  ipc.handle(CHANNEL.image, async (event, raw) => {
    const request = parseImageRequest(raw)
    if (!trusted(event) || request === null) return IMAGE_REFUSED
    if (request.kind === 'attachment') {
      const held = await attaching.store.read(request.id)
      return held?.kind === 'image' ? { ok: true, type: held.mime as ImageType, bytes: held.bytes } : IMAGE_REFUSED
    }
    const watched = request.kind === 'tool' ? [...(windows.get(event.sender.id)?.values() ?? [])].find(served => served.topic === `session:${request.sessionId}`) : undefined
    return images.load(request, { session: watched?.current() as Session | undefined, local: servedHere(watched) })
  })

  ipc.handle(CHANNEL.taskBoard, async event => (trusted(event) ? readTaskBoard(owner.read) : REFUSED))
  ipc.handle(CHANNEL.taskChat, async (event, id) => (trusted(event) && isTaskId(id) ? readTaskChat(owner.read, id) : REFUSED))

  ipc.handle(CHANNEL.routineRuns, async (event, bot, routine) => {
    const named = parseBotId(bot)
    const id = parseRoutineId(routine)
    return trusted(event) && named !== null && id !== null ? readRoutineRuns(owner.read, named, id) : REFUSED
  })

  ipc.handle(CHANNEL.botMemory, async (event, raw) => {
    const bot = parseBotId(raw)
    return trusted(event) && bot !== null ? readBotMemory(owner.read, bot) : REFUSED
  })

  ipc.handle(CHANNEL.drafts, async event => (trusted(event) ? drafts.load() : []))
  ipc.on(CHANNEL.keepDraft, (event, raw) => {
    const draft = parseDraft(raw)
    if (trusted(event) && draft !== null) drafts.keep(draft)
  })

  ipc.handle(CHANNEL.pickPicture, async (event, raw, epoch) => {
    const bot = parseBotId(raw)
    if (!trusted(event) || bot === null) return REFUSED
    const live = () => epoch === epochOf(owner.setup.get())
    return live() ? pictures.pick(bot, live) : OTHER_CONNECTION
  })
  ipc.handle(CHANNEL.choosePicture, async event => (trusted(event) ? pictures.choose() : REFUSED))
  ipc.handle(CHANNEL.transcribe, async (event, raw, epoch) => {
    const recording = parseRecording(raw)
    if (!trusted(event) || recording === null) return REFUSED
    return epoch === epochOf(owner.setup.get()) ? owner.transcribe(recording) : OTHER_CONNECTION
  })

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
      ipc.removeHandler(CHANNEL.taskBoard)
      ipc.removeHandler(CHANNEL.taskChat)
      ipc.removeHandler(CHANNEL.routineRuns)
      ipc.removeHandler(CHANNEL.botMemory)
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
