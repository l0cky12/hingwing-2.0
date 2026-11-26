import type { Relay, TurnId } from '@highwing/hermes/domain'
import type { ThreadView } from '@highwing/thread'
import { startTransition, useEffect, useMemo, useState } from 'react'
import type { SideRow } from './sides'

/** A turn is at least its 44 px gap, a request line and a line of reply, about 130 px, or 80 px with no request, so 24 overfill a window 2160 px tall. */
export const TAIL = 24

export interface Drawn {
  readonly view: ThreadView
  readonly relays: readonly Relay[]
  readonly sides: readonly SideRow[]
  /** Every turn the chat holds is drawn, so a row that is not in the page is not loaded. */
  readonly whole: boolean
}

export function drawnOf(view: ThreadView, relays: readonly Relay[], sides: readonly SideRow[], whole: boolean): Drawn {
  if (whole || view.turns.length <= TAIL) return { view, relays, sides, whole: true }
  const turns = view.turns.slice(-TAIL)
  const kept = new Set(turns.map(turn => turn.key))
  const held = new Set(view.turns.map(turn => turn.key))
  const shown = ({ after }: { readonly after: TurnId | null }) => after !== null && (kept.has(after) || !held.has(after))
  return { view: { ...view, turns, earlier: 'none' }, relays: relays.filter(shown), sides: sides.filter(shown), whole: false }
}

/** A chat opens with its newest turns alone, so its end paints before a long history is built. The rest follows in a transition, which input interrupts. */
export function useTail(view: ThreadView | null, relays: readonly Relay[], sides: readonly SideRow[]): Drawn | null {
  const [whole, setWhole] = useState(false)
  const shows = view !== null && view.turns.length > 0
  useEffect(() => {
    if (shows && !whole) startTransition(() => setWhole(true))
  }, [shows, whole])
  return useMemo(() => (view === null ? null : drawnOf(view, relays, sides, whole)), [view, relays, sides, whole])
}
