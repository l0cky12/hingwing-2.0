import type { ContextBreakdown, ModelConfirm, ModelMenu, Outcome, Refusal } from './domain/command'
import { emptyTracked, reduce, sessionOf, type Gate, type LocalAction, type ServerRequest, type SessionInput, type Tracked } from './domain/reduce'
import type { InputId, ModelOption, OutboxEntry, PromptId, PromptReply, Session, SessionId } from './domain/session'
import { Offline, RpcRefusal, type Calls, type Clock } from './wire/link'
import { parseContextBreakdown, parseModelMenu, parseModelReceipt, parseReplay, parseSnapshot, parseStats, parseTranscript } from './wire/parse'

export const DONE: Outcome = { ok: true, value: undefined }
export const refused = (kind: Refusal['kind'], message: string): Outcome<never> => ({ ok: false, refusal: { kind, message } })

const REFUSALS: Readonly<Record<string, Refusal>> = {
  permission_denied: { kind: 'not-attached', message: "Hermes won't let Highwing do that in this chat." },
  not_found: { kind: 'rejected', message: 'Hermes no longer has this chat.' },
  stale_generation: { kind: 'stale', message: 'That turn has already ended.' },
  revision_conflict: { kind: 'conflict', message: 'This chat changed somewhere else. Try again.' },
  session_busy: { kind: 'rejected', message: 'Hermes is busy with this chat. Try again in a moment.' },
  runtime_draining: { kind: 'rejected', message: 'Hermes is restarting. Try again in a moment.' },
  invalid_params: { kind: 'rejected', message: 'Hermes did not accept the request.' },
  unsupported_command: { kind: 'unsupported', message: "Hermes can't run that command from Highwing." },
  profile_mismatch: { kind: 'rejected', message: "Hermes isn't running that bot right now." },
  unknown_method: { kind: 'unsupported', message: "This Hermes doesn't support that." }
}
const FENCE_REFUSALS: ReadonlySet<string> = new Set(['revision_conflict', 'stale_generation'])
const MOVED_ON: Refusal = { kind: 'stale', message: 'This chat changed while Highwing was switching its model. Try again.' }
const GONE: Refusal = { kind: 'rejected', message: 'That message is no longer in this chat.' }
const NOT_CONNECTED: Refusal = { kind: 'offline', message: "Highwing isn't connected to this chat right now." }
const DROPPED_ANSWER = 'The connection dropped before Hermes confirmed your answer.'

export function refusalOf(error: unknown): Refusal {
  if (error instanceof Offline) return NOT_CONNECTED
  if (error instanceof RpcRefusal) return REFUSALS[error.reason ?? ''] ?? { kind: 'rejected', message: `Hermes refused: ${error.message}` }
  throw error
}

export const RESTART_LIMIT = { count: 4, withinMs: 60_000 } as const
const KEEPS_RESTARTING = 'Hermes keeps restarting this chat.'
const EARLIER = { pageRows: 200, pages: 3 } as const

type Attaching = Extract<Gate, { at: 'attaching' }>

export interface ActorDeps {
  /** The connection for a session of the socket's own profile, `conn.as(bot)` for a bot's. */
  readonly conn: Calls
  readonly clock: Clock
  readonly publish: (session: Session, previous: Session) => void
  readonly refuse: (request: ServerRequest) => void
  readonly mintId: () => string
}

/** A page that begins with a user row holds whole turns, so the read can stop there. */
const startsAtTurn = (page: { readonly rows: readonly { readonly role?: unknown }[] }) => page.rows[0]?.role === 'user'

export class SessionActor {
  private tracked: Tracked
  private published: Session
  private restarts: readonly number[] = []

  constructor(readonly id: SessionId, private readonly deps: ActorDeps) {
    this.tracked = emptyTracked(id)
    this.published = sessionOf(this.tracked, deps.conn.link, null)
  }

  get session(): Session {
    return this.published
  }

  feed(input: Extract<SessionInput, { in: 'event' | 'gap' | 'declined' }>): void {
    this.step(input)
  }

  attach(): void {
    if (this.deps.conn.link.state === 'online') this.step({ in: 'attach' })
  }

