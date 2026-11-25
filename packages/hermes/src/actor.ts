import type { Outcome, Refusal } from './domain/command'
import { emptyTracked, reduce, sessionOf, type BridgeRequest, type Fence, type Gate, type HistoryPage, type LocalAction, type SessionInput, type Tracked } from './domain/reduce'
import type { AdmissionId, Attachment, InputId, OutboxEntry, RequestId, Session, SessionContent, SessionId } from './domain/session'
import { Offline, RpcRefusal, type Calls, type Clock, type Method, type Requested, type RequestMethod, type Served } from './wire/link'
import { parseBusy, parseControl, parseProcesses, parseReplay, parseShown, parseSnapshot, parseStats } from './wire/parse'

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
  unknown_method: { kind: 'unsupported', message: "This Hermes doesn't support that." },
  fast_unavailable: { kind: 'rejected', message: "This chat's model has no fast mode." },
  export_too_large: { kind: 'rejected', message: 'This chat is too large for Hermes to export.' },
  process_not_found: { kind: 'stale', message: 'That process is no longer in this chat.' },
  unsupported_projection: { kind: 'unsupported', message: "Hermes runs this chat elsewhere, so it can't list or stop its processes." },
  goal_not_active: { kind: 'stale', message: 'This chat has no goal now.' },
  command_unavailable: { kind: 'unsupported', message: "Hermes can't run goals for this chat." },
  invalid_checkpoint: { kind: 'rejected', message: 'Hermes no longer keeps that checkpoint.' },
  unsupported_terminal_backend: { kind: 'unsupported', message: "Hermes keeps no checkpoints for this chat's terminal." }
}
const FENCE_REFUSALS: ReadonlySet<string> = new Set(['revision_conflict', 'stale_generation'])
const NOT_CONNECTED: Refusal = { kind: 'offline', message: "Highwing isn't connected to this chat right now." }

/**
 * Hermes answers an exact resend from its receipt and refuses any other resend under the same `request_id`: the
 * receipt's digest covers both fences (persistence/authority/runtime.py `mutation_receipt_key`).
 */
export interface Mutation {
  readonly request_id: string
  readonly operation: string
  readonly payload: Record<string, unknown>
  readonly expected_revision: number
  /** null: the operation needs none. */
  readonly expected_generation: number | null
}

export function refusalOf(error: unknown): Refusal {
  if (error instanceof Offline) return NOT_CONNECTED
  if (error instanceof RpcRefusal) return REFUSALS[error.reason ?? ''] ?? { kind: 'rejected', message: `Hermes refused: ${error.message}` }
  throw error
}

async function outcomeOf<T>(call: () => Promise<T>, explain: (error: unknown) => Refusal = refusalOf): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await call() }
  } catch (error) {
    return { ok: false, refusal: explain(error) }
  }
}

export const RESTART_LIMIT = { count: 4, withinMs: 60_000 } as const
const KEEPS_RESTARTING = 'Hermes keeps restarting this chat.'

type Attaching = Extract<Gate, { at: 'attaching' }>
type Sendable = Pick<OutboxEntry, 'inputId' | 'text' | 'apiText' | 'replaces'>

/** An attachment with its bytes, read from where Highwing keeps it. `mime` is what the bytes are, as Highwing sniffed them. */
export type Upload = Attachment & { readonly mime: string; readonly bytes: Uint8Array }

interface Resubmit { readonly attachments: readonly { readonly path: string; readonly mime: string }[]; readonly apiText: string | undefined }

interface Staged { readonly images: Resubmit['attachments']; readonly refs: readonly string[] }

const attachmentOf = ({ id, name, kind, size }: Upload): Attachment => ({ id, name, kind, size })
/** Hermes reads an image's type from its name before its bytes, so the type Highwing read from the bytes goes as `ext` and the name not at all. */
const IMAGE_EXT: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
const base64 = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')

function attachRefusal(name: string, error: unknown): Refusal {
  const refusal = refusalOf(error)
  return refusal.kind === 'offline'
    ? { kind: 'offline', message: `Highwing lost the connection while attaching ${name}, so nothing was sent.` }
    : { kind: refusal.kind, message: `Hermes refused ${name}: ${refusal.message}` }
}

export interface ActorDeps {
  /** The connection for a session of the socket's own profile, `conn.as(bot)` for a bot's. */
  readonly conn: Calls
  readonly clock: Clock
  readonly publish: (session: Session, previous: Session) => void
  readonly bridge: (request: BridgeRequest) => void
  readonly mintId: () => string
  readonly watched: () => boolean
}

