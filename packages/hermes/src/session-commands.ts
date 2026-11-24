import { DONE, refused, type Mutation, type SessionPort, type Upload } from './actor'
import type { Bot } from './domain/bots'
import type { Command, ModelConfirm, Outcome, Refusal, ResultOf } from './domain/command'
import type {
  AttachmentId, BranchId, HermesRequest, PromptId, PromptReply, RecordedReply, RequestId, RequestReply, SessionContent, SessionId, TurnId
} from './domain/session'
import { slashLineOf, type SlashCatalog, type SlashLine } from './domain/slash'
import type { Served } from './wire/link'
import { parseBranched, parseContextBreakdown, parseDirective, parseModelMenu, parseModelReceipt, parsePathMatches, parseShown, parseTranscript } from './wire/parse'

/** `versions` stays with the hub: reading a chat's versions must not attach it. */
export type SessionCommand = Exclude<Extract<Command, { readonly sessionId: SessionId }>, { readonly do: 'versions' }>

/** The exact request a branch key last sent, and the words of the message it branches from. */
export interface BranchPin { readonly request: Mutation; readonly text: string }

export interface Hub {
  settledCatalog(): Promise<SlashCatalog>
  retitle(id: SessionId, title: string): void
  drop(id: SessionId): void
  refreshSoon(): void
  settledRelay(): Promise<void>
  mentioned(id: SessionId, text: string): readonly Bot[]
  relay(id: SessionId, after: TurnId | null, to: Bot, text: string): void
  /** Branch keys -> their pins. The hub owns it, so a pin outlives an actor that was detached and made again. */
  readonly branchPins: Map<BranchId, BranchPin>
  branched(made: { readonly from: SessionId; readonly sessionId: SessionId; readonly text: string }): void
  /** Where a message's attachments are read from when it is sent. null: Highwing no longer holds it. */
  readonly uploads: { read(id: AttachmentId): Promise<Upload | null> }
}

type Row<C extends SessionCommand> = (port: SessionPort, command: C, hub: Hub) => Outcome<ResultOf<C>> | Promise<Outcome<ResultOf<C>>>

const MOVED_ON: Refusal = { kind: 'stale', message: 'This chat changed while Highwing was switching its model. Try again.' }
const GONE: Refusal = { kind: 'rejected', message: 'That message is no longer in this chat.' }
const DROPPED_ANSWER = 'The connection dropped before Hermes confirmed your answer.'
const CANT_BRANCH: Refusal = { kind: 'unsupported', message: "This Hermes can't branch a chat." }
const BRANCH_BUSY: Refusal = { kind: 'stale', message: 'Wait for the reply to finish, then branch.' }
const BRANCH_REFUSALS: Readonly<Record<string, Refusal>> = {
  unknown_method: CANT_BRANCH,
  runtime_coordination_required: { kind: 'unsupported', message: "Hermes can't branch this chat." },
  session_busy: BRANCH_BUSY
}
const NO_CHILD: Refusal = { kind: 'rejected', message: "Hermes made the chat but didn't say which one." }
const NOT_OPEN = refused('stale', 'That question is no longer open.')
const WRONG_ANSWER = refused('rejected', "That isn't an answer this question takes.")
const EARLIER = { pageRows: 200, pages: 3 } as const
const MENTION_WITH_ATTACHMENTS = "A message to another bot can't carry attachments. Remove them, or send it without the mention."
const UPLOAD_GONE = 'An attachment is no longer available. Remove it and attach it again.'
export const NOTHING_TO_SHOW: Outcome<string | null> = { ok: true, value: null }

const showing = (outcome: Outcome, words: string | null = null): Outcome<string | null> => (outcome.ok ? { ok: true, value: words } : outcome)

const holdsWholeTurns = (page: { readonly rows: readonly { readonly role?: unknown }[] }) => page.rows[0]?.role === 'user'

