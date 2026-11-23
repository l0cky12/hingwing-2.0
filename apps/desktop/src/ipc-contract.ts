import {
  targetOf,
  type CheckFailure, type CheckStep, type Command, type CommandOutcome, type Item, type Link, type ModelOption, type OpenTurn, type PromptReply, type ResultOf,
  type Session, type SessionId, type SettledTurn, type Sidebar, type Target
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
  | { readonly at: 'failed'; readonly live: Live | null; readonly target: Target; readonly failure: CheckFailure }
  | { readonly at: 'saved'; readonly live: Live }
  /** `HIGHWING_FIXTURE` plays a recorded gateway. There is nothing to set up. */
  | { readonly at: 'pinned' }

export type SetupCommand =
  /** Check a target and, when it passes, save it and connect to it. */
  | { readonly do: 'checkTarget'; readonly target: Target }
  /** Open the setup screen over the chat. */
  | { readonly do: 'editTarget' }
  /** Cancel: back to the chat on the connection it has. */
  | { readonly do: 'keepTarget' }
  | { readonly do: 'openChat' }

export type AppCommand = Command | SetupCommand
export type AppResult<C extends AppCommand> = C extends Command ? ResultOf<C> : void

export type Topic = 'setup' | 'link' | 'sidebar' | `session:${SessionId}`
export type TopicValue<T extends Topic> = T extends 'setup' ? Setup : T extends 'link' ? Link : T extends 'sidebar' ? Sidebar : Session

export interface Tail<T> { readonly from: number; readonly items: readonly T[] }

type Running = Extract<Session['run'], { state: 'running' }>
export interface SessionPatch {
  readonly rest: Omit<Session, 'history' | 'run'>
  readonly history: Tail<SettledTurn>
  readonly run:
    | { readonly state: 'idle' }
    | { readonly state: 'running'; readonly head: Omit<Running, 'turn'>; readonly turn: Omit<OpenTurn, 'items'>; readonly items: Tail<Item> }
}

export type Push<T extends Topic = Topic> =
  | { readonly topic: T; readonly rev: number; readonly full: TopicValue<T> }
  | (T extends `session:${string}` ? { readonly topic: T; readonly rev: number; readonly patch: SessionPatch } : never)

export type FileAction = 'open' | 'show'
export interface FileRequest { readonly action: FileAction; readonly sessionId: SessionId; readonly path: string }
export type FileOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: 'refused' | 'missing' | 'failed' }

export interface Bridge {
  watch<T extends Topic>(topic: T, onPush: (push: Push<T>) => void): () => void
  run<C extends AppCommand>(command: C): Promise<CommandOutcome<AppResult<C>>>
  file(request: FileRequest): Promise<FileOutcome>
}

export const CHANNEL = { watch: 'highwing:watch', unwatch: 'highwing:unwatch', push: 'highwing:push', run: 'highwing:run', file: 'highwing:file' } as const

const WEB_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:'])

/** The links a reply may open, in the user's browser. Shared so the renderer draws only links main will open. */
export const isWebLink = (url: string): boolean => WEB_SCHEMES.has(URL.parse(url)?.protocol ?? '')

export const SESSION_PARAM = 'session'

const splice = <T>(held: readonly T[], tail: Tail<T>): readonly T[] => [...held.slice(0, tail.from), ...tail.items]

export function applyPush<T extends Topic>(current: TopicValue<T> | undefined, currentRev: number, push: Push<T>): { readonly value: TopicValue<T>; readonly rev: number } | 'need-full' {
  if ('full' in push) return { value: push.full, rev: push.rev }
  if (current === undefined || push.rev !== currentRev + 1) return 'need-full'
  const held = current as Session
  const { rest, history, run } = push.patch
  const next: Session = {
    ...rest,
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
const modelOptionOf = (raw: unknown): ModelOption | null =>
  isObject(raw) && filled(raw.id) && filled(raw.provider) && text(raw.providerName)
    ? { id: raw.id as ModelOption['id'], provider: raw.provider, providerName: raw.providerName }
    : null
const replyOf = (raw: unknown): PromptReply | null =>
  isObject(raw) && (raw.kind === 'choice' || raw.kind === 'text') && text(raw.value) ? { kind: raw.kind, value: raw.value } : null

type Validators = { readonly [K in AppCommand['do']]: (raw: Obj) => Extract<AppCommand, { do: K }> | null }

export const validators: Validators = {
  create: raw => (filled(raw.draftId) && (raw.cwd === null || text(raw.cwd)) ? { do: 'create', draftId: raw.draftId, cwd: raw.cwd } : null),
  send: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && filled(raw.text) ? { do: 'send', sessionId, text: raw.text } : null
  },
  stop: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && { do: 'stop', sessionId }
  },
  answer: raw => {
    const sessionId = sessionIdOf(raw)
    const reply = replyOf(raw.reply)
    return sessionId && filled(raw.promptId) && reply ? { do: 'answer', sessionId, promptId: raw.promptId as Extract<Command, { do: 'answer' }>['promptId'], reply } : null
  },
  discard: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && filled(raw.inputId) ? { do: 'discard', sessionId, inputId: raw.inputId as Extract<Command, { do: 'discard' }>['inputId'] } : null
  },
  rename: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && filled(raw.title) ? { do: 'rename', sessionId, title: raw.title } : null
  },
  archive: raw => {
    const sessionId = sessionIdOf(raw)
    return sessionId && typeof raw.archived === 'boolean' ? { do: 'archive', sessionId, archived: raw.archived } : null
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
  reconnect: raw => (typeof raw.start === 'boolean' ? { do: 'reconnect', start: raw.start } : null),
  checkTarget: raw => {
    const target = targetOf(raw.target)
    return target && { do: 'checkTarget', target }
  },
  editTarget: () => ({ do: 'editTarget' }),
  keepTarget: () => ({ do: 'keepTarget' }),
  openChat: () => ({ do: 'openChat' })
}

export function parseCommand(raw: unknown): AppCommand | null {
  if (!isObject(raw) || !text(raw.do) || !Object.hasOwn(validators, raw.do)) return null
  return (validators[raw.do as AppCommand['do']] as (raw: Obj) => AppCommand | null)(raw)
}

export function parseFileRequest(raw: unknown): FileRequest | null {
  if (!isObject(raw) || (raw.action !== 'open' && raw.action !== 'show')) return null
  const sessionId = sessionIdOf(raw)
  return sessionId && filled(raw.path) ? { action: raw.action, sessionId, path: raw.path } : null
}

export function parseTopic(raw: unknown): Topic | null {
  if (raw === 'setup' || raw === 'link' || raw === 'sidebar') return raw
  return text(raw) && raw.startsWith('session:') && raw.length > 'session:'.length ? (raw as Topic) : null
}
