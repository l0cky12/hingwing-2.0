import { SessionActor } from '../../src/actor'
import type { Admission } from '../../src/domain/queue'
import type { SessionEvent } from '../../src/domain/reduce'
import type { BusyMode, Generation, Link, SessionId } from '../../src/domain/session'
import { runSessionCommand, type Hub, type SessionCommand } from '../../src/session-commands'
import { manualClock, settle } from '../../src/testing/clock'
import { RpcRefusal, type Calls } from '../../src/wire/link'

export const ID = 's1' as SessionId
export const EPOCH = 'e1'

export interface Call { readonly method: string; readonly params: Record<string, unknown>; resolve(result: unknown): void; reject(error: Error): void }

export const refusal = (reason: string, field: string | null = null) => new RpcRefusal(4001, reason, reason, null, null, field)

export const started: SessionEvent = { type: 'turn.started', turnId: null, admissionId: null, requestText: null }

/** One actor, attached, whose calls wait until the test answers them. */
export async function stage({ watched = false, hub: over = {} }: { readonly watched?: boolean; readonly hub?: Partial<Hub> } = {}) {
  const calls: Call[] = []
  const link: Link = { state: 'online' }
  let ids = 0
  let seq = 0
  const conn: Calls = {
    link, clarifyBatch: false,
    call: (method: string, params: unknown) => new Promise<never>((resolve, reject) => {
      calls.push({ method, params: params as Record<string, unknown>, resolve: resolve as (result: unknown) => void, reject })
    }),
    respond: () => {}
  }
  const actor = new SessionActor(ID, { conn, clock: manualClock(), publish: () => {}, bridge: () => {}, mintId: () => `id-${++ids}`, watched: () => watched })
  const hub: Hub = {
    settledCatalog: async () => [], retitle: () => {}, drop: () => {}, refreshSoon: () => {},
    settledRelay: async () => {}, mentioned: () => [], relay: () => {}, branchPins: new Map(), branched: () => {},
    uploads: { read: async () => null }, ...over
  }
  const answer = async (method: string, result: unknown) => {
    const call = calls.find(held => held.method === method)
    if (call === undefined) throw new Error(`no ${method} call is waiting. Waiting: ${calls.map(held => held.method).join(', ') || 'none'}`)
    calls.splice(calls.indexOf(call), 1)
    if (result instanceof Error) call.reject(result)
    else call.resolve(result)
    await settle()
    return call
  }
  const event = (sessionEvent: SessionEvent, generation: number | null = 1) =>
    actor.feed({ in: 'event', frame: { stamp: { epoch: EPOCH, seq: ++seq, generation: generation as Generation | null }, event: sessionEvent, seenAt: null } })
  actor.attach()
  await answer('session.resume', {
    session_id: ID, stored_session_id: ID, messages: [], display_messages: [], message_count: 0, running: false, authority_epoch: 1, replay_epoch: EPOCH,
    last_sequence: 0, subscription_id: 'sub-1', revision: 3, execution_generation: 0, pending: [], prompts: [], info: {}, open_requests: []
  })
  return {
    actor, calls, answer, event,
    command: (command: SessionCommand) => runSessionCommand(actor.port, command, hub),
    list: (...queue: Admission[]) => event({ type: 'meta', queue }, null),
    tune: (busy: BusyMode) => actor.port.act({ did: 'tuned', tuning: { busy } }),
    sent: () => calls.filter(call => call.method !== 'session.stats').map(call => [call.method, call.params] as const)
  }
}
