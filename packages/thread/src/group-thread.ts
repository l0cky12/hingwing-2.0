import type { Answering, GroupChat, GroupMember, MemberId } from '@highwing/hermes/domain'
import { changesAt, timeLines, type ViewClock } from './when'

type Read = Extract<GroupChat, { readonly at: 'read' }>

/** A member's name as the window shows it: the roster's name for the bot, else the seat's own. */
export type NameOf = (member: GroupMember) => string

export type GroupItemView =
  | { readonly kind: 'reply'; readonly key: string; readonly member: GroupMember; readonly text: string }
  /** A member's turn that posted nothing. `error`: it failed. */
  | { readonly kind: 'note'; readonly key: string; readonly member: GroupMember; readonly words: string; readonly tone: 'quiet' | 'error' }

/** One message to the group and what the members said to it. `request` null: the window starts after the message. */
export interface GroupTurnView {
  readonly key: string
  /** "Today 10:42" where a time line is due. */
  readonly time: string | null
  readonly request: string | null
  /** Hermes has not logged the message yet. */
  readonly sending: boolean
  readonly items: readonly GroupItemView[]
}

export type GroupThreadView =
  | { readonly show: 'loading' }
  | { readonly show: 'note'; readonly words: string }
  | {
      readonly show: 'thread'
      readonly name: string
      readonly members: readonly GroupMember[]
      /** Hermes holds lines older than the first one shown. */
      readonly earlier: boolean
      readonly turns: readonly GroupTurnView[]
      /** "Sam is thinking": the live end of the last turn. null: nobody is answering. */
      readonly live: string | null
      /** "Sam is still answering. If you send now, Sam’s reply won’t be posted." null: nobody is answering. */
      readonly busy: string | null
      /** A member is answering and no Stop has reached it yet. */
      readonly stoppable: boolean
      /** When a time line changes by the clock alone, or null. */
      readonly changesAt: number | null
    }

export const namesInWords = (names: readonly string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

const DOING: { readonly [D in Answering['doing']]: { readonly one: string; readonly many: string } } = {
  thinking: { one: 'is thinking', many: 'are thinking' },
  working: { one: 'is working', many: 'are working' },
  stopping: { one: 'is stopping', many: 'are stopping' },
  waiting: { one: 'is next', many: 'are next' }
}

const seatOf = (members: readonly GroupMember[], id: MemberId): GroupMember =>
  members.find(member => member.id === id) ?? { id, bot: id as string as GroupMember['bot'], handle: id, name: id }

function answeringNow(answering: readonly Answering[]): readonly Answering[] {
  const running = answering.filter(turn => turn.doing !== 'waiting')
  return running.length > 0 ? running : answering
}

/** "Sam is thinking", "Ada and Sam are thinking". null: nobody is answering. */
export function answeringWords(answering: readonly Answering[], members: readonly GroupMember[], nameOf: NameOf): string | null {
  const now = answeringNow(answering)
  const [first] = now
  if (first === undefined) return null
  const doing = DOING[first.doing]
  return `${namesInWords(now.map(turn => nameOf(seatOf(members, turn.member))))} ${now.length === 1 ? doing.one : doing.many}`
}

/** A message sent now makes Hermes drop a running member's reply (`plan_publication`), so the composer says so first. */
function busyWords(answering: readonly Answering[], members: readonly GroupMember[], nameOf: NameOf): string | null {
  const names = answeringNow(answering).map(turn => nameOf(seatOf(members, turn.member)))
  const [only] = names
  if (only === undefined) return null
  return names.length === 1
    ? `${only} is still answering. If you send now, ${only}’s reply won’t be posted.`
    : `${namesInWords(names)} are still answering. If you send now, their replies won’t be posted.`
}

const SILENT_WORDS = {
  superseded: (name: string) => `${name}’s reply wasn’t posted, because a newer message came first.`,
  stopped: (name: string) => `${name} was stopped.`,
  failed: (name: string, detail: string | null) => (detail === null ? `${name} couldn’t answer.` : `${name} couldn’t answer: ${detail}`)
} as const

interface Building { readonly key: string; readonly at: number | null; readonly id: string | null; readonly request: string | null; readonly sending: boolean; readonly items: GroupItemView[] }

/**
 * What the open group draws. A member's line sits under the message it answered, wherever it landed in the log, so a
 * reply a newer message overtook still reads as an answer to the older one. `chat` null or undefined: main has not
 * pushed this group yet.
 */
export function groupThread(chat: GroupChat | null | undefined, clock: ViewClock, nameOf: NameOf): GroupThreadView {
  if (chat == null || chat.at === 'loading') return { show: 'loading' }
  if (chat.at === 'missing') return { show: 'note', words: 'This group chat isn’t on this Hermes any more.' }
  return read(chat, clock, nameOf)
}

function read({ name, members, events, earlier, answering, sending }: Read, clock: ViewClock, nameOf: NameOf): GroupThreadView {
  const turns: Building[] = []
  const byId = new Map<string, Building>()
  let before: Building | null = null
  const turnAnswering = (about: string): Building => {
    const held = byId.get(about)
    if (held !== undefined) return held
    if (before === null) {
      before = { key: 'before', at: null, id: null, request: null, sending: false, items: [] }
      turns.unshift(before)
    }
    return before
  }
  for (const event of events) {
    if (event.kind === 'said') {
      const turn: Building = { key: event.id, at: event.at, id: event.id, request: event.text, sending: false, items: [] }
      turns.push(turn)
      byId.set(event.id, turn)
      continue
    }
    const member = seatOf(members, event.member)
    const key = `${event.seq}`
    turnAnswering(event.about).items.push(event.kind === 'reply'
      ? { kind: 'reply', key, member, text: event.text }
      : { kind: 'note', key, member, words: SILENT_WORDS[event.why](nameOf(member), event.detail), tone: event.why === 'failed' ? 'error' : 'quiet' })
  }
  for (const message of sending) turns.push({ key: message.key, at: null, id: null, request: message.text, sending: true, items: [] })
  const live = answeringWords(answering, members, nameOf)
  if (live !== null && turns.length === 0) turns.push({ key: 'live', at: null, id: null, request: null, sending: false, items: [] })
  const starts = turns.map(turn => turn.at)
  const lines = timeLines(starts, clock)
  return {
    show: 'thread', name, members, earlier,
    turns: turns.map(({ key, request, sending: pending, items }, at) => ({ key, time: lines[at] ?? null, request, sending: pending, items })),
    live,
    busy: busyWords(answering, members, nameOf),
    stoppable: answering.some(turn => turn.doing !== 'stopping'),
    changesAt: changesAt(starts, lines, null, clock)
  }
}
