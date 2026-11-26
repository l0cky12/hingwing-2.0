import {
  APPROVAL_MODES, BOT_MARKS, EFFORTS, EXPORT_FORMATS, GROUP_NAME_MAX, GROUP_SIZE, isGroupId, isPetSlug, PICTURE_MAX_BYTES, pictureDataUrlOf, PLAIN_CONTROLS, targetOf,
  type AdmissionId, type Attachment, type AttachmentId, type BotDraft, type BotEdit, type BotId, type BotMark, type Bots, type BranchId, type BusyMode, type ChatRef,
  type CheckpointId, type CheckStep, type Command, type CommandOutcome, type ControlAction, type GroupChat, type GroupDraft, type GroupId, type Groups, type HelperId, type Item, type Link, type ModelOption,
  type OpenChat, type OpenTurn, type ProcessId, type PromptId, type PromptReply, type QueuedAction, type RelayDesk, type RequestId, type RequestReply,
  type RestoreScope, type ResultOf, type Session, type SessionId, type SettledTurn, type SetupFailure, type Sidebar, type SlashCatalog, type Target, type TurnId, type Unstarted
} from '@highwing/hermes/domain'

/** The connection a window is talking through. A new `epoch` means a new connection, so a window drops what it held from the old one. */
export interface Live { readonly target: Target; readonly epoch: number }

/**
 * Which screen a window shows, and what that screen needs. Owned by Electron main. `live` is the
 * connection the chat keeps while the setup screen is open, or null before the first one is saved.
 */
export type Setup =
  | { readonly at: 'chat'; readonly live: Live }
  | { readonly at: 'form'; readonly live: Live | null; readonly notice: 'unreadable' | 'newer' | null }
  | { readonly at: 'checking'; readonly live: Live | null; readonly target: Target; readonly step: CheckStep }
  | { readonly at: 'failed'; readonly live: Live | null; readonly target: Target; readonly failure: SetupFailure }
  /** A check passed and `live` is its target. `from`: `first-run` when nothing was live before, which shows the first run's Saved screen, or `settings`, which keeps Settings open. */
  | { readonly at: 'saved'; readonly live: Live; readonly from: 'first-run' | 'settings' }
  /** `HIGHWING_FIXTURE` plays a recorded gateway. There is nothing to set up. */
  | { readonly at: 'pinned' }

/** The epoch of the connection `setup` keeps the chat on. 0 when it keeps none, as on a first run or in a fixture run. */
export const epochOf = (setup: Setup): number => (setup.at === 'pinned' || setup.live === null ? 0 : setup.live.epoch)
/** Main's answer to a command the screen it is on has no use for, such as an open while a new connection is saved. Nothing went to Hermes. */
export const NOT_NOW: CommandOutcome<never> = { ok: false, refusal: { kind: 'rejected', message: "Highwing can't do that from this screen." } }
/** Main's answer to a chat command a window sent for a connection that is no longer live. Nothing went to Hermes. */
export const OTHER_CONNECTION: CommandOutcome<never> = { ok: false, refusal: { kind: 'stale', message: "Highwing switched to another Hermes, so it didn't send that." } }

/** Whether `setup` is Settings: opened from a chat, shown in the chat's place beside the sidebar. First run and its Saved screen show no chat. */
export const showsSettings = (setup: Setup): boolean =>
  setup.at !== 'chat' && setup.at !== 'pinned' && setup.live !== null && !(setup.at === 'saved' && setup.from === 'first-run')

export type SetupCommand =
  /** Check a target and, when it passes, save it and connect to it. */
  | { readonly do: 'checkTarget'; readonly target: Target }
  /** Open Settings over the chat. */
  | { readonly do: 'editTarget' }
  /** Leave setup for the chat on the live connection, aborting any running check. Close, Esc and Open chat send it, and main applies it before an open from Settings. With no live connection it is a first run's Stop waiting, which ends the wait for a sign-in as a failure. Refused while the check writes its target to disk. */
  | { readonly do: 'keepTarget' }
  /** Abort the running check, or drop the failed one, and stay in Settings on the form. Cancel sends it. Refused while the check writes its target to disk. */
  | { readonly do: 'stopCheck' }

const SETUP_VERBS: { readonly [K in SetupCommand['do']]: true } = { checkTarget: true, editTarget: true, keepTarget: true, stopCheck: true }
export const isSetupCommand = (command: AppCommand): command is SetupCommand => Object.hasOwn(SETUP_VERBS, command.do)

/** How a page main draws in its own view is doing. `failed` hides the view, so the window shows the reason in its place. */
export type PageLoad = { readonly at: 'loading' } | { readonly at: 'shown' } | { readonly at: 'failed'; readonly reason: string }

