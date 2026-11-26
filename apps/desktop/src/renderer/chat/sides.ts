import type { SessionId, SideId, SideTask, TurnId } from '@highwing/hermes/domain'
import { useSyncExternalStore } from 'react'

export type Answered =
  | { readonly s: 'answered'; readonly markdown: string }
  | { readonly s: 'failed'; readonly message: string }

export type SideAnswer = { readonly s: 'waiting' } | Answered | { readonly s: 'lost' }

/** A side task drawn above the message box. */
export interface SideCard {
  readonly id: SideId
  readonly label: string
  readonly asked: string | null
  readonly answer: SideAnswer
  readonly note: string
}

/** An answered side question, drawn in the thread after the turn `after` names. */
export interface SideRow {
  readonly id: SideId
  readonly after: TurnId | null
  readonly asked: string | null
  readonly answer: Answered
}

const LABELS = { btw: 'Side question', background: 'Background prompt' } as const satisfies Record<SideTask['kind'], string>

const FAILED = 'error:'
const WAITING: SideAnswer = { s: 'waiting' }
const LOST: SideAnswer = { s: 'lost' }

const answerOf = (text: string): Answered =>
  text.startsWith(FAILED) ? { s: 'failed', message: text.slice(FAILED.length).trim() } : { s: 'answered', markdown: text }

/** An answered side question goes in the thread. The rest are cards: a side question still waiting or missed, and every background prompt. A closed one is neither. */
export function sortSides(sides: readonly SideTask[], closed: ReadonlySet<SideId>): { readonly cards: readonly SideCard[]; readonly rows: readonly SideRow[] } {
  const cards: SideCard[] = []
  const rows: SideRow[] = []
  for (const { id, kind, asked, state } of sides) {
    if (closed.has(id)) continue
    if (kind === 'btw' && state.s === 'done') {
      rows.push({ id, after: state.after, asked, answer: answerOf(state.text) })
      continue
    }
    const answer = state.s === 'done' ? answerOf(state.text) : state.s === 'running' ? WAITING : LOST
    const note = kind === 'btw' && state.s === 'running' ? 'The answer will show in the chat.' : 'Not part of the chat.'
    cards.push({ id, label: LABELS[kind], asked, answer, note })
  }
  return { cards, rows }
}

const closedSides = new Map<SessionId, ReadonlySet<SideId>>()
const NONE_CLOSED: ReadonlySet<SideId> = new Set()
const listeners = new Set<() => void>()

export function closeSide(sessionId: SessionId, id: SideId) {
  const held = closedSides.get(sessionId) ?? NONE_CLOSED
  if (held.has(id)) return
  closedSides.set(sessionId, new Set([...held, id]))
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export const useClosedSides = (sessionId: SessionId | null): ReadonlySet<SideId> =>
  useSyncExternalStore(subscribe, () => (sessionId === null ? NONE_CLOSED : closedSides.get(sessionId) ?? NONE_CLOSED))
