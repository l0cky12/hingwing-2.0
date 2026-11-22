/**
 * One session. The single owner of its `Tracked` state, which holds the content, the attach
 * lifecycle (`Gate`) and the fencing tokens. Every change is one `reduce`. This class is the thin
 * shell that makes the gateway calls a state asks for and feeds the replies back in as inputs.
 * Private to `@highwing/hermes`. The hub creates one per session and routes events to it.
 */
import { emptyTracked, reduce, sessionOf, type Gate, type LocalAction, type ServerRequest, type SessionInput, type Tracked } from './domain/reduce'
import type { InputId, PromptId, PromptReply, Session, SessionId } from './domain/session'
import { Offline, RpcRefusal, type Clock, type Connection } from './wire/link'
import { parseReplay, parseSnapshot, parseTranscript } from './wire/parse'

/** A command that could not be carried out. A value, not an exception, so it crosses IPC unchanged. */
export interface Refusal {
  readonly kind: 'offline' | 'not-attached' | 'stale' | 'conflict' | 'rejected' | 'unsupported'
  /** Plain words for the user. */
  readonly message: string
}
export type Outcome<T = void> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: Refusal }

export const DONE: Outcome = { ok: true, value: undefined }
export const refused = (kind: Refusal['kind'], message: string): Outcome<never> => ({ ok: false, refusal: { kind, message } })

/** The gateway's reason for a refusal, in words for the user and as the kind a caller can branch on. */
const REFUSALS: Readonly<Record<string, Refusal>> = {
  permission_denied: { kind: 'not-attached', message: "Hermes won't let Highwing do that in this chat." },
  not_found: { kind: 'rejected', message: 'Hermes no longer has this chat.' },
  stale_generation: { kind: 'stale', message: 'That turn has already ended.' },
  revision_conflict: { kind: 'conflict', message: 'This chat changed somewhere else. Try again.' },
  session_busy: { kind: 'rejected', message: 'Hermes is busy with this chat. Try again in a moment.' },
  runtime_draining: { kind: 'rejected', message: 'Hermes is restarting. Try again in a moment.' },
  invalid_params: { kind: 'rejected', message: 'Hermes did not accept the request.' }
}
const NOT_CONNECTED: Refusal = { kind: 'offline', message: "Highwing isn't connected to this chat right now." }
const DROPPED_ANSWER = 'The connection dropped before Hermes confirmed your answer.'

export function refusalOf(error: unknown): Refusal {
  if (error instanceof Offline) return NOT_CONNECTED
  if (error instanceof RpcRefusal) return REFUSALS[error.reason ?? ''] ?? { kind: 'rejected', message: `Hermes refused: ${error.message}` }
  throw error
}

/** A session that restarts its attach this often inside the window is told to stop, in words. */
export const RESTART_LIMIT = { count: 4, withinMs: 60_000 } as const
const KEEPS_RESTARTING = 'Hermes keeps restarting this chat.'
const EARLIER = { pageRows: 200, pages: 3 } as const

type Attaching = Extract<Gate, { at: 'attaching' }>

export interface ActorDeps {
  readonly conn: Connection
  readonly clock: Clock
  /** Called with each new published value, and the one it replaces. */
  readonly publish: (session: Session, previous: Session) => void
  /** The hub's one path for a server request this build cannot show: declines it and files the notice. */
  readonly refuse: (request: ServerRequest) => void
  /** Mints an idempotency key: the `input_id` of a message, the `request_id` of a mutation. */
  readonly mintId: () => string
}

export class SessionActor {
  /** The only state. Everything the actor knows about attach is in `tracked.gate`. */
  private tracked: Tracked
  private published: Session
  /** When each attach that restarted a live or attaching session began. Time is not a reducer input. */
  private restarts: readonly number[] = []

  constructor(readonly id: SessionId, private readonly deps: ActorDeps) {
    this.tracked = emptyTracked(id)
    this.published = sessionOf(this.tracked, deps.conn.link, null)
  }

  /** The last published value, built by `sessionOf`. */
  get session(): Session {
    return this.published
  }

  /**
   * From the hub's router: a frame of this session's stream, a `session.replay_gap`, or a server
   * request that was refused. Whether a frame is applied, parked or dropped is the gate's decision
   * in `reduce`.
   */
  feed(input: Extract<SessionInput, { in: 'event' | 'gap' | 'declined' }>): void {
    this.step(input)
  }

  /**
   * Ask for this session to be attached on the current socket. Safe to call any number of times and
   * at any point. It only steps `{in: 'attach'}` when the link is online. The reducer ignores it
   * unless the gate is detached.
   */
  attach(): void {
    if (this.deps.conn.link.state === 'online') this.step({ in: 'attach' })
  }