/** A CSV file's records. The first is the header. `rows` is the first few after it, and `total` counts all of them. */
export interface Table { readonly header: readonly string[]; readonly rows: readonly (readonly string[])[]; readonly total: number }

/** What the pane shows. One kind per body the window draws. */
export type PreviewContent = { readonly kind: 'page'; readonly load: PageLoad } | { readonly kind: 'table'; readonly table: Table }

/**
 * The pane beside the chat. Owned by Electron main, one per window, and kept across chats.
 * `address` is the web URL or the absolute path shown. `title` is Hermes's label, else the page's own title, else the address
 * or the file's name. `file`: a file on this computer, which the user's own program can open.
 * `layout`: `full` fills the window with the page and keeps the chat as a side panel, as a page card's Open asks.
 */
export type Preview =
  | { readonly state: 'closed' }
  | { readonly state: 'open'; readonly title: string; readonly address: string; readonly file: boolean; readonly layout: PaneLayout; readonly content: PreviewContent }

export type PaneLayout = 'beside' | 'full'

export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export type PreviewCommand =
  | { readonly do: 'preview'; readonly url: string }
  | { readonly do: 'browse'; readonly url: string }
  | { readonly do: 'reloadPreview' }
  | { readonly do: 'closePreview' }
  | { readonly do: 'openPreview' }
  /** Where the page's body sits in the window, in CSS pixels. null: nowhere to draw it, so main hides the page. */
  | { readonly do: 'placePreview'; readonly rect: Rect | null }

const PREVIEW_VERBS: { readonly [K in PreviewCommand['do']]: true } = { preview: true, browse: true, reloadPreview: true, closePreview: true, openPreview: true, placePreview: true }
export const isPreviewCommand = (command: AppCommand): command is PreviewCommand => Object.hasOwn(PREVIEW_VERBS, command.do)

/** Which column sits left of the chat: the bots, or the open bot's chats in the bots' place. Owned by Electron main and kept on disk. */
export type Mode = 'bots' | 'chats'
export type ModeCommand = { readonly do: 'setMode'; readonly mode: Mode }
export const isMode = (raw: unknown): raw is Mode => raw === 'bots' || raw === 'chats'

/** Which palette the window draws: the desktop's light or dark setting, or one the user fixed. Owned by Electron main and kept on disk. */
export type Theme = 'system' | 'light' | 'dark'
export type ThemeCommand = { readonly do: 'setTheme'; readonly theme: Theme }
export const isTheme = (raw: unknown): raw is Theme => raw === 'system' || raw === 'light' || raw === 'dark'

/** The chats the user snoozed, each to the time it comes back, in epoch ms. Owned by Electron main and kept on disk. */
export type Snoozes = { readonly [id: SessionId]: number }
/** `until` null wakes the chat. */
export type SnoozeCommand = { readonly do: 'snooze'; readonly sessionId: SessionId; readonly until: number | null }
const isTime = (raw: unknown): raw is number => Number.isSafeInteger(raw) && (raw as number) > 0
export const isSnoozes = (raw: unknown): raw is Snoozes => isObject(raw) && Object.entries(raw).every(([id, until]) => id.trim() !== '' && isTime(until))

export type AppCommand = Command | SetupCommand | PreviewCommand | ModeCommand | ThemeCommand | SnoozeCommand
export type WindowCommand = Exclude<AppCommand, { readonly do: 'setBotPicture' | 'refreshBots' }>
export type HubResult<C extends AppCommand> = C extends Command ? ResultOf<C> : void
export type AppResult<C extends AppCommand> = C extends { do: 'export' } ? string | null : HubResult<C>

/** Every topic and what it carries. Each has one value per connection, except `preview`, `mode`, `theme` and `snoozes`, which belong to the window. */
export interface AppTopics {
  readonly setup: Setup
  readonly link: Link
  readonly sidebar: Sidebar
  readonly slash: SlashCatalog
  readonly bots: Bots
  /** Which chat the window shows. A window keeps no copy of its own choice: it asks with `open` and draws this. */
  readonly open: OpenChat
  /** Whether Hermes can hand a message to another bot, and the messages handed over from each chat. */
  readonly relay: RelayDesk
  /** The group chats, who is answering in each, whether this Hermes can make one, and the bots it would seat. */
  readonly groups: Groups
  /** The group chat `open` shows, or null while it shows anything else. */
  readonly groupChat: GroupChat | null
  readonly preview: Preview
  readonly mode: Mode
  readonly theme: Theme
  readonly snoozes: Snoozes
}
export type AppTopic = keyof AppTopics

const APP_TOPICS: { readonly [T in AppTopic]: true } = { setup: true, link: true, sidebar: true, slash: true, bots: true, open: true, relay: true, groups: true, groupChat: true, preview: true, mode: true, theme: true, snoozes: true }