/** Hermes extends a cut at an assistant row through the tool rows after it (persistence/sqlite/authority/_mutation_publish.py `_branch_boundary`). */
function branchPoint(content: SessionContent, rowId: number): { readonly through: number; readonly text: string } | null {
  const turn = content.history.find(held => held.request?.rowId === rowId)
  return turn?.request == null ? null : { through: Math.max(rowId, ...turn.rows), text: turn.request.text }
}

function branchPin(port: SessionPort, rowId: number, branchId: BranchId): BranchPin | Outcome<never> {
  const { content, fence } = port
  const waiting = content.outbox.some(entry => entry.state.s !== 'failed')
  if (content.run.state === 'running' || waiting) return { ok: false, refusal: BRANCH_BUSY }
  const point = branchPoint(content, rowId)
  if (point === null) return { ok: false, refusal: GONE }
  const request = {
    request_id: branchId, operation: 'branch', payload: { through_message_id: point.through },
    expected_revision: fence.revision, expected_generation: fence.generation ?? 0
  }
  return { request, text: point.text }
}

/** A gone row, a bad branch payload and a Hermes without `branch` all refuse `invalid_params` (persistence/authority/runtime.py `parse_mutation` reads an unknown operation as a metadata edit), so only the chat's own history can tell them apart. */
function branchRefusal(port: SessionPort, reason: string, rowId: number): Refusal | null {
  if (Object.hasOwn(BRANCH_REFUSALS, reason)) return BRANCH_REFUSALS[reason] as Refusal
  if (reason === 'invalid_params') return branchPoint(port.content, rowId) === null ? GONE : CANT_BRANCH
  return null
}