  /** The link changed. Not online -> step `link.lost`. Online -> `attach()`. Either way the sync may differ, so republish. */
  linkChanged(): void {
    if (this.deps.conn.link.state === 'online') this.attach()
    else this.step({ in: 'link.lost' })
    this.publish()
  }

  /** The only path to `reduce`. */
  private step(input: SessionInput): void {
    const before = this.tracked.gate
    this.tracked = reduce(this.tracked, input)
    const after = this.tracked.gate
    this.publish()
    if (after.at === 'attaching' && !(before.at === 'attaching' && before.attempt === after.attempt)) {
      void this.runAttach(after, before.at !== 'detached')
    } else if (after.at === 'live' && before.at !== 'live') {
      // A message whose submit died with the last socket. The gateway's duplicate guard makes a second delivery a no-op.
      for (const entry of this.tracked.content.outbox) if (entry.state.s === 'sending') void this.submit(entry.inputId, entry.text)
    }
  }

  private act(action: LocalAction): void {
    this.step({ in: 'local', action })
  }

  private publish(): void {
    const next = sessionOf(this.tracked, this.deps.conn.link, this.published)
    const previous = this.published
    if (next === previous) return
    this.published = next
    this.deps.publish(next, previous)
  }

  /** The gateway calls of one attach attempt. Never touches state except through `step`. */
  private async runAttach({ attempt, plan }: Attaching, restart: boolean): Promise<void> {
    const { conn, clock } = this.deps
    const session_id = this.id
    if (restart) {
      const now = clock.now()
      this.restarts = [...this.restarts.filter(at => now - at < RESTART_LIMIT.withinMs), now]
      if (this.restarts.length >= RESTART_LIMIT.count) return this.step({ in: 'attach.failed', attempt, refused: KEEPS_RESTARTING })
    }
    try {
      if (plan.mode === 'replay') {
        // Both are written before either is awaited. The gateway handles calls in arrival order, so it
        // records the replay cursor first and the resume joins the fanout from exactly that point
        // (Hermes's gateway/session_controls.py:805-822 and :661, gateway/session_events.py:114-124).
        const since = conn.call('session.events.since', { session_id, last_seen: plan.from.seq, replay_epoch: plan.from.epoch })
        const resume = conn.call('session.resume', { session_id, omit_messages: true, defer_history: true })
        const [replay, snapshot] = await Promise.all([since, resume])
        this.attached(attempt, parseSnapshot(snapshot), parseReplay(replay))
      } else {
        // History comes inline. The gateway reads these rows and the watermark under one lock
        // (Hermes's gateway/session_authority.py:390-412), so no stored turn can also arrive as events.
        this.attached(attempt, parseSnapshot(await conn.call('session.resume', { session_id, display_projection: true })), null)
      }
    } catch (error) {
      // Offline: `linkChanged` moves the gate to detached, and the next socket attaches again.
      if (!(error instanceof Offline)) this.step({ in: 'attach.failed', attempt, refused: refusalOf(error).message })
    }
  }

  private attached(attempt: number, snapshot: ReturnType<typeof parseSnapshot>, replay: ReturnType<typeof parseReplay> | null): void {
    this.step({ in: 'attached', attempt, snapshot, replay })
    const { gate } = this.tracked
    if (gate.at === 'live' && gate.subscriptionId === snapshot.subscriptionId) snapshot.openRequests.forEach(this.deps.refuse)
  }

  private offline(): Outcome<never> | null {
    return this.tracked.gate.at === 'live' ? null : { ok: false, refusal: NOT_CONNECTED }
  }

  /**
   * Commands. Each one refuses with `offline` unless the gate is live. None of them takes a fencing
   * token: the actor reads generation and revision from its own state.
   */
  send(text: string): Promise<Outcome> {
    const offline = this.offline()
    if (offline !== null) return Promise.resolve(offline)
    const inputId = this.deps.mintId() as InputId
    this.act({ did: 'send', inputId, text })
    return this.submit(inputId, text)
  }

  /** A turn that is running makes the gateway answer `queued`. A submit the socket dropped stays `sending` for the next attach. */
  private async submit(inputId: InputId, text: string): Promise<Outcome> {
    try {
      const receipt = await this.deps.conn.call('prompt.submit', { session_id: this.id, text, input_id: inputId })
      if ('admission_id' in receipt) this.act({ did: 'send.admitted', inputId, admissionId: receipt.admission_id, status: receipt.status })
      else this.act({ did: 'send.discarded', inputId })
      return DONE
    } catch (error) {
      if (error instanceof Offline) return DONE
      const refusal = refusalOf(error)
      this.act({ did: 'send.failed', inputId, message: refusal.message })
      return { ok: false, refusal }
    }
  }