export const isAppTopic = (raw: unknown): raw is AppTopic => typeof raw === 'string' && Object.hasOwn(APP_TOPICS, raw)

export type Topic = AppTopic | `session:${SessionId}`
export type TopicValue<T extends Topic> = T extends AppTopic ? AppTopics[T] : Session

export interface Tail<T> { readonly from: number; readonly items: readonly T[] }

type Running = Extract<Session['run'], { state: 'running' }>
export interface SessionPatch {
  readonly changed: Partial<Omit<Session, 'history' | 'run'>>
  readonly history: Tail<SettledTurn>
  readonly run:
    | { readonly state: 'idle' }
    | { readonly state: 'running'; readonly head: Omit<Running, 'turn'>; readonly turn: Omit<OpenTurn, 'items'>; readonly items: Tail<Item> }
}

export type Push<T extends Topic = Topic> =
  | { readonly topic: T; readonly rev: number; readonly full: TopicValue<T> }
  | (T extends `session:${string}` ? { readonly topic: T; readonly rev: number; readonly patch: SessionPatch } : never)

/** `preview` shows the file in the pane beside the chat. `page` shows it full window under Hermes's label. */
export type FileAction = 'open' | 'show' | 'preview' | 'page'
export type FileRequest =
  | { readonly action: Exclude<FileAction, 'page'>; readonly sessionId: SessionId; readonly path: string }
  | { readonly action: 'page'; readonly sessionId: SessionId; readonly path: string; readonly label: string | null }
export type FileOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: 'refused' | 'missing' | 'failed' }

export type ImageRequest =
  | { readonly kind: 'web'; readonly url: string }
  | { readonly kind: 'tool'; readonly sessionId: SessionId; readonly path: string }
  /** An image attached to a message, while Highwing holds it. */
  | { readonly kind: 'attachment'; readonly id: AttachmentId }
export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/avif'
/** Every refusal looks the same to the window: the loader says nothing about why. */
export type ImageOutcome = { readonly ok: true; readonly type: ImageType; readonly bytes: Uint8Array } | { readonly ok: false }

/**
 * One place to type a message: a chat that has a session, a bot's unstarted chat, the one
 * new-chat view, or a group chat.
 */
export type DraftKey = `chat:${SessionId}` | `bot:${BotId}` | 'new' | `group:${GroupId}`
/** `bot` is the bot of the chat the draft was typed in, so it can be matched to that bot's list. Empty `text` and no attachments: no draft. */
export interface Draft { readonly key: DraftKey; readonly bot: BotId | null; readonly text: string; readonly attachments: readonly Attachment[] }

/** A file Highwing was asked to hold for a message: held, or refused with plain words that name it. */
export type StageResult = { readonly ok: true; readonly attachment: Attachment } | { readonly ok: false; readonly name: string; readonly reason: string }

/** A file dropped on the window: its path on this computer, or null for one that has none, such as an image dragged out of a web page. */
export interface DroppedFile { readonly name: string; readonly path: string | null }

/** More ids than a message could ever carry. Hermes takes 10 images, and a window has no reason to send more files than that. */
export const MAX_ATTACHMENTS = 64

/** `set`: the picture was sent and Hermes kept it. `cancelled`: the user closed the file picker, and nothing was sent. */
export type PictureChoice = 'set' | 'cancelled'
export type PictureFile = string | 'cancelled'

export interface Bridge {
  watch<T extends Topic>(topic: T, onPush: (push: Push<T>) => void): () => void
  /** `epoch`: the connection the window sent it for, which is `epochOf` the newest setup it has. Main refuses a chat command sent for any other. */
  run<C extends WindowCommand>(command: C, epoch: number): Promise<CommandOutcome<AppResult<C>>>
  file(request: FileRequest): Promise<FileOutcome>
  image(request: ImageRequest): Promise<ImageOutcome>
  drafts(): Promise<readonly Draft[]>
  /** Keeps the draft on disk, or deletes it when it is empty. Applied in the order a window sends them. */
  keepDraft(draft: Draft): void
  /** Main shows a file picker, checks the picked file and sends it as the bot's picture. `epoch` is as for `run`: main refuses a bot of an older connection. */
  pickBotPicture(bot: BotId, epoch: number): Promise<CommandOutcome<PictureChoice>>
  /** Main shows the same picker and checks the file the same way, and answers the picture. Nothing is sent to Hermes. */
  choosePicture(): Promise<CommandOutcome<PictureFile>>
  /** Opens the file dialog and holds each file picked, in the order picked. Nothing picked: an empty list. */
  attachPick(): Promise<readonly StageResult[]>
  /** Holds the image on the clipboard. No image there: an empty list. */
  attachPaste(): Promise<readonly StageResult[]>
  /** Holds the files of a drop. The window never names a path: the bridge reads it from each `File`. */
  attachDropped(files: readonly File[]): Promise<readonly StageResult[]>
}

