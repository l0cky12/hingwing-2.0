import type { AdmissionId, BusyMode, Generation, InputId, QueuedAction, QueuedMessage, QueuedState, SessionContent } from './session'

export interface Admission {
  readonly admissionId: AdmissionId
  readonly inputId: InputId
  readonly text: string
  readonly state: QueuedState | { readonly s: 'started' } | { readonly s: 'terminal' }
}

export function queueOf(held: readonly QueuedMessage[], sent: (row: Admission) => boolean, rows: readonly Admission[]): readonly QueuedMessage[] {
  const next = rows.flatMap((row): QueuedMessage[] => {
    const { state } = row
    if (state.s === 'started' || state.s === 'terminal') return []
    const before = held.find(message => message.admissionId === row.admissionId)
    const from = before?.from === 'here' || sent(row) ? 'here' : 'elsewhere'
    const unchanged = before !== undefined && before.inputId === row.inputId && before.text === row.text && before.from === from && sameState(before.state, state)
    return [unchanged ? before : { admissionId: row.admissionId, inputId: row.inputId, text: row.text, from, state }]
  })
  return next.length === held.length && next.every((message, index) => message === held[index]) ? held : next
}

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
 * (apps/desktop/src/app/chat/composer/busy-submit-state.ts).
 */
export function sendPlan(session: Pick<SessionContent, 'run' | 'requests' | 'tuning'>): SendPlan {
  const { run, requests, tuning } = session
  if (run.state !== 'running' || tuning.busy === null) return SUBMIT
  const by = BUSY[tuning.busy]
  const held = run.stop === 'requested' || requests.length > 0
    || run.turn.items.some(item => item.kind === 'prompt' && (item.state.s === 'waiting' || item.state.s === 'sending'))
  return by === 'submit' || held ? SUBMIT : { by, during: run.generation }
}
