/**
 * Proof that the sketch's types reject the states the rationale says cannot be built.
 * Every `@ts-expect-error` line must fail to compile. If one of them compiles, tsc reports an unused
 * directive and this check fails. Run: tsc -p docs/design/sketch/.typecheck/tsconfig.json
 */
import type { Command } from '@highwing/hermes'
import type { Generation, Link, Run, Session, SessionId, SettledTurn } from '@highwing/hermes/domain'
import type { Gate } from '../packages/hermes/src/domain/reduce'
import type { Connection } from '../packages/hermes/src/wire/link'
import type { ParsedEvent } from '../packages/hermes/src/wire/parse'

declare const turnBase: Omit<SettledTurn, 'items' | 'outcome'>
declare const gen: Generation
declare const conn: Connection
declare const id: SessionId

// 1. A settled turn with a running tool.
export const a: SettledTurn = { ...turnBase, outcome: { kind: 'complete' },
  // @ts-expect-error running is not a settled tool status
  items: [{ kind: 'tool', id: 't' as never, name: 'x', args: {}, status: { s: 'running', note: null } }] }
// 2. A settled turn with a waiting prompt.
export const b: SettledTurn = { ...turnBase, outcome: { kind: 'complete' },
  // @ts-expect-error waiting is not a settled prompt state
  items: [{ kind: 'prompt', id: 'p' as never, generation: gen, ask: { kind: 'clarify', question: 'q', choices: [], multi: false }, state: { s: 'waiting', error: null } }] }
// 3. A settled turn without an outcome.
// @ts-expect-error outcome is required
export const c: SettledTurn = { ...turnBase, items: [] }
// 4. An idle run carrying a turn.
// @ts-expect-error idle has no turn
export const d: Run = { state: 'idle', turn: null }
// 5. A plain string used as a SessionId.
// @ts-expect-error not branded
export const e: SessionId = 'abc'
// 6. A live gate with no cursor.
// @ts-expect-error cursor is required
export const f: Gate = { at: 'live', subscriptionId: 's' }
// 7. A replay plan with no cursor to replay from.
// @ts-expect-error from is required
export const g: Gate = { at: 'attaching', attempt: 1, parked: [], plan: { mode: 'replay' } }
// 8. A detached gate that parks frames.
// @ts-expect-error detached has no parked list
export const h: Gate = { at: 'detached', why: 'new', cursor: null, parked: [] }
// 9. A stray `all` key on approval.respond.
// @ts-expect-error closed key set from the generated contract
void conn.call('approval.respond', { session_id: 's', execution_generation: 1, prompt_id: 'p', choice: 'once', all: true })
// 10. A published session with no `sync`.
// @ts-expect-error sync is required on the published value
export const i: Session = { id, title: '', cwd: null, history: [], earlier: 'none', run: { state: 'idle' }, outbox: [] }
// 11. A reconnect that does not say whether it may start the gateway.
// @ts-expect-error start is required
export const j: Command = { do: 'reconnect' }
// 12. A waiting link with a reason that blocks.
// @ts-expect-error auth is a blocked reason, not a waiting one
export const k: Link = { state: 'waiting', attempt: 1, retryAt: 0, why: 'auth', message: '' }
// 13. A skipped session frame that still carries an event.
// @ts-expect-error a skipped frame has event null
export const l: ParsedEvent = { scope: 'session', sessionId: id, type: 'x', stamp: { epoch: 'e', seq: 1, generation: null }, event: { type: 'thinking' }, skipped: 'unshown' }

// The legal forms of the calls the attach sequence makes compile against the generated contract.
void conn.call('approval.respond', { session_id: 's', execution_generation: 1, prompt_id: 'p', choice: 'once' })
void conn.call('session.events.since', { session_id: 's', last_seen: 4, replay_epoch: 'e' })
void conn.call('session.resume', { session_id: 's', omit_messages: true, defer_history: true })
void conn.call('session.resume', { session_id: 's', display_projection: true })
void conn.call('session.transcript', { session_id: 's', order: 'latest', limit: 200 })
void conn.call('session.list', { scope: 'live' })
void conn.call('session.detach', { session_id: 's', subscription_id: 'x' })
export const ok: Gate = { at: 'attaching', attempt: 1, parked: [], plan: { mode: 'replay', from: { epoch: 'e', seq: 4 } } }