const sessionCommands: { readonly [K in SessionCommand['do']]: Row<Extract<SessionCommand, { do: K }>> } = {
  send: async (port, { text, attachments = [] }, hub) => {
    const line = text.trimStart().startsWith('/') ? slashLineOf(text, await hub.settledCatalog()) : null
    if (line !== null) return runSlash(port, line, hub)
    if (text.includes('@')) await hub.settledRelay()
    const to = hub.mentioned(port.id, text)
    if (to.length === 0) {
      const read = await Promise.all(attachments.map(id => hub.uploads.read(id)))
      if (read.includes(null)) return refused('stale', UPLOAD_GONE)
      return showing(await port.submit(text, undefined, read as Upload[]))
    }
    if (attachments.length > 0) return refused('rejected', MENTION_WITH_ATTACHMENTS)
    const { run, history } = port.content
    const after = run.state === 'running' ? run.turn.id : history.at(-1)?.id ?? null
    for (const bot of to) hub.relay(port.id, after, bot, text)
    return NOTHING_TO_SHOW
  },

  rewind: (port, { rowId, text }) => port.whenLive(async () => {
    if (port.content.run.state === 'running') return refused('stale', 'Wait for the reply to finish, then try again.')
    const cut = await port.mutate('rewind', { target_message_id: rowId }, port.fence.generation ?? 0, { field: 'target_message_id', refusal: GONE })
    if (!cut.ok) return cut
    port.act({ did: 'rewound', rowId })
    return port.submit(text)
  }),

  /** Sends no title: Hermes names an untitled branch next in the parent's lineage, "Sort the invoices #2" (persistence/sqlite/authority/_mutation_publish.py `branch_in_transaction`). */
  branch: (port, { rowId, branchId }, hub) => port.whenLive<SessionId>(async () => {
    // A pinned request may have made its chat already, so it skips the local checks and Hermes's receipt answers it.
    const pin = hub.branchPins.get(branchId) ?? branchPin(port, rowId, branchId)
    if ('ok' in pin) return pin
    const { request, text } = pin
    const made = await port.resend(request, latest => void hub.branchPins.set(branchId, { request: latest, text }), reason => branchRefusal(port, reason, rowId))
    if (!made.ok) {
      // Hermes writes a receipt only with a commit, so a refused request leaves nothing to resend exactly.
      if (made.refusal.kind !== 'offline') hub.branchPins.delete(branchId)
      return made
    }
    const sessionId = parseBranched(made.value)
    if (sessionId === null) return { ok: false, refusal: NO_CHILD }
    hub.branched({ from: port.id, sessionId, text })
    hub.refreshSoon()
    return { ok: true, value: sessionId }
  }),

  stop: port => port.whenLive(async () => {
    const { run } = port.content
    if (run.state !== 'running') return refused('stale', 'Nothing is running in this chat.')
    port.act({ did: 'stop' })
    const stopped = await port.call('session.interrupt', { session_id: port.id, execution_generation: run.generation })
    return stopped.ok || stopped.refusal.kind === 'stale' ? DONE : stopped
  }),

  answer: (port, command) => port.whenLive(() =>
    ('requestId' in command ? answerRequest(port, command.requestId, command.reply) : answerPrompt(port, command.promptId, command.reply))),

  discard: (port, { inputId }) => {
    port.act({ did: 'send.discarded', inputId })
    return DONE
  },

  rename: (port, { title }, hub) => port.whenLive(async () => {
    const renamed = await port.mutate('rename', { title }, null)
    if (!renamed.ok) return renamed
    hub.retitle(port.id, title)
    return DONE
  }),

  archive: (port, { archived }, hub) => port.whenLive(async () => {
    const changed = await port.mutate('archive', { archived }, null)
    if (!changed.ok) return changed
    if (archived) hub.drop(port.id)
    hub.refreshSoon()
    return DONE
  }),

  loadEarlier: port => port.whenLive(async () => {
    const { older } = port.fence
    if (older === null) return refused('rejected', 'There is nothing earlier in this chat.')
    port.act({ did: 'earlier.requested' })
    const pages: Parameters<typeof parseTranscript>[0][number][] = []
    for (let cursor = older.cursor; pages.length < EARLIER.pages;) {
      const page = await port.call('session.transcript', { session_id: port.id, order: 'latest', limit: EARLIER.pageRows, ...(cursor === null ? {} : { cursor }) })
      if (!page.ok) {
        port.earlier({ turns: [], unfinished: null, older })
        return page
      }
      pages.push(page.value)
      if (page.value.next_cursor === null || holdsWholeTurns(page.value)) break
      cursor = page.value.next_cursor
    }
    port.earlier(parseTranscript(pages))
    return DONE
  }),

  models: port => port.whenLive(async () => {
    // explicit_only leaves out providers that only look signed in through ambient credentials.
    const menu = await port.call('model.options', { session_id: port.id, explicit_only: true })
    return menu.ok ? { ok: true, value: parseModelMenu(menu.value) } : menu
  }),

  contextBreakdown: port => port.whenLive(async () => {
    const breakdown = await port.call('session.context_breakdown', { session_id: port.id })
    return breakdown.ok ? { ok: true, value: parseContextBreakdown(breakdown.value) } : breakdown
  }),

  completePath: (port, { word }) => port.whenLive(async () => {
    const matches = await port.call('complete.path', { session_id: port.id, word })
    return matches.ok ? { ok: true, value: parsePathMatches(matches.value) } : matches
  }),

  /**
   * Hermes sends no session.info after this set, so the reply is the only word on the new state. Leaving out `scope`
   * keeps the change to this chat: any scope but "global" is refused, and "global" flips the whole profile
   * (gateway/session_tui_config.py:187-193,357-377, gateway/session_busy_controls.py:30-44,134-166). An explicit word, because a missing
   * value toggles.
   */
  setYolo: (port, { on }) => port.whenLive(async () => {
    const set = await port.call('config.set', { session_id: port.id, key: 'yolo', value: on ? 'on' : 'off' })
    if (!set.ok) return set
    port.act({ did: 'yolo', on: set.value.value === '1' || set.value.value === true })
    return DONE
  }),

  pickModel: (port, { model, confirm }) => port.whenLive<ModelConfirm | null>(async () => {
    const payload = { model: model.id, provider: model.provider, ...(confirm === undefined ? {} : { confirm }) }
    const sent = await port.mutate('model', payload, port.fence.generation ?? 0)
    if (!sent.ok) return { ok: false, refusal: sent.refusal.kind === 'stale' ? MOVED_ON : sent.refusal }
    const receipt = parseModelReceipt(sent.value)
    switch (receipt.status) {
      case 'confirm':
        return { ok: true, value: receipt.confirm }
      case 'confirm-without-token':
        return refused('rejected', receipt.message)
      case 'deferred': {
        const { run } = port.content
        const during = receipt.during ?? (run.state === 'running' ? run.generation : null)
        if (during !== null) port.act({ did: 'model.deferred', model: { id: model.id, provider: model.provider }, during })
        return { ok: true, value: null }
      }
      case 'committed':
        return { ok: true, value: null }
    }
  }),

  tune: (port, { on }) => port.whenLive(async () => {
    const set = await port.call('config.set', { session_id: port.id, key: 'show_reasoning', value: on ? 'on' : 'off' })
    if (!set.ok) return set
    port.act({ did: 'tuned', tuning: { reasoning: parseShown(set.value) ?? on } })
    return DONE
  })
}

