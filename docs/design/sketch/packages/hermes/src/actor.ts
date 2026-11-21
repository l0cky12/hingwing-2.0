/**
 * One session. The single owner of its `Tracked` state, which holds the content, the attach
 * lifecycle (`Gate`) and the fencing tokens. Every change is one `reduce`. This class is the thin
 * shell that makes the gateway calls a state asks for and feeds the replies back in as inputs.
 * Private to `@highwing/hermes`. The hub creates one per session and routes events to it.
 */
import type { ServerRequest, SessionInput, Tracked } from './domain/reduce'
import type { PromptId, PromptReply, Session, SessionId } from './domain/session'
import type { Clock, Connection } from './wire/link'

/** A command that could not be carried out. A value, not an exception, so it crosses IPC unchanged. */
export interface Refusal {
  readonly kind: 'offline' | 'not-attached' | 'stale' | 'conflict' | 'rejected' | 'unsupported'
  /** Plain words for the user. */
  readonly message: string
}
export type Outcome<T = void> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: Refusal }

export interface ActorDeps {
  readonly conn: Connection
  readonly clock: Clock
  /** Called with each new published value. */
  readonly publish: (session: Session) => void
  /** The hub's one path for a server request this build cannot show: declines it and files the notice. */
  readonly refuse: (request: ServerRequest) => void
}

export class SessionActor {
  /** The only mutable field. Everything the actor knows about attach is in `tracked.gate`. */
  private tracked: Tracked

  constructor(readonly id: SessionId, private readonly deps: ActorDeps) {
    throw new Error('not implemented')
  }

  /** The last published value, built by `sessionOf`. */
  get session(): Session {
    throw new Error('not implemented')
  }

  /**
   * From the hub's router: a frame of this session's stream, a `session.replay_gap`, or a server
   * request that was refused. Whether a frame is applied, parked or dropped is the gate's decision
   * in `reduce`.
   */
  feed(input: Extract<SessionInput, { in: 'event' | 'gap' | 'declined' }>): void {
    throw new Error('not implemented')
  }

  /**
   * Ask for this session to be attached on the current socket. Safe to call any number of times and
   * at any point. It only steps `{in: 'attach'}` when the link is online. The reducer ignores it
   * unless the gate is detached.
   */
  attach(): void {
    throw new Error('not implemented')
  }

  /** The link changed. Not online -> step `link.lost`. Online -> `attach()`. Either way the sync may differ, so republish. */
  linkChanged(): void {
    throw new Error('not implemented')
  }

  /** The only path to `reduce`. */
  private step(input: SessionInput): void {
    // TODO before = tracked.gate; tracked = reduce(tracked, input); after = tracked.gate.
    //   after is attaching with an attempt number `before` did not have -> runAttach(after).
    //     This is the only trigger for attach calls. A first open, a reconnect, a gap, a hole and a
    //     snapshot_required all arrive here as an attaching gate with a new attempt.
    //   after just became live -> resubmit every outbox entry still 'sending' with its original inputId
    //     (the gateway's duplicate guard makes a second delivery a no-op), and deps.refuse each entry of
    //     the snapshot's openRequests.
    //   next = sessionOf(tracked, conn.link, last published); if it changed, deps.publish(next).
    throw new Error('not implemented')
  }

  /** The gateway calls of one attach attempt. Never touches state except through `step`. */
  private async runAttach(gate: Extract<Tracked['gate'], { at: 'attaching' }>): Promise<void> {
    // TODO plan replay (a reconnect that holds a cursor):
    //     since  = conn.call('session.events.since', {session_id, last_seen: from.seq, replay_epoch: from.epoch})
    //     resume = conn.call('session.resume', {session_id, omit_messages: true, defer_history: true})
    //     // Both are written before either is awaited. The gateway handles calls in arrival order, so it
    //     // records the replay cursor first and the resume joins the fanout from exactly that point
    //     // (gateway/session_controls.py:661, :805-822). A snapshot_required answer costs a second resume.
    //     [replay, snapshot] = await Promise.all([since, resume])
    //     step({in: 'attached', attempt, replay: parseReplay(replay), snapshot: parseSnapshot(snapshot)})
    //   plan open or rebuild:
    //     snapshot = await conn.call('session.resume', {session_id, display_projection: true})
    //     // History comes inline. The gateway reads these rows and the watermark under one lock
    //     // (gateway/session_authority.py:390-412), so no stored turn can also arrive as events.
    //     step({in: 'attached', attempt, replay: null, snapshot: parseSnapshot(snapshot)})
    // TODO Offline    -> nothing. linkChanged() moves the gate to detached, and the next socket attaches again.
    //      RpcRefusal -> step({in: 'attach.failed', attempt, refused: plain words}).
    //      A fourth attempt within 60 s -> step attach.failed with "Hermes keeps restarting this chat", so a
    //      rebuild loop ends in words and a Retry button.
    throw new Error('not implemented')
  }

  /**
   * Commands. Each one refuses with `offline` unless the gate is live. None of them takes a fencing
   * token: the actor reads generation and revision from its own state.
   */
  send(text: string): Promise<Outcome> {
    // TODO inputId = randomUUID(); step(local send); call prompt.submit {session_id, text, input_id}.
    //   Reply -> step(local send.admitted). RpcRefusal -> step(local send.failed). Offline -> leave it
    //   'sending'; the step that makes the gate live resubmits it. A turn that is running makes the
    //   gateway answer 'queued'.
    throw new Error('not implemented')
  }

  stop(): Promise<Outcome> {
    // TODO needs run.state === 'running'. step(local stop); call session.interrupt {session_id,
    //   execution_generation: run.generation}. stale_generation means the turn already ended: ok.
    throw new Error('not implemented')
  }

  answer(promptId: PromptId, reply: PromptReply): Promise<Outcome> {
    // TODO find the prompt in run.turn; refuse 'stale' unless it is waiting. step(local answer).
    //   approval -> approval.respond {session_id, execution_generation: prompt.generation, prompt_id, choice}
    //   clarify  -> clarify.respond  {session_id, execution_generation: prompt.generation, prompt_id, answer}
    //   resolved -> step(answer.resolved byUs true); already_resolved -> byUs false; refusal -> answer.failed.
    throw new Error('not implemented')
  }

  /** Rename and archive. One `request_id` per user intent, reused when a revision conflict forces a retry. */
  mutate(change: { readonly title: string } | { readonly archived: boolean }): Promise<Outcome> {
    // TODO call session.mutate {session_id, request_id, expected_revision: fence.revision, operation, payload}.
    //   On a revision conflict, read the fresh revision from the refusal or a session.info and retry once.
    throw new Error('not implemented')
  }

  loadEarlier(): Promise<Outcome> {
    // TODO needs fence.older. step(local earlier.requested); read session.transcript {session_id,
    //   order: 'latest', limit: 200, cursor}. A page can begin in the middle of a turn, so read on (at most
    //   3 pages) until the rows begin at a user row, then step({in: 'earlier', page: parseTranscript(pages)}).
    //   Rows that are already shown are dropped by row id in the reducer. That is safe here and only
    //   here: rows older than the snapshot's are archived and do not change.
    throw new Error('not implemented')
  }

  /** `session.detach` with the gate's subscription id. The hub calls it when nothing retains the session, then drops the actor. */
  detach(): Promise<void> {
    throw new Error('not implemented')
  }
}
