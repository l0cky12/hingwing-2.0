import type { Item, MoaItem, StatusItem } from '@highwing/hermes/domain'

type KeyedNotice = Extract<StatusItem, { what: 'notice' }>

/** When a keyed notice stops showing, on this client's clock. null: it shows until Hermes clears it. */
const endsAt = ({ ttlMs, seenAt }: KeyedNotice): number | null => (ttlMs === null || seenAt === null ? null : seenAt + ttlMs)

/** Whether a status item shows at `now`: every line does, and a keyed notice until it is cleared or its time to live runs out. */
export function isShownAt(item: StatusItem, now: number): boolean {
  if (item.what === 'line') return true
  const end = endsAt(item)
  return item.state === 'shown' && (end === null || now < end)
}

/** The first moment after `now` at which one of these items stops showing, or null when none will. */
export function hidesAt(items: readonly Item[], now: number): number | null {
  let first: number | null = null
  for (const item of items) {
    if (item.kind !== 'status' || item.what !== 'notice' || !isShownAt(item, now)) continue
    const end = endsAt(item)
    if (end !== null && (first === null || end < first)) first = end
  }
  return first
}

export const NOTICE_TONES = { info: 'info', success: 'info', warn: 'warn', error: 'error' } as const satisfies Record<KeyedNotice['level'], string>

const models = (count: number) => `${count} model${count === 1 ? '' : 's'}`

/** "Asking 3 models", then "2 answered" while they answer and "Combining their answers" once one model combines them. */
export function moaWords({ progress, references, phase }: MoaItem): { readonly title: string; readonly meta: string | null } {
  const total = progress?.total ?? references.length
  return {
    title: total === 0 ? 'Asking models' : `Asking ${models(total)}`,
    meta: phase.is === 'aggregating' ? 'Combining their answers' : progress === null ? null : `${progress.done} answered`
  }
}