export interface SessionPort {
  readonly id: SessionId
  readonly content: SessionContent
  readonly fence: Fence
  /** `reasons` words a refusal of this call that the general table would word wrongly. */
  call<M extends Method>(method: M, params: Served[M]['params'], reasons?: Readonly<Record<string, Refusal>>): Promise<Outcome<Served[M]['result']>>
  /** `invalid` stands in for the general refusal when Hermes names that payload field as the invalid one. */
  mutate(
    operation: string,
    payload: Record<string, unknown>,
    expectedGeneration: number | null,
    invalid?: { readonly field: string | null; readonly refusal: Refusal }
  ): Promise<Outcome<Served['session.mutate']['result']>>
  /**
   * The request exactly as the row built it, with the same one retry on a fence refusal. `sent` hears each request
   * as it goes. `explain` turns Hermes's refusal reason into the refusal at the moment it fails, and null keeps the general one.
   */
  resend(
    request: Mutation,
    sent: (request: Mutation) => void,
    explain: (reason: string) => Refusal | null
  ): Promise<Outcome<Served['session.mutate']['result']>>
  /** Answers a request with a result frame. Hermes sends no reply to one, so `ok` means only that the frame was written. */
  respond<M extends RequestMethod>(requestId: RequestId, method: M, result: Requested[M]['result']): Outcome
  /**
   * `apiText` is what the model reads when it differs from the `text` the thread and the stored history show. Each upload
   * is staged with Hermes first, in order. The message is sent only once every one is, and not at all when Hermes refuses one.
   */
  submit(text: string, apiText?: string, uploads?: readonly Upload[]): Promise<Outcome>
  /** Submits words the caller can no longer give back. Refused for any reason, they stay in the outbox as a failed message. */
  submitOrKeep(text: string): Promise<Outcome>
  /** Sends `text` in place of a queued row, as a new message at the back. A refusal leaves nothing in the outbox, unless the socket dropped before Hermes answered: the same replacement is then sent again. */
  replace(admissionId: AdmissionId, text: string): Promise<Outcome>
  act(action: LocalAction): void
  earlier(page: HistoryPage): void
  whenLive<T>(run: () => Promise<Outcome<T>>): Promise<Outcome<T>>
}

export class SessionActor {
  private tracked: Tracked
  private published: Session
  private restarts: readonly number[] = []
  private readonly resubmits = new Map<InputId, Resubmit>()
  readonly port: SessionPort

  constructor(readonly id: SessionId, private readonly deps: ActorDeps) {
    this.tracked = emptyTracked(id)
    this.published = sessionOf(this.tracked, deps.conn.link, null)
    const tracked = () => this.tracked
    this.port = {
      id,
      get content() { return tracked().content },
      get fence() { return tracked().fence },
      call: (method, params, reasons = {}) => outcomeOf(
        () => deps.conn.call(method, params),
        error => (error instanceof RpcRefusal && Object.hasOwn(reasons, error.reason ?? '') ? reasons[error.reason ?? ''] as Refusal : refusalOf(error))
      ),
      mutate: (operation, payload, expectedGeneration, invalid) => outcomeOf(
        () => this.mutation({ request_id: deps.mintId(), operation, payload, expected_revision: this.tracked.fence.revision, expected_generation: expectedGeneration }),
        error => (invalid !== undefined && error instanceof RpcRefusal && error.reason === 'invalid_params' && error.field === invalid.field ? invalid.refusal : refusalOf(error))
      ),
      resend: (request, sent, explain) => outcomeOf(
        () => this.mutation(request, sent),
        error => (error instanceof RpcRefusal ? explain(error.reason ?? '') ?? refusalOf(error) : refusalOf(error))
      ),
      respond: (requestId, method, result) => {
        try {
          deps.conn.respond(requestId, method, result)
          return DONE
        } catch (error) {
          return { ok: false, refusal: refusalOf(error) }
        }
      },
      submit: (text, apiText, uploads = []) => this.port.whenLive(() => (uploads.length === 0
        ? this.post(text, apiText, [], null)
        : this.stage(uploads).then(staged => (staged.ok ? this.post(text, apiText, uploads, staged.value) : staged)))),
      submitOrKeep: async text => {
        const sending = { inputId: deps.mintId() as InputId, text, attachments: [] }
        this.act({ did: 'send', ...sending })
        const sent = await this.port.whenLive(() => this.submit(sending))
        // `admit` has marked a message Hermes refused. One refused because the chat is not live never reached it.
        if (!sent.ok) this.act({ did: 'send.failed', inputId: sending.inputId, message: sent.refusal.message })
        return sent
      },
      replace: (admissionId, text) => {
        const sending = { inputId: deps.mintId() as InputId, text, attachments: [], replaces: admissionId }
        this.act({ did: 'send', ...sending })
        return this.admit(sending)
      },
      act: action => this.act(action),
      earlier: page => this.step({ in: 'earlier', page }),
      whenLive: run => (this.tracked.gate.at === 'live' ? run() : Promise.resolve({ ok: false, refusal: NOT_CONNECTED }))
    }
  }

