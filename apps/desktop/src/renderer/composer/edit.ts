import type { AdmissionId } from '@highwing/hermes/domain'
import type { QueuedRow } from '../chat/Thread'

/** The message an edit was started on. It outlives that message, so a draft meant as an edit is never sent as a new message. */
export type EditTarget = { readonly press: number; readonly text: string } & (
  | { readonly kind: 'sent'; readonly rowId: number }
  | { readonly kind: 'queued'; readonly admissionId: AdmissionId }
)

/** `gone`: the target can no longer be edited, and `why` says so. */
export type Editing =
  | { readonly kind: 'sent'; readonly press: number; readonly rowId: number; readonly later: number; readonly text: string }
  | { readonly kind: 'queued'; readonly press: number; readonly admissionId: AdmissionId; readonly text: string }
  | { readonly kind: 'gone'; readonly press: number; readonly text: string; readonly why: string }

export const EDITING_WORDS = {
  sent: 'Editing a sent message',
  queued: 'Editing a queued message. It moves to the back of the queue.'
} as const satisfies Record<Exclude<Editing['kind'], 'gone'>, string>

const NOT_EDITABLE = {
  queued: 'Hermes no longer lets you edit that message.',
  steering: "That message has already started, so it can't be edited.",
  lost: "That message has already started, so it can't be edited."
} as const satisfies Record<QueuedRow['status'], string>

export function editingOf(target: EditTarget, turns: readonly { readonly rowId: number | null }[], listed: ReadonlyMap<AdmissionId, QueuedRow>): Editing {
  const { press, text } = target
  const gone = (why: string): Editing => ({ kind: 'gone', press, text, why })
  if (target.kind === 'queued') {
    const row = listed.get(target.admissionId)
    if (row === undefined) return gone('That message is no longer queued.')
    return row.actions.includes('edit') ? { kind: 'queued', press, admissionId: target.admissionId, text } : gone(NOT_EDITABLE[row.status])
  }
  const at = turns.findIndex(turn => turn.rowId === target.rowId)
  return at < 0 ? gone('That message is no longer in this chat.') : { kind: 'sent', press, rowId: target.rowId, later: turns.length - 1 - at, text }
}

export const removalWords = (later: number) => `This removes ${later} later ${later === 1 ? 'message' : 'messages'}.`