export const CHANNEL = {
  watch: 'highwing:watch', unwatch: 'highwing:unwatch', push: 'highwing:push', run: 'highwing:run', file: 'highwing:file', image: 'highwing:image',
  drafts: 'highwing:drafts', keepDraft: 'highwing:keep-draft', pickPicture: 'highwing:pick-picture', choosePicture: 'highwing:choose-picture', attachPick: 'highwing:attach-pick',
  attachPaste: 'highwing:attach-paste', attachDrop: 'highwing:attach-drop'
} as const

const WEB_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:'])
const ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/
const PAGE_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:'])

/** The links a reply may open, in the user's browser. Shared so the renderer draws only links main will open. */
export const isWebLink = (url: string): boolean => WEB_SCHEMES.has(URL.parse(url)?.protocol ?? '')
/** A link the pane may show and Open in browser may open: http and https only. */
export const isWebPage = (url: string): boolean => PAGE_SCHEMES.has(URL.parse(url)?.protocol ?? '')

const splice = <T>(held: readonly T[], tail: Tail<T>): readonly T[] => [...held.slice(0, tail.from), ...tail.items]

export function applyPush<T extends Topic>(current: TopicValue<T> | undefined, currentRev: number, push: Push<T>): { readonly value: TopicValue<T>; readonly rev: number } | 'need-full' {
  if ('full' in push) return { value: push.full, rev: push.rev }
  if (current === undefined || push.rev !== currentRev + 1) return 'need-full'
  const held = current as Session
  const { changed, history, run } = push.patch
  const next: Session = {
    ...held,
    ...changed,
    history: splice(held.history, history),
    run: run.state === 'idle'
      ? run
      : { ...run.head, turn: { ...run.turn, items: splice(held.run.state === 'running' ? held.run.turn.items : [], run.items) } }
  }
  return { value: next as TopicValue<T>, rev: push.rev }
}

type Obj = { readonly [key: string]: unknown }
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string'
const filled = (value: unknown): value is string => text(value) && value.trim() !== ''
const sessionIdOf = (raw: Obj) => (filled(raw.sessionId) ? (raw.sessionId as SessionId) : null)
const botIdOf = (raw: unknown) => (filled(raw) ? (raw as BotId) : null)
const isBotMark = (raw: unknown): raw is BotMark => (BOT_MARKS as readonly unknown[]).includes(raw)
const modelOptionOf = (raw: unknown): ModelOption | null =>
  isObject(raw) && filled(raw.id) && filled(raw.provider) && text(raw.providerName)
    ? { id: raw.id as ModelOption['id'], provider: raw.provider, providerName: raw.providerName }
    : null
const draftOf = (raw: unknown): BotDraft | null => {
  if (!isObject(raw) || !filled(raw.name) || !text(raw.description) || !text(raw.persona)) return null
  const model = raw.model === null ? null : modelOptionOf(raw.model)
  return raw.model !== null && model === null ? null : { name: raw.name, description: raw.description, model, persona: raw.persona }
}
const editOf = (raw: unknown): BotEdit | null => {
  if (!isObject(raw)) return null
  const { name, description, persona } = raw
  if (!(name === undefined || filled(name)) || !(description === undefined || text(description)) || !(persona === undefined || text(persona))) return null
  const edit = { ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }), ...(persona === undefined ? {} : { persona }) }
  return Object.keys(edit).length > 0 ? edit : null
}
const groupDraftOf = (raw: unknown): GroupDraft | null => {
  if (!isObject(raw) || !isGroupId(raw.group) || !filled(raw.name) || raw.name.trim().length > GROUP_NAME_MAX || !Array.isArray(raw.bots)) return null
  const bots = raw.bots.map(botIdOf)
  const fits = bots.length >= GROUP_SIZE.min && bots.length <= GROUP_SIZE.max && new Set(bots).size === bots.length
  return fits && !bots.includes(null) ? { group: raw.group, name: raw.name.trim(), bots: bots as BotId[] } : null
}
const revisionOf = (raw: unknown): number | null | undefined =>
  raw === null ? null : Number.isInteger(raw) && (raw as number) >= 0 ? (raw as number) : undefined
