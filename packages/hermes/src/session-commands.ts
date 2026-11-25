import { DONE, refused, type Mutation, type SessionPort, type Upload } from './actor'
import type { Bot } from './domain/bots'
import type { Command, ModelConfirm, Outcome, Refusal, Restored, ResultOf } from './domain/command'
import { offeredBy, sendPlan } from './domain/queue'
import {
  reissues, type AttachmentId, type BranchId, type Generation, type HermesRequest, type PromptId, type PromptReply, type QueuedMessage, type RecordedReply,
  type RequestId, type RequestReply, type SessionContent, type SessionId, type SideId, type Told, type Tuning, type TurnId
} from './domain/session'
import { ownCommand, slashLineOf, type SlashCatalog, type SlashLine } from './domain/slash'
import type { Served } from './wire/link'
import {
  beginsAtTurn, parseBranched, parseBusy, parseCheckpointDiff, parseCheckpoints, parseCompressed, parseContextBreakdown, parseCorrection, parseDirective, parseFast,
  parseModelMenu, parseModelReceipt, parsePathMatches, parseReactions, parseRestored, parseShown, parseTranscript, type Correction, type Directive
} from './wire/parse'

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
const MID_TURN = refused('stale', 'Wait for the reply to finish, then try again.')
const NO_FOLDER: Refusal = { kind: 'rejected', message: "That folder isn't on the machine Hermes runs on." }
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
const NOT_QUEUED = refused('stale', 'That message is no longer in the queue.')
const NOT_OFFERED = refused('rejected', "Hermes doesn't offer that for this message.")
const MAYBE_READ = refused('rejected', "Hermes didn't confirm it took that. It may have read it, so Highwing hasn't sent it again.")
const NOT_STORED = refused('rejected', "That answer isn't stored, so it can't take a reaction.")
/** `message.react` answers `not_found` for a row the chat no longer shows, such as one a rewind took back (gateway/session_reactions.py:52-53). */
const ROW_GONE = { not_found: GONE } as const
const ANSWERED: Outcome<undefined> = { ok: true, value: undefined }
const EARLIER = { pageRows: 200, pages: 3 } as const
const MENTION_WITH_ATTACHMENTS = "A message to another bot can't carry attachments. Remove them, or send it without the mention."
const UPLOAD_GONE = 'An attachment is no longer available. Remove it and attach it again.'
export const NOTHING_TO_SHOW: Outcome<string | null> = { ok: true, value: null }