async function answerPrompt(port: SessionPort, promptId: PromptId, reply: PromptReply): Promise<Outcome> {
  const { run } = port.content
  const prompt = run.state === 'running' ? run.turn.items.find(item => item.kind === 'prompt' && item.id === promptId) : undefined
  if (prompt?.kind !== 'prompt' || prompt.state.s !== 'waiting') return NOT_OPEN
  port.act({ did: 'answer', promptId, reply })
  const fence = { session_id: port.id, execution_generation: prompt.generation, prompt_id: promptId }
  const answered = await (prompt.ask.kind === 'approval'
    ? port.call('approval.respond', { ...fence, choice: reply.value })
    : port.call('clarify.respond', { ...fence, answer: reply.value }))
  if (!answered.ok) {
    port.act({ did: 'answer.failed', promptId, message: answered.refusal.kind === 'offline' ? DROPPED_ANSWER : answered.refusal.message })
    return answered
  }
  port.act({ did: 'answer.resolved', promptId, byUs: answered.value.status === 'resolved' })
  return DONE
}

type Asking<K extends HermesRequest['ask']['kind']> = HermesRequest & { readonly ask: Extract<HermesRequest['ask'], { kind: K }> }
type Replying<K extends RequestReply['kind']> = Extract<RequestReply, { kind: K }>

interface Answer { readonly recorded: RecordedReply; sent(): Outcome | Promise<Outcome<'waits' | 'settles'>> }

type Answers = { readonly [A in HermesRequest['ask']['kind']]: { readonly [R in RequestReply['kind']]?: (port: SessionPort, request: Asking<A>, reply: Replying<R>) => Answer | null } }

const SECRET_METHODS = { sudo: 'sudo', env: 'secret', vault: 'vault.unlock_prompt', login: 'vault.save_login', code: 'vault.code' } as const satisfies
  Record<Asking<'secret'>['ask']['for']['is'], string>
const WITHHELD: RecordedReply = { kind: 'withheld' }
const SKIP: RecordedReply = { kind: 'skip' }

const ANSWERS: Answers = {
  secret: {
    /** Hermes reads an empty value as "skipped", so `skip` is the only way to send one. A login travels as one JSON string (gateway/session_vault_prompt.py:62-69). */
    secret: (port, { id, ask }, { value, identifier }) => (value === '' ? null : {
      recorded: WITHHELD,
      sent: () => port.respond(id, SECRET_METHODS[ask.for.is], { value: ask.for.is === 'login' ? JSON.stringify({ identifier: identifier ?? '', password: value }) : value })
    }),
    skip: (port, { id, ask }) => ({ recorded: SKIP, sent: () => port.respond(id, SECRET_METHODS[ask.for.is], { value: '' }) })
  },
  questions: {
    lock: (port, { id, ask }, reply) => {
      const question = ask.questions.find(asked => asked.id === reply.question)
      const answer = question === undefined ? undefined : lockedText(reply.answer, question.multi)
      if (answer === undefined) return null
      return {
        recorded: reply,
        sent: async () => {
          const locked = await port.call('clarify.lock', { request_id: id, question_id: reply.question, answer })
          if (!locked.ok) return locked
          if (locked.value.status === 'expired') return NOT_OPEN
          return { ok: true, value: (locked.value.remaining ?? []).length === 0 ? 'settles' : 'waits' }
        }
      }
    },
    /** A result with no `answers` ends the batch and keeps what is locked (tools/clarify_batch.py:17-30). */
    skip: (port, { id }) => ({ recorded: SKIP, sent: () => port.respond(id, 'clarify', {}) })
  },
  connect: {
    connect: (port, { id }, { target, as, values }) => ({
      recorded: WITHHELD,
      sent: () => respondToCard(port, id, { targets: [{ name: target, status: as, ...(values === undefined ? {} : { env: { ...values } }) }] })
    }),
    skip: (port, { id }) => ({ recorded: SKIP, sent: () => respondToCard(port, id, { settled_by: 'continue' }) })
  }
}

