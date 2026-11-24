import { DONE, refused, type Mutation, type SessionPort, type Upload } from './actor'
import type { Bot } from './domain/bots'
import type { Command, ModelConfirm, Outcome, Refusal, ResultOf } from './domain/command'
import type { AttachmentId, BranchId, SessionContent, SessionId, TurnId } from './domain/session'
import { slashLineOf, type SlashCatalog, type SlashLine } from './domain/slash'
import { parseBranched, parseContextBreakdown, parseDirective, parseModelMenu, parseModelReceipt, parsePathMatches, parseTranscript } from './wire/parse'

/** `versions` stays with the hub: reading a chat's versions must not attach it. */
export type SessionCommand = Exclude<Extract<Command, { readonly sessionId: SessionId }>, { readonly do: 'versions' }>

/** The exact request a branch key last sent, and the words of the message it branches from. */
export interface BranchPin { readonly request: Mutation; readonly text: string }

/** What a command about one chat may use of the connection around it. */
export interface Hub {
  /** The slash catalog, once the read the current connection began has settled. */
  catalog(): Promise<SlashCatalog>
  retitle(id: SessionId, title: string): void
  drop(id: SessionId): void
  /** Read the chat list and the bots again soon. */
  refreshSoon(): void
  /** Once the relay probe the current connection began has settled. */
  settledRelay(): Promise<void>
  /** The listed bots `text` mentions, less the chat's own bot. None when this Hermes can't relay. */
  mentioned(id: SessionId, text: string): readonly Bot[]
  /** Hands `text` to `to` and files it under chat `id`, after turn `after`. */
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
const EARLIER = { pageRows: 200, pages: 3 } as const
const MENTION_WITH_ATTACHMENTS = "A message to another bot can't carry attachments. Remove them, or send it without the mention."
const UPLOAD_GONE = 'An attachment is no longer available. Remove it and attach it again.'
export const NOTHING_TO_SHOW: Outcome<string | null> = { ok: true, value: null }

const showing = (outcome: Outcome, words: string | null = null): Outcome<string | null> => (outcome.ok ? { ok: true, value: words } : outcome)

/** A page that begins with a user row holds whole turns, so the read can stop there. */
const startsAtTurn = (page: { readonly rows: readonly { readonly role?: unknown }[] }) => page.rows[0]?.role === 'user'

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
    const line = text.trimStart().startsWith('/') ? slashLineOf(text, await hub.catalog()) : null
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

  answer: (port, { promptId, reply }) => port.whenLive(async () => {
    const { run } = port.content
    const prompt = run.state === 'running' ? run.turn.items.find(item => item.kind === 'prompt' && item.id === promptId) : undefined
    if (prompt?.kind !== 'prompt' || prompt.state.s !== 'waiting') return refused('stale', 'That question is no longer open.')
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
  }),

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
      if (page.value.next_cursor === null || startsAtTurn(page.value)) break
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
  })
}

/** Carries out a command about the chat `port` reaches. The hub has waited for the chat to attach. */
export const runSessionCommand = (port: SessionPort, command: SessionCommand, hub: Hub) =>
  (sessionCommands[command.do] as Row<SessionCommand>)(port, command, hub)

/** Commands Highwing carries out itself rather than sending to Hermes. null lets Hermes have the line. */
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
