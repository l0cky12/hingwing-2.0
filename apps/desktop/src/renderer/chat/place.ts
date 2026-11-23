import type { ThreadView } from '@highwing/thread'

export type Place =
  | { readonly kind: 'following' }
  | { readonly kind: 'reading'; readonly since: string; readonly far: boolean }

export const FOLLOWING: Place = { kind: 'following' }

export const FOLLOW_WITHIN = 60
const FAR_BEYOND = 80

export function placeAfter(held: Place, distance: number, progress: string): Place {
  if (distance < FOLLOW_WITHIN) return held.kind === 'following' ? held : FOLLOWING
  const far = distance > FAR_BEYOND
  if (held.kind === 'reading' && held.far === far) return held
  return { kind: 'reading', since: held.kind === 'reading' ? held.since : progress, far }
}

export function progressOf(view: ThreadView): string {
  const last = view.turns.at(-1)
  return last === undefined
    ? `none:${view.pending.length}`
    : `${last.key}:${last.nodes.reduce((size, node) => size + (node.kind === 'group' ? node.count : 1), 0)}:${last.end.kind}:${view.pending.length}`
}