const REFS: { readonly [K in ChatRef['kind']]: (raw: Obj) => Extract<ChatRef, { kind: K }> | null } = {
  bot: raw => {
    const bot = botIdOf(raw.bot)
    return bot && { kind: 'bot', bot }
  },
  new: raw => {
    if (!filled(raw.draftId)) return null
    if (raw.bot === null) return { kind: 'new', bot: null, draftId: raw.draftId }
    const bot = botIdOf(raw.bot)
    return bot && { kind: 'new', bot, draftId: raw.draftId }
  },
  chat: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && { kind: 'chat', sessionId }
  },
  link: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && { kind: 'link', sessionId }
  },
  group: raw => (isGroupId(raw.group) ? { kind: 'group', group: raw.group } : null)
}
const chatRefOf = (raw: unknown): ChatRef | null =>
  isObject(raw) && text(raw.kind) && Object.hasOwn(REFS, raw.kind) ? REFS[raw.kind as ChatRef['kind']](raw) : null
const unstartedOf = (raw: unknown): Unstarted | null => {
  const ref = isObject(raw) && raw.sessionId === null ? chatRefOf(raw) : null
  return ref?.kind === 'bot' || ref?.kind === 'new' ? { ...ref, sessionId: null } : null
}
const webPage = (raw: unknown): raw is string => text(raw) && isWebPage(raw)
const place = (raw: unknown): raw is number => typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
const rectOf = (raw: unknown): Rect | null =>
  isObject(raw) && place(raw.x) && place(raw.y) && place(raw.width) && place(raw.height) ? { x: raw.x, y: raw.y, width: raw.width, height: raw.height } : null
const attachmentIdsOf = (raw: unknown): readonly AttachmentId[] | null => {
  if (raw === undefined) return []
  return Array.isArray(raw) && raw.length <= MAX_ATTACHMENTS && raw.every(filled) ? (raw as AttachmentId[]) : null
}
const attachmentOf = (raw: unknown): Attachment | null =>
  isObject(raw) && filled(raw.id) && filled(raw.name) && (raw.kind === 'image' || raw.kind === 'file') && Number.isSafeInteger(raw.size) && (raw.size as number) >= 0
    ? { id: raw.id as AttachmentId, name: raw.name, kind: raw.kind, size: raw.size as number }
    : null
function replyOf(raw: unknown): PromptReply | null {
  if (!isObject(raw)) return null
  if (raw.kind === 'deny') return filled(raw.tell) ? { kind: 'deny', tell: raw.tell } : null
  return (raw.kind === 'choice' || raw.kind === 'text') && text(raw.value) ? { kind: raw.kind, value: raw.value } : null
}

const BUSY_MODES: readonly string[] = ['queue', 'steer', 'interrupt'] satisfies BusyMode[]
const ROW_ACTIONS: readonly string[] = ['cancel', 'sendNow', 'release'] satisfies Exclude<QueuedAction, 'edit'>[]

const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(text)
const valuesOf = (raw: unknown): { readonly [field: string]: string } | null => (isObject(raw) && Object.values(raw).every(text) ? raw as { readonly [field: string]: string } : null)

function requestReplyOf(raw: unknown): RequestReply | null {
  if (!isObject(raw)) return null
  switch (raw.kind) {
    case 'secret':
      if (!text(raw.value) || !(raw.identifier === undefined || text(raw.identifier))) return null
      return { kind: 'secret', value: raw.value, ...(raw.identifier === undefined ? {} : { identifier: raw.identifier }) }
    case 'lock':
      return filled(raw.question) && (raw.answer === null || texts(raw.answer)) ? { kind: 'lock', question: raw.question, answer: raw.answer } : null
    case 'skip':
      return { kind: 'skip' }
    case 'connect': {
      const values = raw.values === undefined ? undefined : valuesOf(raw.values)
      if (!filled(raw.target) || !(raw.as === 'approved' || raw.as === 'skipped') || values === null) return null
      return { kind: 'connect', target: raw.target, as: raw.as, ...(values === undefined ? {} : { values }) }
    }
    default:
      return null
  }
}

function controlActionOf(raw: unknown): ControlAction | null {
  if (!isObject(raw)) return null
  if (raw.act === 'subgoal.add') return filled(raw.text) ? { act: 'subgoal.add', text: raw.text } : null
  if (raw.act === 'subgoal.remove') return Number.isInteger(raw.index) && (raw.index as number) >= 1 ? { act: 'subgoal.remove', index: raw.index as number } : null
  const act = PLAIN_CONTROLS.find(held => held === raw.act)
  return act === undefined ? null : { act }
}

function restoreScopeOf(raw: unknown): RestoreScope | null {
  if (!isObject(raw)) return null
  if (raw.kind === 'file') return filled(raw.path) ? { kind: 'file', path: raw.path } : null
  return raw.kind === 'folder' && (raw.edits === 'keep' || raw.edits === 'overwrite') ? { kind: 'folder', edits: raw.edits } : null
}

