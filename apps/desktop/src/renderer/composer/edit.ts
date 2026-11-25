import type { AdmissionId } from '@highwing/hermes/domain'

/** A message put back in the composer. `press` is new for each press of Edit, and a new value puts `text` in the box. */
export type Editing =
  /** A sent message, sent again in its place. `later` counts the turns after it, which the send removes. */
  | { readonly kind: 'sent'; readonly press: number; readonly rowId: number; readonly later: number; readonly text: string }
  /** A row of Hermes's queue. The edit takes its place at the back of the queue. */
  | { readonly kind: 'queued'; readonly press: number; readonly admissionId: AdmissionId; readonly text: string }

export const EDITING_WORDS = {
  sent: 'Editing a sent message',
  queued: 'Editing a queued message. It moves to the back of the queue.'
} as const satisfies Record<Editing['kind'], string>

export const removalWords = (later: number) => `This removes ${later} later ${later === 1 ? 'message' : 'messages'}.`
