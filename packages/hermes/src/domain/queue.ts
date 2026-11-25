import type { AdmissionId, Attachment, BusyMode, Generation, InputId, OutboxEntry, QueuedAction, QueuedMessage, QueuedState, SessionContent } from './session'

export interface Admission {
  readonly admissionId: AdmissionId
  readonly inputId: InputId
  readonly text: string
  readonly state: QueuedState | { readonly s: 'started' } | { readonly s: 'terminal' }
}

/**
 * `held` with Hermes's list in its place. `sent` is the outbox entry a row names, which hands the row
 * its attachments as it leaves the outbox; the row keeps them for as long as Hermes lists it.
 */
export function queueOf(
  held: readonly QueuedMessage[], sent: (row: Admission) => Pick<OutboxEntry, 'attachments'> | undefined, rows: readonly Admission[]
): readonly QueuedMessage[] {
  const next = rows.flatMap((row): QueuedMessage[] => {
    const { state } = row
    if (state.s === 'started' || state.s === 'terminal') return []
    const before = held.find(message => message.admissionId === row.admissionId)
    const entry = sent(row)
    const from = before?.from === 'here' || entry !== undefined ? 'here' : 'elsewhere'
    const attachments = entry?.attachments ?? before?.attachments ?? NONE
    const unchanged = before !== undefined && before.inputId === row.inputId && before.text === row.text && before.from === from
      && before.attachments === attachments && sameState(before.state, state)
    return [unchanged ? before : { admissionId: row.admissionId, inputId: row.inputId, text: row.text, from, attachments, state }]
  })
  return next.length === held.length && next.every((message, index) => message === held[index]) ? held : next
}

const NONE: readonly Attachment[] = []

function sameState(a: QueuedState, b: QueuedState): boolean {
  switch (a.s) {
    case 'queued':
      return b.s === 'queued' && a.can.length === b.can.length && a.can.every((action, index) => action === b.can[index])
    case 'steering':
      return b.s === 'steering'
    case 'lost':
      return b.s === 'lost' && a.generation === b.generation
  }
}

/** Hermes refuses to cancel a row in transfer to the turn (persistence/sqlite/authority/_admission_store.py:258-260), and a lost row can only be released. */
export function offeredBy(state: QueuedState): readonly QueuedAction[] {
  switch (state.s) {
    case 'queued':
      return ['cancel', ...state.can]
    case 'steering':
      return []
    case 'lost':
      return ['release']
  }
}

export type SendPlan = { readonly by: 'submit' } | { readonly by: 'steer' | 'redirect'; readonly during: Generation }

const SUBMIT: SendPlan = { by: 'submit' }
const BUSY = { queue: 'submit', steer: 'steer', interrupt: 'redirect' } as const satisfies Record<BusyMode, SendPlan['by']>

/**
 * A message is submitted, and so queues behind a running turn, unless the chat's busy mode hands it
 * to that turn. A turn that waits on the user reads nothing until it is answered, and one that is
 * stopping reads nothing more, so a message sent then queues too, as Hermes Desktop's does
 * (apps/desktop/src/app/chat/composer/busy-submit-state.ts). A steer or a redirect carries only
 * words, so a message with `attachments` always queues whole, as in Hermes Desktop
 * (apps/desktop/src/app/chat/composer/use-composer-submit.ts) and the TUI.
 */
export function sendPlan(session: Pick<SessionContent, 'run' | 'requests' | 'tuning'>, attachments: readonly Attachment[]): SendPlan {
  const { run, requests, tuning } = session
  if (run.state !== 'running' || tuning.busy === null || attachments.length > 0) return SUBMIT
  const by = BUSY[tuning.busy]
  const held = run.stop === 'requested' || requests.length > 0
    || run.turn.items.some(item => item.kind === 'prompt' && (item.state.s === 'waiting' || item.state.s === 'sending'))
  return by === 'submit' || held ? SUBMIT : { by, during: run.generation }
}