type Validators = { readonly [K in WindowCommand['do']]: (raw: Obj) => Extract<WindowCommand, { do: K }> | null }

export const validators: Validators = {
  open: raw => {
    const ref = chatRefOf(raw.ref)
    if (raw.upFront === undefined) return ref && { do: 'open', ref }
    return raw.upFront === true && ref?.kind === 'new' && ref.bot !== null ? { do: 'open', ref: { kind: 'new', bot: ref.bot, draftId: ref.draftId }, upFront: true } : null
  },
  start: raw => {
    const chat = unstartedOf(raw.chat)
    const attachments = attachmentIdsOf(raw.attachments)
    return chat && attachments && filled(raw.text) ? { do: 'start', chat, text: raw.text, attachments } : null
  },
  send: raw => {
    const sessionId = sessionIdOf(raw)
    const attachments = attachmentIdsOf(raw.attachments)
    return sessionId && attachments && filled(raw.text) ? { do: 'send', sessionId, text: raw.text, attachments } : null
  },
  side: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && (raw.kind === 'btw' || raw.kind === 'background') && filled(raw.text) ? { do: 'side', sessionId, kind: raw.kind, text: raw.text } : null
  },
  move: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && filled(raw.cwd) ? { do: 'move', sessionId, cwd: raw.cwd } : null
  },
  compress: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && (raw.focus === null || filled(raw.focus)) ? { do: 'compress', sessionId, focus: raw.focus } : null
  },
  export: raw => {
    const sessionId = sessionIdOf(raw)
    const format = EXPORT_FORMATS.find(held => held === raw.format)
    return sessionId && format !== undefined ? { do: 'export', sessionId, format } : null
  },
  rewind: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && Number.isInteger(raw.rowId) && (raw.rowId as number) > 0 && filled(raw.text)
      ? { do: 'rewind', sessionId, rowId: raw.rowId as number, text: raw.text }
      : null
  },
  branch: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && Number.isInteger(raw.rowId) && (raw.rowId as number) > 0 && filled(raw.branchId)
      ? { do: 'branch', sessionId, rowId: raw.rowId as number, branchId: raw.branchId as BranchId }
      : null
  },
  versions: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && { do: 'versions', sessionId }
  },
  stop: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && { do: 'stop', sessionId }
  },
  answer: raw => {
    const sessionId = sessionIdOf(raw)
    if (sessionId === null) return null
    if (filled(raw.requestId)) {
      const reply = requestReplyOf(raw.reply)
      return reply && { do: 'answer', sessionId, requestId: raw.requestId as RequestId, reply }
    }
    const reply = replyOf(raw.reply)
    return filled(raw.promptId) && reply ? { do: 'answer', sessionId, promptId: raw.promptId as PromptId, reply } : null
  },
  discard: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && filled(raw.inputId) ? { do: 'discard', sessionId, inputId: raw.inputId as Extract<Command, { do: 'discard' }>['inputId'] } : null
  },
  queued: raw => {
    const sessionId = sessionIdOf(raw)
    if (!sessionId || !filled(raw.admissionId)) return null
    const row = { do: 'queued', sessionId, admissionId: raw.admissionId as AdmissionId } as const
    if (raw.action === 'edit') return filled(raw.text) ? { ...row, action: 'edit', text: raw.text } : null
    return text(raw.action) && ROW_ACTIONS.includes(raw.action) ? { ...row, action: raw.action as Exclude<QueuedAction, 'edit'> } : null
  },
  rename: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && filled(raw.title) ? { do: 'rename', sessionId, title: raw.title } : null
  },
  retitle: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && { do: 'retitle', sessionId }
  },
  archive: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && typeof raw.archived === 'boolean' ? { do: 'archive', sessionId, archived: raw.archived } : null
  },
  remove: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && { do: 'remove', sessionId }
  },
  pin: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && typeof raw.pinned === 'boolean' ? { do: 'pin', sessionId, pinned: raw.pinned } : null
  },
  loadEarlier: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && { do: 'loadEarlier', sessionId }
  },
  models: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && { do: 'models', sessionId }
  },
  pickModel: raw => {
    const sessionId = sessionIdOf(raw)
    const model = modelOptionOf(raw.model)
    if (!sessionId || !model || !(raw.confirm === undefined || filled(raw.confirm))) return null
    return { do: 'pickModel', sessionId, model, ...(raw.confirm === undefined ? {} : { confirm: raw.confirm }) }
  },
  completePath: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && typeof raw.word === 'string' && raw.word.startsWith('@') ? { do: 'completePath', sessionId, word: raw.word } : null
  },
  contextBreakdown: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && { do: 'contextBreakdown', sessionId }
  },
  createBot: raw => {
    const draft = draftOf(raw.draft)
    const picture = raw.picture === null ? null : pictureDataUrlOf(raw.picture, PICTURE_MAX_BYTES)
    return draft && (raw.picture === null || picture !== null) ? { do: 'createBot', draft, picture } : null
  },
  canGeneratePicture: () => ({ do: 'canGeneratePicture' }),
  generatePicture: raw => (filled(raw.prompt) ? { do: 'generatePicture', prompt: raw.prompt } : null),
  pets: () => ({ do: 'pets' }),
  petPicture: raw => (text(raw.slug) && isPetSlug(raw.slug) && (raw.url === null || webPage(raw.url)) ? { do: 'petPicture', slug: raw.slug, url: raw.url } : null),
  botModels: raw => {
    const bot = raw.bot === null ? null : botIdOf(raw.bot)
    return raw.bot !== null && bot === null ? null : { do: 'botModels', bot }
  },
  describeBot: raw => {
    const bot = botIdOf(raw.bot)
    return bot && { do: 'describeBot', bot }
  },
  editBot: raw => {
    const bot = botIdOf(raw.bot)
    const edit = editOf(raw.edit)
    const revision = revisionOf(raw.revision)
    return bot && edit && revision !== undefined ? { do: 'editBot', bot, edit, revision } : null
  },
  removeBotPicture: raw => {
    const bot = botIdOf(raw.bot)
    return bot && { do: 'removeBotPicture', bot }
  },
  botPicture: raw => {
    const bot = botIdOf(raw.bot)
    return bot && { do: 'botPicture', bot }
  },
  createGroup: raw => {
    const draft = groupDraftOf(raw.draft)
    return draft && { do: 'createGroup', draft }
  },
  markBot: raw => {
    const bot = botIdOf(raw.bot)
    return bot && isBotMark(raw.mark) ? { do: 'markBot', bot, mark: raw.mark } : null
  },
  sendToGroup: raw => (isGroupId(raw.group) && filled(raw.text) ? { do: 'sendToGroup', group: raw.group, text: raw.text } : null),
  stopGroup: raw => (isGroupId(raw.group) ? { do: 'stopGroup', group: raw.group } : null),
  tune: raw => {
    const sessionId = sessionIdOf(raw)
    if (!sessionId) return null
    if (raw.set === 'busy') return text(raw.to) && BUSY_MODES.includes(raw.to) ? { do: 'tune', sessionId, set: 'busy', to: raw.to as BusyMode } : null
    if (raw.set === 'effort') {
      const to = raw.to === 'default' ? 'default' : EFFORTS.find(level => level === raw.to)
      return to === undefined ? null : { do: 'tune', sessionId, set: 'effort', to }
    }
    if (raw.set === 'approvals') {
      const to = APPROVAL_MODES.find(mode => mode === raw.to)
      return to === undefined ? null : { do: 'tune', sessionId, set: 'approvals', to }
    }
    if (typeof raw.on !== 'boolean') return null
    switch (raw.set) {
      case 'reasoning':
        return { do: 'tune', sessionId, set: 'reasoning', on: raw.on }
      case 'yolo':
        return { do: 'tune', sessionId, set: 'yolo', on: raw.on }
      case 'fast':
        return { do: 'tune', sessionId, set: 'fast', on: raw.on }
      default:
        return null
    }
  },
  killProcess: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && filled(raw.processId) ? { do: 'killProcess', sessionId, processId: raw.processId as ProcessId } : null
  },
  stopHelper: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && filled(raw.helperId) ? { do: 'stopHelper', sessionId, helperId: raw.helperId as HelperId } : null
  },
  control: raw => {
    const sessionId = sessionIdOf(raw)
    const action = controlActionOf(raw.action)
    return sessionId && action && { do: 'control', sessionId, action }
  },
  checkpoints: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && { do: 'checkpoints', sessionId }
  },
  checkpointDiff: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && filled(raw.checkpoint) ? { do: 'checkpointDiff', sessionId, checkpoint: raw.checkpoint as CheckpointId } : null
  },
  restore: raw => {
    const sessionId = sessionIdOf(raw)
    const scope = restoreScopeOf(raw.scope)
    return sessionId && scope && filled(raw.checkpoint) ? { do: 'restore', sessionId, checkpoint: raw.checkpoint as CheckpointId, scope } : null
  },
  react: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && filled(raw.turn) && (raw.emoji === null || filled(raw.emoji)) ? { do: 'react', sessionId, turn: raw.turn as TurnId, emoji: raw.emoji } : null
  },
  reconnect: raw => (typeof raw.start === 'boolean' ? { do: 'reconnect', start: raw.start } : null),
  checkTarget: raw => {
    const target = targetOf(raw.target)
    return target && { do: 'checkTarget', target }
  },
  editTarget: () => ({ do: 'editTarget' }),
  keepTarget: () => ({ do: 'keepTarget' }),
  stopCheck: () => ({ do: 'stopCheck' }),
  preview: raw => (webPage(raw.url) ? { do: 'preview', url: raw.url } : null),
  browse: raw => (webPage(raw.url) ? { do: 'browse', url: raw.url } : null),
  reloadPreview: () => ({ do: 'reloadPreview' }),
  closePreview: () => ({ do: 'closePreview' }),
  openPreview: () => ({ do: 'openPreview' }),
  placePreview: raw => {
    if (raw.rect === null) return { do: 'placePreview', rect: null }
    const rect = rectOf(raw.rect)
    return rect && { do: 'placePreview', rect }
  },
  setMode: raw => (isMode(raw.mode) ? { do: 'setMode', mode: raw.mode } : null),
  setTheme: raw => (isTheme(raw.theme) ? { do: 'setTheme', theme: raw.theme } : null),
  snooze: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && (raw.until === null || isTime(raw.until)) ? { do: 'snooze', sessionId, until: raw.until } : null
  }
}

