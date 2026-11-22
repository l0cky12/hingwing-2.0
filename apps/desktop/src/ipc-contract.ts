import type {
  Command, CommandOutcome, Item, Link, OpenTurn, PromptReply, ResultOf, Session, SessionId, SettledTurn, Sidebar
} from '@highwing/hermes/domain'

export type Topic = 'link' | 'sidebar' | `session:${SessionId}`
export type TopicValue<T extends Topic> = T extends 'link' ? Link : T extends 'sidebar' ? Sidebar : Session

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

export interface Bridge {
  watch<T extends Topic>(topic: T, onPush: (push: Push<T>) => void): () => void
  run<C extends Command>(command: C): Promise<CommandOutcome<ResultOf<C>>>
}

export const CHANNEL = { watch: 'highwing:watch', unwatch: 'highwing:unwatch', push: 'highwing:push', run: 'highwing:run' } as const

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
const replyOf = (raw: unknown): PromptReply | null =>
  isObject(raw) && (raw.kind === 'choice' || raw.kind === 'text') && text(raw.value) ? { kind: raw.kind, value: raw.value } : null

type Validators = { readonly [K in Command['do']]: (raw: Obj) => Extract<Command, { do: K }> | null }

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
  reconnect: raw => (typeof raw.start === 'boolean' ? { do: 'reconnect', start: raw.start } : null)
}

export function parseCommand(raw: unknown): Command | null {
  if (!isObject(raw) || !text(raw.do) || !Object.hasOwn(validators, raw.do)) return null
  return (validators[raw.do as Command['do']] as (raw: Obj) => Command | null)(raw)
}

export function parseTopic(raw: unknown): Topic | null {
  if (raw === 'link' || raw === 'sidebar') return raw
  return text(raw) && raw.startsWith('session:') && raw.length > 'session:'.length ? (raw as Topic) : null
}