  linkChanged(): void {
    if (this.deps.conn.link.state === 'online') this.attach()
    else this.step({ in: 'link.lost' })
    this.publish()
  }

  private step(input: SessionInput): void {
    const before = this.tracked.gate
    const wasRunning = this.tracked.content.run.state === 'running'
    this.tracked = reduce(this.tracked, input)
    const after = this.tracked.gate
    this.publish()
    const wentLive = after.at === 'live' && before.at !== 'live'
    if (wentLive || (after.at === 'live' && wasRunning && this.tracked.content.run.state === 'idle')) void this.readUsage()
    if (after.at === 'attaching' && !(before.at === 'attaching' && before.attempt === after.attempt)) {
      void this.runAttach(after, before.at !== 'detached')
    } else if (wentLive) {
      // A message whose submit died with the last socket. The gateway's duplicate guard makes a second delivery a no-op.
      for (const entry of this.tracked.content.outbox) if (entry.state.s === 'sending') void this.admit(entry)
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
      if (!(error instanceof Offline)) this.step({ in: 'attach.failed', attempt, refused: refusalOf(error).message })
    }
  }

  private attached(attempt: number, snapshot: ReturnType<typeof parseSnapshot>, replay: ReturnType<typeof parseReplay> | null): void {
    this.step({ in: 'attached', attempt, snapshot, replay })
    const { gate } = this.tracked
    if (gate.at === 'live' && gate.subscriptionId === snapshot.subscriptionId) snapshot.openRequests.forEach(this.deps.refuse)
  }

  private async readUsage(): Promise<void> {
    const asked = this.tracked.fence.totalsEpoch
    await this.deps.conn.call('session.stats', { session_id: this.id })
      .then(reply => this.step({ in: 'usage', usage: parseStats(reply), asked }), refusalOf)
  }

  private async submit(entry: Pick<OutboxEntry, 'inputId' | 'text' | 'apiText'>): Promise<Outcome> {
    // Written before the submit, so the gateway answers it before the turn can build a new agent that counts from zero.
    void this.readUsage()
    return this.admit(entry)
  }

  private offline(): Outcome<never> | null {
    return this.tracked.gate.at === 'live' ? null : { ok: false, refusal: NOT_CONNECTED }
  }

  /** `apiText` is what the model reads when it differs from the `text` the thread and the stored history show. */
  send(text: string, apiText?: string): Promise<Outcome> {
    const offline = this.offline()
    if (offline !== null) return Promise.resolve(offline)
    const inputId = this.deps.mintId() as InputId
    const sending = { inputId, text, ...(apiText === undefined ? {} : { apiText }) }
    this.act({ did: 'send', ...sending })
    return this.submit(sending)
  }