export function parseCommand(raw: unknown): WindowCommand | null {
  if (!isObject(raw) || !text(raw.do) || !Object.hasOwn(validators, raw.do)) return null
  return (validators[raw.do as WindowCommand['do']] as (raw: Obj) => WindowCommand | null)(raw)
}

export const parseBotId = botIdOf

export function parseFileRequest(raw: unknown): FileRequest | null {
  if (!isObject(raw) || (raw.action !== 'open' && raw.action !== 'show' && raw.action !== 'preview' && raw.action !== 'page')) return null
  const sessionId = sessionIdOf(raw)
  if (!sessionId || !filled(raw.path)) return null
  if (raw.action !== 'page') return { action: raw.action, sessionId, path: raw.path }
  return raw.label === null || typeof raw.label === 'string' ? { action: raw.action, sessionId, path: raw.path, label: raw.label } : null
}

const DRAFT_KINDS: { readonly [K in Exclude<DraftKey, 'new'> extends `${infer Kind}:${string}` ? Kind : never]: true } = { chat: true, bot: true, group: true }
const draftKeyOf = (raw: unknown): DraftKey | null => {
  if (raw === 'new') return raw
  if (!text(raw)) return null
  const colon = raw.indexOf(':')
  return colon > 0 && Object.hasOwn(DRAFT_KINDS, raw.slice(0, colon)) && filled(raw.slice(colon + 1)) ? (raw as DraftKey) : null
}

