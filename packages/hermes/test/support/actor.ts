import { SessionActor } from '../../src/actor'
import type { Admission } from '../../src/domain/queue'
import type { SessionEvent } from '../../src/domain/reduce'
import type { BusyMode, Generation, Link, SessionId } from '../../src/domain/session'
import { runSessionCommand, type Hub, type SessionCommand } from '../../src/session-commands'
import { manualClock, settle } from '../../src/testing/clock'
import { Offline, RpcRefusal, type Calls } from '../../src/wire/link'

export const ID = 's1' as SessionId
const READS: ReadonlySet<string> = new Set(['session.stats', 'process.list', 'session.control.read'])
export const EPOCH = 'e1'

interface Call { readonly method: string; readonly params: Record<string, unknown>; resolve(result: unknown): void; reject(error: Error): void }

export const refusal = (reason: string, field: string | null = null) => new RpcRefusal(4001, reason, reason, null, null, field)
export const started: SessionEvent = { type: 'turn.started', turnId: null, admissionId: null, requestText: null }
const SNAPSHOT = {
  session_id: ID, stored_session_id: ID, messages: [], display_messages: [], message_count: 0, running: false, authority_epoch: 1, replay_epoch: EPOCH,
  last_sequence: 0, subscription_id: 'sub-1', revision: 3, execution_generation: 0, pending: [], prompts: [], info: {}, open_requests: []
}

export async function stage({ watched = false, hub: over = {} }: { readonly watched?: boolean; readonly hub?: Partial<Hub> } = {}) {
  const calls: Call[] = []
  const state: { link: Link } = { link: { state: 'online' } }
  let ids = 0
  let seq = 0
  const conn: Calls = {
    get link() { return state.link },
    clarifyBatch: false,
    call: (method: string, params: unknown) => new Promise<never>((resolve, reject) => {
      calls.push({ method, params: params as Record<string, unknown>, resolve: resolve as (result: unknown) => void, reject })
    }),
    respond: () => {}
  }
  const actor = new SessionActor(ID, { conn, clock: manualClock(), publish: () => {}, bridge: () => {}, mintId: () => `id-${++ids}`, watched: () => watched })
  const hub: Hub = {
    settledCatalog: async () => [], retitle: () => {}, pin: () => {}, drop: () => {}, refreshSoon: () => {},
    settledRelay: async () => {}, mentioned: () => [], relay: () => {}, branchPins: new Map(), branched: () => {}, gone: () => {},
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
  const drop = () => {
    state.link = { state: 'waiting', attempt: 1, retryAt: 1_000, why: 'dropped', message: 'Reconnecting to Hermes.' }
    actor.linkChanged()
    for (const call of calls.splice(0)) call.reject(new Offline('socket closed'))
  }
  actor.attach()
  await answer('session.resume', SNAPSHOT)
  return {
    actor, calls, answer, event, drop,
    online: () => {
      state.link = { state: 'online' }
      actor.linkChanged()
    },
    redial: async (held: Record<string, unknown> = {}, replay: 'kept' | 'lost' = 'kept') => {
      drop()
      state.link = { state: 'online' }
      actor.linkChanged()
      const lost = replay === 'lost'
      await answer('session.events.since', { events: [], latest_seq: seq, last_sequence: seq, epoch: EPOCH, replay_epoch: EPOCH, truncated: lost, snapshot_required: lost, count: 0 })
      await answer('session.resume', { ...SNAPSHOT, display_messages: undefined, messages_omitted: true, subscription_id: 'sub-2', last_sequence: seq, ...held })
      if (lost) await answer('session.resume', { ...SNAPSHOT, subscription_id: 'sub-2', last_sequence: seq, ...held })
    },
    command: (command: SessionCommand) => runSessionCommand(actor.port, command, hub),
    list: (...queue: Admission[]) => event({ type: 'meta', queue }, null),
    tune: (busy: BusyMode) => actor.port.act({ did: 'tuned', tuning: { busy } }),
    sent: () => calls.filter(call => !READS.has(call.method)).map(call => [call.method, call.params] as const),
    items: () => (actor.session.run.state === 'running' ? actor.session.run.turn.items : [])
  }
}
