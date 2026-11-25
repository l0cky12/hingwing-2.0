import type { AdmissionId } from '@highwing/hermes/domain'

export type Editing =
  | { readonly kind: 'sent'; readonly press: number; readonly rowId: number; readonly later: number; readonly text: string }
  | { readonly kind: 'queued'; readonly press: number; readonly admissionId: AdmissionId; readonly text: string }

export const EDITING_WORDS = {
  sent: 'Editing a sent message',
  queued: 'Editing a queued message. It moves to the back of the queue.'
} as const satisfies Record<Editing['kind'], string>

export const removalWords = (later: number) => `This removes ${later} later ${later === 1 ? 'message' : 'messages'}.`
