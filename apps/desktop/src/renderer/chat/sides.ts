import type { SessionId, SideId, SideTask } from '@highwing/hermes/domain'
import { useSyncExternalStore } from 'react'

export type SideAnswer =
  | { readonly s: 'waiting' }
  | { readonly s: 'answered'; readonly markdown: string }
  | { readonly s: 'failed'; readonly message: string }
  | { readonly s: 'lost' }

export interface SideCard {
  readonly id: SideId
  readonly label: string
  readonly asked: string | null
  readonly answer: SideAnswer
}

export const SIDE_LABELS = { btw: 'Side question', background: 'Background prompt' } as const satisfies Record<SideTask['kind'], string>

const FAILED = 'error:'

function answerOf(state: SideTask['state']): SideAnswer {
  switch (state.s) {
    case 'running': return { s: 'waiting' }
    case 'lost': return { s: 'lost' }
    case 'done': return state.text.startsWith(FAILED) ? { s: 'failed', message: state.text.slice(FAILED.length).trim() } : { s: 'answered', markdown: state.text }
  }
}

/** The cards to draw above the composer, oldest first, so the newest sits nearest it. */
export function sideCards(sides: readonly SideTask[], closed: ReadonlySet<SideId>): SideCard[] {
  return sides.flatMap(side => (closed.has(side.id) ? [] : [{ id: side.id, label: SIDE_LABELS[side.kind], asked: side.asked, answer: answerOf(side.state) }]))
}

// Closing is the renderer's alone: dropping the task from the session would let its late answer add it back.
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
