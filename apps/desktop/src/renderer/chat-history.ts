import type { ChatRef, Shown, ShownGroup } from '@highwing/hermes/domain'

export type Visit = Extract<ChatRef, { kind: 'bot' | 'new' | 'chat' | 'run' | 'group' }>

/** `at` is the index of the current visit, -1 while there is none. */
export interface Visits {
  readonly refs: readonly Visit[]
  readonly at: number
}

export const NO_VISITS: Visits = { refs: [], at: -1 }

const KEPT = 100

/** What opening this again would show. */
export function visitOf(shown: Shown | ShownGroup | null): Visit | null {
  switch (shown?.kind) {
    case undefined: return null
    case 'bot': return { kind: 'bot', bot: shown.bot }
    case 'group': return { kind: 'group', group: shown.group }
    case 'chat': case 'branch': return { kind: 'chat', sessionId: shown.sessionId }
    case 'run': return { kind: 'run', bot: shown.bot, sessionId: shown.sessionId }
    case 'new': return shown.sessionId === null ? { kind: 'new', bot: shown.bot, draftId: shown.draftId } : { kind: 'chat', sessionId: shown.sessionId }
  }
}

const same = (a: Visit, b: Visit) => JSON.stringify(a) === JSON.stringify(b)

/** A new place drops what was ahead of the current one, like a browser's history. A new chat's first message turns its visit into the chat it made. */
export function visited(visits: Visits, shown: Shown | ShownGroup | null): Visits {
  const visit = visitOf(shown)
  const current = visits.refs[visits.at]
  if (visit === null || (current !== undefined && same(current, visit))) return visits
  if (current?.kind === 'new' && shown?.kind === 'new' && shown.draftId === current.draftId) return { refs: visits.refs.with(visits.at, visit), at: visits.at }
  const refs = [...visits.refs.slice(0, visits.at + 1), visit].slice(-KEPT)
  return { refs, at: refs.length - 1 }
}

export function stepped(visits: Visits, by: -1 | 1): Visits | null {
  const at = visits.at + by
  return at < 0 || at >= visits.refs.length ? null : { refs: visits.refs, at }
}