  get session(): Session {
    return this.published
  }

  /** Whether the input moved the live cursor, as a frame seen for the first time and in order does. */
  feed(input: Extract<SessionInput, { in: 'event' | 'gap' | 'request' | 'declined' }>): boolean {
    const before = this.tracked.gate
    this.step(input)
    const after = this.tracked.gate
    return before.at === 'live' && after.at === 'live' && after.cursor !== before.cursor
  }

  attach(): void {
    if (this.deps.conn.link.state === 'online') this.step({ in: 'attach' })
  }

  watchBegan(): void {
    if (this.tracked.gate.at === 'live') this.readFacts()
  }

  linkChanged(): void {
    if (this.deps.conn.link.state === 'online') this.attach()
    else this.step({ in: 'link.lost' })
    this.publish()
  }

  private step(input: SessionInput): void {
    const before = this.tracked.gate
    const wasRunning = this.tracked.content.run.state === 'running'
    const listed = this.tracked.fence.heard.processes
    this.tracked = reduce(this.tracked, input)
    for (const inputId of this.resubmits.keys()) if (!this.tracked.content.outbox.some(entry => entry.inputId === inputId)) this.resubmits.delete(inputId)
    const after = this.tracked.gate
    this.publish()
    const wentLive = after.at === 'live' && before.at !== 'live'
    if (wentLive || (after.at === 'live' && wasRunning && this.tracked.content.run.state === 'idle')) void this.readUsage()
    if (after.at === 'attaching' && !(before.at === 'attaching' && before.attempt === after.attempt)) {
      void this.runAttach(after, before.at !== 'detached')
    } else if (wentLive) {
      // A message whose call died with the last socket. The same call again is a no-op for one Hermes took: its duplicate guards are keyed on the ids the call carries.
      for (const entry of this.tracked.content.outbox) if (entry.state.s === 'sending') void this.admit(entry)
      if (this.deps.watched()) this.readFacts()
    } else if (after.at === 'live' && this.tracked.fence.heard.processes !== listed && this.deps.watched()) {
      void this.readProcesses()
    }
  }

  /** Each read answers on its own, so a slow one holds back no other. */
  private readFacts(): void {
    const { attaches: attempt, heard } = this.tracked.fence
    const session_id = this.id
    const read = (key: string) => this.port.call('config.get', { session_id, key })
    void Promise.all([read('show_reasoning'), read('busy')]).then(([shown, busy]) => {
      if (![shown, busy].some(answer => !answer.ok && answer.refusal.kind === 'offline')) {
        this.step({ in: 'facts', attempt, heard, tuning: { reasoning: shown.ok ? parseShown(shown.value) : null, busy: busy.ok ? parseBusy(busy.value) : null } })
      }
    })
    void this.port.call('session.control.read', { session_id }).then(control => {
      if (control.ok || control.refusal.kind !== 'offline') this.step({ in: 'facts', attempt, heard, control: control.ok ? parseControl(control.value.control) : null })
    })
    void this.readProcesses()
  }

  private async readProcesses(): Promise<void> {
    const { attaches: attempt, heard } = this.tracked.fence
    const listed = await this.port.call('process.list', { session_id: this.id })
    if (listed.ok || listed.refusal.kind !== 'offline') this.step({ in: 'facts', attempt, heard, processes: listed.ok ? parseProcesses(listed.value) : null })
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
    if (gate.at !== 'live' || gate.subscriptionId !== snapshot.subscriptionId) return
    for (const request of snapshot.openRequests) if (request.kind === 'bridge') this.deps.bridge(request)
  }

  private async readUsage(): Promise<void> {
    const asked = this.tracked.fence.totalsEpoch
    await this.deps.conn.call('session.stats', { session_id: this.id })
      .then(reply => this.step({ in: 'usage', usage: parseStats(reply), asked }), refusalOf)
  }

  private async submit(entry: Sendable): Promise<Outcome> {
    // Written before the submit, so the gateway answers it before the turn can build a new agent that counts from zero.
    void this.readUsage()
    return this.admit(entry)
  }