/** `attachments` may be missing, as in a draft an earlier build wrote. */
export function parseDraft(raw: unknown): Draft | null {
  if (!isObject(raw) || !text(raw.text) || !(raw.bot === null || filled(raw.bot))) return null
  const key = draftKeyOf(raw.key)
  const held = raw.attachments === undefined ? [] : Array.isArray(raw.attachments) && raw.attachments.length <= MAX_ATTACHMENTS ? raw.attachments.map(attachmentOf) : null
  if (held === null || held.includes(null)) return null
  return key && { key, bot: botIdOf(raw.bot), text: raw.text, attachments: held as Attachment[] }
}

export const isEmptyDraft = (draft: Pick<Draft, 'text' | 'attachments'>) => draft.text === '' && draft.attachments.length === 0

export function parseDropped(raw: unknown): readonly DroppedFile[] | null {
  if (!Array.isArray(raw)) return null
  const files = raw.map(file => (isObject(file) && filled(file.name) && (file.path === null || (text(file.path) && ABSOLUTE.test(file.path)))
    ? { name: file.name, path: file.path as string | null }
    : null))
  return files.includes(null) ? null : (files as DroppedFile[])
}

export function parseImageRequest(raw: unknown): ImageRequest | null {
  if (!isObject(raw)) return null
  if (raw.kind === 'web') return text(raw.url) && isWebPage(raw.url) ? { kind: 'web', url: raw.url } : null
  if (raw.kind === 'attachment') return filled(raw.id) ? { kind: 'attachment', id: raw.id as AttachmentId } : null
  if (raw.kind !== 'tool') return null
  const sessionId = sessionIdOf(raw)
  return sessionId && text(raw.path) && ABSOLUTE.test(raw.path) ? { kind: 'tool', sessionId, path: raw.path } : null
}

export function parseTopic(raw: unknown): Topic | null {
  if (isAppTopic(raw)) return raw
  return text(raw) && raw.startsWith('session:') && raw.length > 'session:'.length ? (raw as Topic) : null
}