  private async admit({ inputId, text, apiText }: Pick<OutboxEntry, 'inputId' | 'text' | 'apiText'>): Promise<Outcome> {
    try {
      const receipt = await this.deps.conn.call('prompt.submit', { session_id: this.id, text, input_id: inputId, ...(apiText === undefined ? {} : { api_text: apiText }) })
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

  /** Cuts the chat before the stored row, then sends `text`. The thread is cut only once Hermes has said yes. */
  async rewind(rowId: number, text: string): Promise<Outcome> {
    const offline = this.offline()
    if (offline !== null) return offline
    if (this.tracked.content.run.state === 'running') return refused('stale', 'Wait for the reply to finish, then try again.')
    try {
      await this.mutation('rewind', { target_message_id: rowId }, this.tracked.fence.generation ?? 0)
    } catch (error) {
      const vanished = error instanceof RpcRefusal && error.reason === 'invalid_params' && error.field === 'target_message_id'
      return { ok: false, refusal: vanished ? GONE : refusalOf(error) }
    }
    this.act({ did: 'rewound', rowId })
    return this.send(text)
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

  async mutate(change: { readonly title: string } | { readonly archived: boolean }): Promise<Outcome> {
    const offline = this.offline()
    if (offline !== null) return offline
    try {
      await this.mutation('title' in change ? 'rename' : 'archive', { ...change }, null)
      return DONE
    } catch (error) {
      return { ok: false, refusal: refusalOf(error) }
    }
  }

  async models(): Promise<Outcome<ModelMenu>> {
    const offline = this.offline()
    if (offline !== null) return offline
    try {
      // explicit_only leaves out providers that only look signed in through ambient credentials.
      return { ok: true, value: parseModelMenu(await this.deps.conn.call('model.options', { session_id: this.id, explicit_only: true })) }
    } catch (error) {
      return { ok: false, refusal: refusalOf(error) }
    }
  }

  async contextBreakdown(): Promise<Outcome<ContextBreakdown>> {
    const offline = this.offline()
    if (offline !== null) return offline
    try {
      return { ok: true, value: parseContextBreakdown(await this.deps.conn.call('session.context_breakdown', { session_id: this.id })) }
    } catch (error) {
      return { ok: false, refusal: refusalOf(error) }
    }
  }

  async pickModel(model: ModelOption, confirm: string | null): Promise<Outcome<ModelConfirm | null>> {
    const offline = this.offline()
    if (offline !== null) return offline
    const payload = { model: model.id, provider: model.provider, ...(confirm === null ? {} : { confirm }) }
    try {
      const receipt = parseModelReceipt(await this.mutation('model', payload, this.tracked.fence.generation ?? 0))
      switch (receipt.status) {
        case 'confirm':
          return { ok: true, value: receipt.confirm }
        case 'confirm-without-token':
          return refused('rejected', receipt.message)
        case 'deferred': {
          const { run } = this.tracked.content
          const during = receipt.during ?? (run.state === 'running' ? run.generation : null)
          if (during !== null) this.act({ did: 'model.deferred', model: { id: model.id, provider: model.provider }, during })
          return { ok: true, value: null }
        }
        case 'committed':
          return { ok: true, value: null }
      }
    } catch (error) {
      const refusal = refusalOf(error)
      return { ok: false, refusal: refusal.kind === 'stale' ? MOVED_ON : refusal }
    }
  }

  /** `generation`: the `expected_generation` an operation that needs one sends, as a model switch does. */
  private mutation(operation: string, payload: Record<string, unknown>, generation: number | null) {
    const request_id = this.deps.mintId()
    const commit = (expected_revision: number, expected_generation: number | null) => this.deps.conn.call('session.mutate', {
      session_id: this.id, request_id, expected_revision, operation, payload,
      ...(expected_generation === null ? {} : { expected_generation })
    })
    return commit(this.tracked.fence.revision, generation).catch((error: unknown) => {
      // The refusal carries both fresh fences (Hermes's gateway/session_controls.py:915-920), so one retry needs no read.
      if (error instanceof RpcRefusal && FENCE_REFUSALS.has(error.reason ?? '') && error.revision !== null) {
        return commit(error.revision, generation === null ? null : error.generation ?? generation)
      }
      throw error
    })
  }

  /** Runs one Hermes command in this chat and answers its directive as Hermes sent it. Rejects with what `refusalOf` reads. */
  dispatch(name: string, arg: string) {
    return this.deps.conn.call('command.dispatch', { session_id: this.id, name, ...(arg === '' ? {} : { arg }) })
  }

  async loadEarlier(): Promise<Outcome> {
    const { older } = this.tracked.fence
    const offline = this.offline()
    if (offline !== null) return offline
    if (older === null) return refused('rejected', 'There is nothing earlier in this chat.')
    this.act({ did: 'earlier.requested' })
    const pages: Parameters<typeof parseTranscript>[0][number][] = []
    try {
      for (let cursor = older.cursor; pages.length < EARLIER.pages;) {
        const page = await this.deps.conn.call('session.transcript', {
          session_id: this.id, order: 'latest', limit: EARLIER.pageRows, ...(cursor === null ? {} : { cursor })
        })
        pages.push(page)
        if (page.next_cursor === null || startsAtTurn(page)) break
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

  async detach(): Promise<void> {
    const { gate } = this.tracked
    if (gate.at !== 'live') return
    await this.deps.conn.call('session.detach', { session_id: this.id, subscription_id: gate.subscriptionId }).catch(refusalOf)
  }
}