const showing = (outcome: Outcome, words: string | null = null): Outcome<string | null> => (outcome.ok ? { ok: true, value: words } : outcome)

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
      return showing(await say(port, text, read as Upload[]))
    }
    if (attachments.length > 0) return refused('rejected', MENTION_WITH_ATTACHMENTS)
    const { run, history } = port.content
    const after = run.state === 'running' ? run.turn.id : history.at(-1)?.id ?? null
    for (const bot of to) hub.relay(port.id, after, bot, text)
    return NOTHING_TO_SHOW
  },

  rewind: (port, { rowId, text }) => port.whenLive(async () => {
    if (port.content.run.state === 'running') return MID_TURN
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

  side: (port, { kind, text }) => port.whenLive(async () => {
    const asked = await port.call(kind === 'btw' ? 'prompt.btw' : 'prompt.background', { session_id: port.id, text })
    if (!asked.ok) return asked
    port.act({ did: 'side.started', id: asked.value.task_id as SideId, kind, asked: text })
    return DONE
  }),


  move: (port, { cwd }) => port.whenLive(async () => {
    if (port.content.run.state === 'running') return MID_TURN
    // Hermes names no field when the folder is not there (gateway/session_mutation_policy.py:45-49). It pushes the new folder in a session.info.
    const moved = await port.mutate('workspace', { cwd }, port.fence.generation ?? 0, { field: null, refusal: NO_FOLDER })
    return moved.ok ? DONE : moved
  }),

  compress: (port, { focus }) => port.whenLive<string | null>(async () => {
    if (port.content.run.state === 'running') return MID_TURN
    const compressed = await port.mutate('compress', focus === null ? {} : { focus }, port.fence.generation ?? 0)
    return compressed.ok ? { ok: true, value: parseCompressed(compressed.value) } : compressed
  }),

  export: (port, { format }) => port.whenLive(async () => {
    const rendered = await port.call('session.export', { session_id: port.id, format })
    return rendered.ok ? { ok: true, value: { filename: rendered.value.filename, content: rendered.value.content } } : rendered
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

  queued: (port, command) => port.whenLive(async () => {
    const row = port.content.queue.find(held => held.admissionId === command.admissionId)
    if (row === undefined) return NOT_QUEUED
    if (!offeredBy(row.state).includes(command.action)) return NOT_OFFERED
    const done = await QUEUED[command.action](port, row, command.action === 'edit' ? command.text : '')
    return done.ok ? DONE : done
  }),

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
      if (page.value.next_cursor === null || beginsAtTurn(page.value)) break
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

  killProcess: (port, { processId }) => port.whenLive(async () => {
    const killed = await port.call('process.kill', { session_id: port.id, process_id: processId })
    if (killed.ok || killed.refusal.kind === 'stale') port.act({ did: 'killed' })
    if (!killed.ok) return killed
    // A process that died before the kill, or after Hermes listed it, still ends the call (tools/process_registry.py:2120-2190).
    switch (killed.value.status) {
      case 'killed':
      case 'already_exited':
        return DONE
      case 'not_found':
        return refused('stale', 'That process is no longer in this chat.')
      case 'error':
        return refused('rejected', killed.value.error ? `Hermes couldn't stop it: ${killed.value.error}` : "Hermes couldn't stop it.")
    }
  }),

  /** Hermes publishes the new state to every viewer as `session.control.update`, so the reply's own copy is not read. */
  control: (port, { action }) => port.whenLive(async () => {
    const { act, ...args } = action
    const pressed = await port.call('session.control', { session_id: port.id, action: act, args })
    return pressed.ok ? carryOut(port, parseDirective(pressed.value.dispatch, `/${act.replace('.', ' ')}`)) : pressed
  }),

  checkpoints: port => port.whenLive(async () => {
    const listed = await port.call('rollback.list', { session_id: port.id })
    return listed.ok ? { ok: true, value: parseCheckpoints(listed.value) } : listed
  }),

  checkpointDiff: (port, { checkpoint }) => port.whenLive(async () => {
    const diff = await port.call('rollback.diff', { session_id: port.id, hash: checkpoint })
    return diff.ok ? { ok: true, value: parseCheckpointDiff(diff.value) } : diff
  }),

  restore: (port, { checkpoint, scope }) => port.whenLive<Restored>(async () => {
    // Hermes takes back the last turn with a whole folder, and refuses that mid-turn. One file only touches the disk (gateway/session_tui_ops.py:235-238).
    if (scope.kind === 'folder' && port.content.run.state === 'running') return MID_TURN
    const how = scope.kind === 'file' ? { file_path: scope.path } : scope.edits === 'overwrite' ? { all: true } : {}
    const attaches = port.fence.attaches
    const reply = await port.call('rollback.restore', { session_id: port.id, hash: checkpoint, ...how })
    if (!reply.ok && reply.refusal.kind === 'offline' && scope.kind === 'folder') port.act({ did: 'rewritten' })
    if (!reply.ok) return reply
    const restored = parseRestored(reply.value)
    if ('failed' in restored) return refused('rejected', restored.failed)
    // The restore's rewind is a session.mutate, whose event reaches the socket before this answer and has begun the re-read (gateway/session_tui_ops.py:310-311,364-371).
    if (restored.lastTurn === 'removed' && port.fence.attaches === attaches) port.act({ did: 'rewritten' })
    return { ok: true, value: restored }
  }),

  react: (port, { turn, emoji }) => port.whenLive(async () => {
    const reply = port.content.history.find(held => held.id === turn)?.reply ?? null
    if (reply === null) return NOT_STORED
    const reacted = await port.call('message.react', { session_id: port.id, row_id: reply.rowId, emoji }, ROW_GONE)
    if (!reacted.ok) return reacted
    port.act({ did: 'reacted', rowId: reacted.value.row_id, reactions: parseReactions(reacted.value.reactions) })
    return DONE
  }),

  tune: (port, command) => port.whenLive(async () => {
    if (command.set === 'effort') {
      // A committed level comes back in a session.info before the reply. One set during a turn is held for the next (gateway/session_mutations.py:136-143,370-377).
      const set = await port.mutate('reasoning', { effort: command.to === 'default' ? null : command.to }, port.fence.generation ?? 0)
      return set.ok ? DONE : set
    }
    const { key, value, said } = (SWITCHES[command.set] as (command: Switched) => Switch)(command)
    const set = await port.call('config.set', { session_id: port.id, key, value })
    if (!set.ok) return set
    port.act({ did: 'tuned', tuning: said(set.value) })
    return DONE
  })
}

type Switched = Exclude<Extract<SessionCommand, { do: 'tune' }>, { set: 'effort' }>
interface Switch { readonly key: string; readonly value: string; said(reply: Served['config.set']['result']): Partial<Tuning> }

const SWITCHES: { readonly [S in Switched['set']]: (command: Extract<Switched, { set: S }>) => Switch } = {
  busy: ({ to }) => ({ key: 'busy', value: to, said: reply => ({ busy: parseBusy(reply) ?? to }) }),
  reasoning: ({ on }) => ({ key: 'show_reasoning', value: on ? 'on' : 'off', said: reply => ({ reasoning: parseShown(reply) ?? on }) }),
  /**
   * Leaving out `scope` keeps the change to this chat: any scope but "global" is refused, and "global" flips the whole profile
   * (gateway/session_tui_config.py:187-193,357-377, gateway/session_busy_controls.py:30-44,134-166). An explicit word, because a missing
   * value toggles.
   */
  yolo: ({ on }) => ({ key: 'yolo', value: on ? 'on' : 'off', said: reply => ({ yolo: reply.value === '1' || reply.value === true }) }),
  /** Hermes answers the tier's word (gateway/session_tui_config.py:274-298). */
  fast: ({ on }) => ({ key: 'fast', value: on ? 'fast' : 'normal', said: reply => ({ fast: parseFast(reply) ?? on }) })
}

/**
 * What each action on a queue row sends. Hermes's next pending list is what changes the row, so no
 * row writes to the queue. An edit is a new message that takes the old one's place at the back
 * (gateway/session_queued_controls.py:213-242): it waits in the outbox, as a sent one does, until
 * that list names it.
 */
const QUEUED: { readonly [A in Extract<SessionCommand, { do: 'queued' }>['action']]: (port: SessionPort, row: QueuedMessage, text: string) => Promise<Outcome<unknown>> } = {
  cancel: (port, row) => port.call('prompt.cancel', { session_id: port.id, admission_id: row.admissionId }),
  sendNow: (port, row) => port.call('prompt.steer_queued', { session_id: port.id, admission_id: row.admissionId }),
  edit: (port, row, text) => port.replace(row.admissionId, text),
  release: (port, row) => (row.state.s === 'lost'
    ? port.call('prompt.resolve_unknown', { session_id: port.id, admission_id: row.admissionId, execution_generation: row.state.generation })
    : Promise.resolve(NOT_OFFERED))
}

/** Hands `text` to the turn of generation `during`. A turn that has ended took nothing, which reads as `unread`. */
async function correct(port: SessionPort, by: 'steer' | 'redirect', text: string, during: Generation): Promise<Outcome<Correction>> {
  const reply = await port.call(by === 'steer' ? 'session.steer' : 'session.redirect', { session_id: port.id, text, execution_generation: during })
  if (!reply.ok) return reply.refusal.kind === 'stale' ? { ok: true, value: 'unread' } : reply
  const correction = parseCorrection(reply.value)
  if (correction === 'taken') port.act({ did: 'steered', text, during })
  return { ok: true, value: correction }
}

async function say(port: SessionPort, text: string, uploads: readonly Upload[]): Promise<Outcome> {
  const plan = sendPlan(port.content, uploads)
  if (plan.by === 'submit') return port.submit(text, undefined, uploads)
  return port.whenLive(async () => {
    const handed = await correct(port, plan.by, text, plan.during)
    if (!handed.ok) return handed.refusal.kind === 'offline' ? MAYBE_READ : handed
    switch (handed.value) {
      case 'taken':
        return DONE
      case 'unread':
        return port.submit(text)
      case 'unsure':
        return MAYBE_READ
    }
  })
}

const TOLD = { taken: 'turn', unread: 'next', unsure: 'unsure' } as const satisfies Record<Correction, Told>

/**
 * Hands a denial's words to the turn that asked, and says where they went. Words that an earlier try of
 * the same denial handed over are not sent again: `session.steer` carries no id, so Hermes would take a
 * repeat as new words. A steer the socket dropped under may have reached the agent, which reads `unsure`.
 */
async function tell(port: SessionPort, promptId: PromptId, text: string, during: Generation): Promise<Outcome<Told>> {
  const told = port.fence.told[promptId]
  if (told !== undefined && Object.hasOwn(told, text)) return { ok: true, value: told[text] as Exclude<Told, 'next'> }
  const handed = await correct(port, 'steer', text, during)
  if (!handed.ok && handed.refusal.kind !== 'offline') return handed
  const went = handed.ok ? TOLD[handed.value] : 'unsure'
  if (went !== 'next') port.act({ did: 'told', promptId, text, went })
  return handed.ok ? { ok: true, value: went } : handed
}

async function answerPrompt(port: SessionPort, promptId: PromptId, reply: PromptReply): Promise<Outcome<Told | undefined>> {
  const { run } = port.content
  const prompt = run.state === 'running' ? run.turn.items.find(item => item.kind === 'prompt' && item.id === promptId) : undefined
  if (prompt?.kind !== 'prompt' || prompt.state.s !== 'waiting') return NOT_OPEN
  if (reply.kind === 'deny' && (prompt.ask.kind !== 'approval' || reply.tell.trim() === '')) return WRONG_ANSWER
  port.act({ did: 'answer', promptId, reply })
  const failed = (refusal: Refusal) => port.act({ did: 'answer.failed', promptId, message: refusal.kind === 'offline' ? DROPPED_ANSWER : refusal.message })
  // The words go first, so they ride on the result of the tool the denial blocks (ui-tui/src/app/useApprovalAnswers.ts:63-84).
  const told = reply.kind === 'deny' ? await tell(port, promptId, reply.tell, prompt.generation) : null
  if (told !== null && !told.ok) {
    failed(told.refusal)
    return told
  }
  const fence = { session_id: port.id, execution_generation: prompt.generation, prompt_id: promptId }
  const answered = await (prompt.ask.kind === 'approval'
    ? port.call('approval.respond', { ...fence, choice: reply.kind === 'deny' ? 'deny' : reply.value })
    : port.call('clarify.respond', { ...fence, answer: reply.kind === 'deny' ? '' : reply.value }))
  if (!answered.ok) {
    failed(answered.refusal)
    return answered
  }
  port.act({ did: 'answer.resolved', promptId, byUs: answered.value.status === 'resolved' })
  if (reply.kind !== 'deny' || told === null) return ANSWERED
  if (told.value !== 'next') return told
  // The answered card gives no words back, so a message that cannot be sent stays in the outbox.
  const sent = await port.submitOrKeep(reply.tell)
  return sent.ok ? told : sent
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
    connect: (port, { id, ask }, { target, as, values }) => ({
      recorded: WITHHELD,
      sent: () => (as === 'approved' && ask.targets.some(held => held.name === target && reissues(held))
        ? reissue(port, target)
        : respondToCard(port, id, { targets: [{ name: target, status: as, ...(values === undefined ? {} : { env: { ...values } }) }] }))
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

/** The new link comes with the card, by the stream. */
async function reissue(port: SessionPort, target: string): Promise<Outcome<'waits'>> {
  const minted = await port.call('connectors.connect', { owner: { type: 'session', session_id: port.id }, connectors: [target], reconnect: true })
  return minted.ok ? { ok: true, value: 'waits' } : minted
}

async function answerRequest(port: SessionPort, requestId: RequestId, reply: RequestReply): Promise<Outcome<undefined>> {
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
  return ANSWERED
}

export const runSessionCommand = (port: SessionPort, command: SessionCommand, hub: Hub) =>
  (sessionCommands[command.do] as Row<SessionCommand>)(port, command, hub)

async function runSlash(port: SessionPort, line: SlashLine, hub: Hub): Promise<Outcome<string | null>> {
  const own = ownCommand(line, port.id)
  if (own !== null && 'usage' in own) return refused('rejected', `Type it as ${own.usage}.`)
  if (own !== null && 'answer' in own) {
    return own.answer(async <C extends SessionCommand>(command: C) => (await runSessionCommand(port, command, hub)) as Outcome<ResultOf<C>>)
  }
  if (own !== null) {
    const done: Outcome<unknown> = await runSessionCommand(port, own, hub)
    return done.ok ? { ok: true, value: typeof done.value === 'string' ? done.value : null } : done
  }
  const { entry, arg } = line
  const typed = `/${entry.name}${arg === '' ? '' : ` ${arg}`}`
  const reply = await port.call('command.dispatch', { session_id: port.id, name: entry.name, ...(arg === '' ? {} : { arg }) })
  return reply.ok ? carryOut(port, parseDirective(reply.value, typed)) : reply
}

async function carryOut(port: SessionPort, directive: Directive | null): Promise<Outcome<string | null>> {
  if (directive === null) return refused('unsupported', "Highwing can't carry out what Hermes answered to that command.")
  if (directive.do === 'show') return directive.text === '' ? NOTHING_TO_SHOW : { ok: true, value: directive.text }
  return showing(await port.submit(directive.text, directive.apiText), directive.note)
}
