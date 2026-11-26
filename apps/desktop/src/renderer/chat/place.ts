import type { Activity } from '@highwing/hermes/domain'
import type { ThreadView } from '@highwing/thread'
import type { SideRow } from './sides'

export type Place =
  | { readonly kind: 'following' }
  | { readonly kind: 'reading'; readonly since: string; readonly far: boolean }

export const FOLLOWING: Place = { kind: 'following' }

export const FOLLOW_WITHIN = 60

export const distanceFrom = (element: HTMLElement) => element.scrollHeight - element.scrollTop - element.clientHeight
const FAR_BEYOND = 80

export function placeAfter(held: Place, distance: number, progress: string): Place {
  if (distance < FOLLOW_WITHIN) return held.kind === 'following' ? held : FOLLOWING
  const far = distance > FAR_BEYOND
  if (held.kind === 'reading' && held.far === far) return held
  return { kind: 'reading', since: held.kind === 'reading' ? held.since : progress, far }
}

/** Changes when something new shows at the end: a step of the last turn, its end, a pending message, or an answered side question. */
export function progressOf(view: ThreadView, sides: readonly SideRow[]): string {
  const last = view.turns.at(-1)
  const turn = last === undefined ? 'none' : `${last.key}:${last.nodes.reduce((size, node) => size + (node.kind === 'group' ? node.count : 1), 0)}:${last.end.kind}`
  return `${turn}:${view.pending.length}:${sides.length}`
}

export function jumpWords(place: Place, activity: Activity['kind'] | null, progress: string): string {
  if (place.kind !== 'reading') return ''
  if (activity === 'asking') return 'Waiting for your OK'
  if (activity === 'answering') return 'Waiting for your answer'
  return progress !== place.since ? 'New steps below' : ''
}