/** One string as `clarify.lock` takes it: several picks are a JSON array of labels (tools/clarify_tool.py:36-47). undefined: not an answer to this question. */
function lockedText(answer: Replying<'lock'>['answer'], multi: boolean): string | null | undefined {
  if (answer === null) return null
  if (multi) return JSON.stringify(answer)
  return answer.length === 1 ? answer[0] : undefined
}

/** The card changes by the stream. The reply says only whether that answer settled it (gateway/session_connections.py:92-99). */
async function respondToCard(port: SessionPort, id: RequestId, result: Served['connection.respond']['params']['result']): Promise<Outcome<'waits' | 'settles'>> {
  const taken = await port.call('connection.respond', { owner: { type: 'session', session_id: port.id }, op_id: id, result })
  return taken.ok ? { ok: true, value: taken.value.settled ? 'settles' : 'waits' } : taken
}

async function answerRequest(port: SessionPort, requestId: RequestId, reply: RequestReply): Promise<Outcome> {
  const request = port.content.requests.find(held => held.id === requestId)
  if (request === undefined || request.state.s !== 'waiting') return NOT_OPEN
  const row = ANSWERS[request.ask.kind][reply.kind] as ((port: SessionPort, request: HermesRequest, reply: RequestReply) => Answer | null) | undefined
  const answer = row?.(port, request, reply) ?? null
  if (answer === null) return WRONG_ANSWER
  port.act({ did: 'answer', requestId, reply: answer.recorded })
  const sent = await answer.sent()
  if (!sent.ok) {
    port.act({ did: 'answer.failed', requestId, message: sent.refusal.kind === 'offline' ? DROPPED_ANSWER : sent.refusal.message })
    return sent
  }
  if (sent.value !== undefined) port.act({ did: 'answer.accepted', requestId, then: sent.value })
  return DONE
}

export const runSessionCommand = (port: SessionPort, command: SessionCommand, hub: Hub) =>
  (sessionCommands[command.do] as Row<SessionCommand>)(port, command, hub)

const highwingRuns: { readonly [name: string]: (port: SessionPort, arg: string, hub: Hub) => Outcome | Promise<Outcome> | null } = {
  title: (port, title, hub) => (title === '' ? null : sessionCommands.rename(port, { do: 'rename', sessionId: port.id, title }, hub))
}

async function runSlash(port: SessionPort, { entry, arg }: SlashLine, hub: Hub): Promise<Outcome<string | null>> {
  const own = entry.kind === 'command' && Object.hasOwn(highwingRuns, entry.name) ? highwingRuns[entry.name]?.(port, arg, hub) : null
  if (own != null) return showing(await own)
  const typed = `/${entry.name}${arg === '' ? '' : ` ${arg}`}`
  const reply = await port.call('command.dispatch', { session_id: port.id, name: entry.name, ...(arg === '' ? {} : { arg }) })
  if (!reply.ok) return reply
  const directive = parseDirective(reply.value, typed)
  if (directive === null) return refused('unsupported', "Highwing can't carry out what Hermes answered to that command.")
  if (directive.do === 'show') return directive.text === '' ? NOTHING_TO_SHOW : { ok: true, value: directive.text }
  return showing(await port.submit(directive.text, directive.apiText), directive.note)
}
