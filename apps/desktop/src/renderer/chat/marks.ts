import type { AdmissionId, QueuedAction } from '@highwing/hermes/domain'
import type { QueuedRow } from './Thread'

export type Listed = ReadonlyMap<AdmissionId, QueuedRow>

/** A press holds its row's buttons until Hermes lists that row differently. */
export interface Marks {
  readonly listed: Listed
  readonly pressed: ReadonlyMap<AdmissionId, { readonly action: QueuedAction; readonly row: QueuedRow }>
}

export type MarkEvent =
  | { readonly kind: 'listed'; readonly listed: Listed }
  | { readonly kind: 'pressed'; readonly row: QueuedRow; readonly action: QueuedAction }
  | { readonly kind: 'refused'; readonly row: QueuedRow }

const sameRow = (a: QueuedRow, b: QueuedRow) => JSON.stringify(a) === JSON.stringify(b)

export const unmarked = (listed: Listed): Marks => ({ listed, pressed: new Map() })

export function marked(marks: Marks, event: MarkEvent): Marks {
  if (event.kind === 'listed') {
    const kept = [...marks.pressed].filter(([admissionId, { row }]) => {
      const now = event.listed.get(admissionId)
      return now !== undefined && sameRow(now, row)
    })
    return { listed: event.listed, pressed: new Map(kept) }
  }
  const pressed = new Map(marks.pressed)
  if (event.kind === 'refused') pressed.delete(event.row.admissionId)
  else pressed.set(event.row.admissionId, { action: event.action, row: event.row })
  return { ...marks, pressed }
}

export const pressedOf = (marks: Marks): ReadonlyMap<AdmissionId, QueuedAction> =>
  new Map([...marks.pressed].map(([admissionId, { action }]) => [admissionId, action]))