  private post(text: string, apiText: string | undefined, uploads: readonly Upload[], staged: Staged | null): Promise<Outcome> {
    const inputId = this.deps.mintId() as InputId
    if (staged !== null) {
      const { images, refs } = staged
      this.resubmits.set(inputId, { attachments: images, apiText: refs.length === 0 ? apiText : `${apiText ?? text}\n\n${refs.join('\n')}` })
    }
    const sending = { inputId, text, ...(apiText === undefined ? {} : { apiText }), attachments: uploads.map(attachmentOf) }
    this.act({ did: 'send', ...sending })
    return this.submit(sending)
  }

  /** `image.attach_bytes` only stages an image: the `prompt.submit` after it names the staged path. `file.attach` answers the reference the model reads. */
  private async stage(uploads: readonly Upload[]): Promise<Outcome<Staged>> {
    const images: Resubmit['attachments'][number][] = []
    const refs: string[] = []
    for (const upload of uploads) {
      try {
        if (upload.kind === 'image') {
          const staged = await this.deps.conn.call('image.attach_bytes', { session_id: this.id, content_base64: base64(upload.bytes), ext: IMAGE_EXT[upload.mime] ?? 'png' })
          if (!staged.attached || !staged.path) return refused('rejected', `Hermes didn't take ${upload.name}.`)
          images.push({ path: staged.path, mime: staged.mime })
        } else {
          const staged = await this.deps.conn.call('file.attach', { session_id: this.id, data_url: `data:${upload.mime};base64,${base64(upload.bytes)}`, name: upload.name })
          if (!staged.attached) return refused('rejected', `Hermes didn't take ${upload.name}.`)
          refs.push(staged.ref_text)
        }
      } catch (error) {
        return { ok: false, refusal: attachRefusal(upload.name, error) }
      }
    }
    return { ok: true, value: { images, refs } }
  }

  private async admit({ inputId, text, apiText, replaces }: Sendable): Promise<Outcome> {
    const resubmit = this.resubmits.get(inputId)
    const apiTextSent = resubmit === undefined ? apiText : resubmit.apiText
    // Asks for the clarify tool's questions as one request, which `requests` can hold. Without it each comes as a prompt of the turn.
    const batch = this.deps.conn.clarifyBatch ? { clarify_batch: true } : {}
    // A repeat of a replacement Hermes took answers the admission it made, only for the same row and id (gateway/session_queued_controls.py:212-233).
    const receipt = await (replaces === undefined
      ? this.port.call('prompt.submit', {
        session_id: this.id, text, input_id: inputId, ...(apiTextSent === undefined ? {} : { api_text: apiTextSent }),
        ...(resubmit === undefined || resubmit.attachments.length === 0 ? {} : { attachments: [...resubmit.attachments] }), ...batch
      })
      : this.port.call('prompt.replace_queued', { session_id: this.id, admission_id: replaces, submission_id: inputId, text }))
    if (receipt.ok) {
      // Hermes's pending list takes the entry of a row it holds. Nothing lists a message that was not admitted, or one that is already done.
      if (!('admission_id' in receipt.value) || receipt.value.status === 'terminal') this.act({ did: 'send.discarded', inputId })
      else this.act({ did: 'send.admitted', inputId, admissionId: receipt.value.admission_id })
      return DONE
    }
    if (replaces !== undefined) {
      // The editor still holds a refused edit's words, so the outbox keeps only one Hermes may have taken.
      if (receipt.refusal.kind !== 'offline') this.act({ did: 'send.discarded', inputId })
      return receipt
    }
    if (receipt.refusal.kind === 'offline') return DONE
    this.act({ did: 'send.failed', inputId, message: receipt.refusal.message })
    return receipt
  }

  private mutation(request: Mutation, sent?: (request: Mutation) => void) {
    const commit = (asked: Mutation) => {
      sent?.(asked)
      const { expected_generation, ...rest } = asked
      return this.deps.conn.call('session.mutate', { session_id: this.id, ...rest, ...(expected_generation === null ? {} : { expected_generation }) })
    }
    return commit(request).catch((error: unknown) => {
      // The refusal carries both fresh fences (Hermes's gateway/session_controls.py:915-920), so one retry needs no read.
      // Hermes checks the receipt before the fences (persistence/sqlite/authority/_mutation.py `mutate_runtime_session`), so a fence refusal means this request committed nothing.
      if (error instanceof RpcRefusal && FENCE_REFUSALS.has(error.reason ?? '') && error.revision !== null) {
        const { expected_generation: held } = request
        return commit({ ...request, expected_revision: error.revision, expected_generation: held === null ? null : error.generation ?? held })
      }
      throw error
    })
  }

  async detach(): Promise<void> {
    const { gate } = this.tracked
    if (gate.at !== 'live') return
    await this.deps.conn.call('session.detach', { session_id: this.id, subscription_id: gate.subscriptionId }).catch(refusalOf)
  }
}