  discard(inputId: InputId): Outcome {
    this.act({ did: 'send.discarded', inputId })
    return DONE
  }

  async stop(): Promise<Outcome> {
    const { run } = this.tracked.content
    const offline = this.offline()
    if (offline !== null) return offline
    if (run.state !== 'running') return refused('stale', 'Nothing is running in this chat.')
    this.act({ did: 'stop' })
    try {
      await this.deps.conn.call('session.interrupt', { session_id: this.id, execution_generation: run.generation })
      return DONE
    } catch (error) {
      const refusal = refusalOf(error)
      // The turn ended before the Stop arrived.
      return refusal.kind === 'stale' ? DONE : { ok: false, refusal }
    }
  }

  async answer(promptId: PromptId, reply: PromptReply): Promise<Outcome> {
    const { run } = this.tracked.content
    const offline = this.offline()
    if (offline !== null) return offline
    const prompt = run.state === 'running' ? run.turn.items.find(item => item.kind === 'prompt' && item.id === promptId) : undefined
    if (prompt?.kind !== 'prompt' || prompt.state.s !== 'waiting') return refused('stale', 'That question is no longer open.')
    this.act({ did: 'answer', promptId, reply })
    const fence = { session_id: this.id, execution_generation: prompt.generation, prompt_id: promptId }
    try {
      const { status } = await (prompt.ask.kind === 'approval'
        ? this.deps.conn.call('approval.respond', { ...fence, choice: reply.value })
        : this.deps.conn.call('clarify.respond', { ...fence, answer: reply.value }))
      this.act({ did: 'answer.resolved', promptId, byUs: status === 'resolved' })
      return DONE
    } catch (error) {
      const refusal = refusalOf(error)
      this.act({ did: 'answer.failed', promptId, message: refusal.kind === 'offline' ? DROPPED_ANSWER : refusal.message })
      return { ok: false, refusal }
    }
  }

  /** Rename and archive. One `request_id` per user intent, reused when a revision conflict forces a retry. */
  async mutate(change: { readonly title: string } | { readonly archived: boolean }): Promise<Outcome> {
    const offline = this.offline()
    if (offline !== null) return offline
    const request_id = this.deps.mintId()
    const operation = 'title' in change ? 'rename' : 'archive'
    const commit = (expected_revision: number) =>
      this.deps.conn.call('session.mutate', { session_id: this.id, request_id, expected_revision, operation, payload: { ...change } })
    try {
      await commit(this.tracked.fence.revision).catch((error: unknown) => {
        // The refusal carries the fresh revision (Hermes's gateway/session_controls.py:915-920), so one retry needs no read.
        if (error instanceof RpcRefusal && error.reason === 'revision_conflict' && error.revision !== null) return commit(error.revision)
        throw error
      })
      return DONE
    } catch (error) {
      return { ok: false, refusal: refusalOf(error) }
    }
  }

  async loadEarlier(): Promise<Outcome> {
    const { older } = this.tracked.fence
    const offline = this.offline()
    if (offline !== null) return offline
    if (older === null) return refused('rejected', 'There is nothing earlier in this chat.')
    this.act({ did: 'earlier.requested' })
    const pages: Parameters<typeof parseTranscript>[0][number][] = []
    try {
      // A page can begin in the middle of a turn, so read on until the rows begin at a user row.
      for (let cursor = older.cursor; pages.length < EARLIER.pages;) {
        const page = await this.deps.conn.call('session.transcript', {
          session_id: this.id, order: 'latest', limit: EARLIER.pageRows, ...(cursor === null ? {} : { cursor })
        })
        pages.push(page)
        if (page.next_cursor === null || page.rows[0]?.role === 'user') break
        cursor = page.next_cursor
      }
      this.step({ in: 'earlier', page: parseTranscript(pages) })
      return DONE
    } catch (error) {
      const refusal = refusalOf(error)
      this.step({ in: 'earlier', page: { turns: [], unfinished: null, older } })
      return { ok: false, refusal }
    }
  }

  /** `session.detach` with the gate's subscription id. The hub calls it when nothing retains the session, then drops the actor. */
  async detach(): Promise<void> {
    const { gate } = this.tracked
    if (gate.at !== 'live') return
    await this.deps.conn.call('session.detach', { session_id: this.id, subscription_id: gate.subscriptionId }).catch(refusalOf)
  }
}
