import {
  turnActivityOf,
  type Asked, type Attachment, type FileDiff, type HelperEnd, type HelperId, type HelperItem, type HermesRequest, type Item, type MoaItem, type NoticeItem,
  type Outcome, type PlanEntry, type PlanItem, type PromptId, type PromptItem, type PromptReply, type ReasoningItem, type RequestEnd, type RequestId,
  type SecretFor, type Session, type SettledTurn, type StatusAbout, type Sync, type Tokens, type ToolItem, type Turn, type TurnActivity, type TurnId
} from '@highwing/hermes/domain'
import { multiAnswers } from './multi'
import { hidesAt, isShownAt, moaWords, NOTICE_TONES } from './says'
import { changesAt, elapsedWords, timeLines, timeOfDay, type ViewClock } from './when'

export type { ViewClock }

export { leafText, parseMarkdown, proseLeaves, type Align, type Block, type Cell, type CodeBlock, type Inline, type ProseLeaf } from './prose'
export { fieldId, findInThread, type FieldPart, type FindMatch } from './find'
export { multiReply } from './multi'

/** Text with literal parts. `code` is set in JetBrains Mono; nothing here is HTML. */
export type Phrase = readonly { readonly t: 'text' | 'code'; readonly v: string }[]

export interface ThreadView {
  readonly state: 'opening' | 'ready' | 'unavailable'
  readonly turns: readonly TurnView[]
  /**
   * This client's messages that no turn has picked up, shown under the last turn: the ones Hermes
   * holds in its queue, then the ones it has not listed. Another client's queued messages are not in
   * the view yet.
   */
  readonly pending: readonly {
    readonly key: string; readonly text: string; readonly attachments: readonly Attachment[]; readonly status: 'sending' | 'queued' | 'failed'; readonly detail: string | null
  }[]
  /** What Hermes waits on you for, oldest first, drawn after the turns. */
  readonly asks: readonly AskCard[]
  readonly earlier: Session['earlier']
  /**
   * The earliest instant after the clock's `now` at which the same session would read differently
   * (an elapsed time ticks over, a time line appears or says a new day, a notice's time runs out), or
   * null when none will.
   */
  readonly changesAt: number | null
}

/** A masked field Hermes waits on: a sudo password, or the value of a secret. */
export interface AskCard {
  readonly key: string
  readonly requestId: RequestId
  readonly heading: string
  readonly command: string | null
  readonly why: string | null
  readonly name: string | null
  readonly label: string
  /** When Hermes stops waiting: "Hermes waits until 14:07." null when Hermes named no limit. */
  readonly waits: string | null
  /** An answer is on its way, or the link is down. */
  readonly busy: boolean
  /** The last answer did not reach Hermes. */
  readonly error: string | null
}

export interface TurnView {
  /** Stable for the life of the turn. Node keys below are stable while the turn only grows. */
  readonly key: string
  /** The quiet line above the request: "Today 14:05". null draws nothing. Never the empty string. */
  readonly time: string | null
  readonly request: string | null
  /** What was sent with the request, drawn above it. Empty for a turn with no request. */
  readonly attachments: readonly Attachment[]
  /** The stored row id of the request, the address an edit or a regenerate cuts before. null for a turn with no request, and for a running turn's until it settles. */
  readonly rowId: number | null
  /** Top to bottom along the thread. */
  readonly nodes: readonly ThreadNode[]
  readonly end: ThreadEnd
  /** What the reply used, under its end: "1,204 in, 380 out". null draws nothing: a turn still running, or one Hermes named no counts for. */
  readonly tokens: string | null
}

export type ThreadNode =
  | { readonly kind: 'prose'; readonly key: string; readonly markdown: string; readonly streaming: boolean }
  /** A run of one tool call. */
  | { readonly kind: 'step'; readonly key: string; readonly step: StepView }
  /** A run of two or more. `steps` render indented when the group is open. */
  | {
      readonly kind: 'group'
      readonly key: string
      /** The summary, or the running step's title while the run's last step runs ("Running ls -la"). */
      readonly title: Phrase
      readonly count: number
      /** Combined +/- across the run. null when every diff in it touches the same file. */
      readonly stat: DiffStat | null
      readonly steps: readonly StepView[]
    }
  | { readonly kind: 'prompt'; readonly key: string; readonly card: PromptCard }
  /** Hermes's own words, or what Highwing did for it. `detail`: the full text behind a short notice, shown on request. */
  | { readonly kind: 'notice'; readonly key: string; readonly tone: 'error' | 'warn' | 'info'; readonly text: string; readonly detail: string | null }
  /** One reasoning block, collapsed until pressed. The text is plain, never Markdown. */
  | {
      readonly kind: 'reasoning'
      readonly key: string
      readonly text: string
      readonly streaming: boolean
      /** "12 s", "under a second". null while it streams, or when this client did not see it start and end. */
      readonly duration: string | null
    }
  /** A helper the agent started. Its own steps and helpers render on an indented thread when it is open. */
  | { readonly kind: 'helper'; readonly key: string; readonly helper: HelperView }
  /** The turn's to-do list. At most one per turn. */
  | { readonly kind: 'plan'; readonly key: string; readonly plan: PlanView }
  /** One round of mixture-of-agents, collapsed until pressed. Each reference model's answer is plain text. */
  | { readonly kind: 'moa'; readonly key: string; readonly title: string; readonly meta: string | null; readonly references: MoaItem['references'] }
  /** A line Hermes showed beside the conversation, in its own words. */
  | { readonly kind: 'status'; readonly key: string; readonly about: StatusAbout; readonly text: string }
  /** Words the user put into the turn while it ran. */
  | { readonly kind: 'steer'; readonly key: string; readonly text: string }
  /** Where a request closed. `words` is null for a kind with no card. */
  | { readonly kind: 'closed'; readonly key: string; readonly asked: Asked; readonly end: RequestEnd; readonly words: string | null }

/**
 * The turn's single end mark.
 * - `at`: the mark sits on an existing node. Viridian and pulsing on a running step or group,
 *   amber on a pending prompt card. No separate tip row is drawn.
 * - `tip`: a viridian pulsing row of its own ("Thinking", "Writing", "Preparing write_file", "Stopping").
 * - `elapsed` on a live `at` and on a `tip`: the time since the turn began, "3 min", once a minute has
 *   passed. Separate text, never part of the words. A prompt card that waits on you shows none, and
 *   neither does a paused end. After you answer, the count still runs from the turn's start.
 * - `paused`: the turn was running when the link dropped. Graphite, no pulse, says so.
 * - `done`: graphite check ring, `words` for screen readers only.
 * - `failed` and `stopped`: brick, with words.
 * - `lost`: graphite, no check ring, with words. How the turn ended is unknown, so nothing on screen
 *   claims it succeeded.
 * - `none`: no mark. What Hermes said between two turns is not a run of the agent.
 */
export type ThreadEnd =
  | { readonly kind: 'at'; readonly nodeKey: string; readonly tone: 'live'; readonly elapsed: string | null }
  | { readonly kind: 'at'; readonly nodeKey: string; readonly tone: 'asking' }
  | { readonly kind: 'tip'; readonly words: Phrase; readonly elapsed: string | null }
  | { readonly kind: 'paused'; readonly words: string }
  | { readonly kind: 'done'; readonly words: string }
  | { readonly kind: 'failed'; readonly words: string }
  | { readonly kind: 'stopped'; readonly words: string }
  | { readonly kind: 'lost'; readonly words: string }
  | { readonly kind: 'none' }

export interface DiffStat { readonly added: number; readonly removed: number }

export type HelperState = 'queued' | 'working' | 'done' | 'failed'

export interface HelperView {
  /** Hermes's words for the work, first line only. */
  readonly goal: string
  /** `failed` covers every end but `completed`. */
  readonly state: HelperState
  /** Brick words beside a helper that did not complete: "Failed", "Timed out", "Stopped". */
  readonly ended: string | null
  /** What a working helper does now, for its closed row: "Waiting to start", "Thinking", "Started `du -sh`". */
  readonly now: Phrase | null
  /** Hermes's tool count, else the tools seen. */
  readonly count: number
  /** Formatted, once it ended, and only when it took 1 s or more. */
  readonly duration: string | null
  readonly steps: readonly HelperStepView[]
  /** The helper's own words when it ended. */
  readonly summary: string | null
}

export type HelperStepView =
  /** A tool the helper started. `latest`: its newest tool while it works, which may still run. */
  | { readonly kind: 'step'; readonly key: string; readonly title: Phrase; readonly latest: boolean }
  /** A helper of the helper. `more` counts the helpers below it, which are not drawn. */
  | { readonly kind: 'helper'; readonly key: string; readonly goal: string; readonly state: HelperState; readonly more: number }

export interface PlanView {
  /** Completed entries. Cancelled ones count in neither `done` nor `total`. */
  readonly done: number
  readonly total: number
  readonly cancelled: number
  readonly entries: readonly PlanEntryView[]
  /** A plan opens by itself while its turn runs, and starts closed once the turn has settled. */
  readonly openByDefault: boolean
}

export interface PlanEntryView {
  readonly key: string
  readonly text: string
  readonly state: 'todo' | 'doing' | 'done' | 'cancelled'
  /** 0 at the top level, 1 under another entry, and so on. */
  readonly depth: number
}

export interface StepView {
  readonly key: string
  /** Verb plus subject: "Edited `notes.md`", "Running `ls -la`". */
  readonly title: Phrase
  readonly state: 'running' | 'done' | 'cut'
  readonly stat: DiffStat | null
  /** Formatted, and only when the tool took 1 s or more. */
  readonly duration: string | null
  /** null means nothing to show: the row is not a button, has no chevron and no hover. */
  readonly record: RecordView | null
  /** The path of the image the tool made, on the machine Hermes runs on. */
  readonly image: string | null
}

export interface RecordView {
  readonly sections: readonly RecordSection[]
  /** The whole command a terminal or process tool ran, `cd` prefix included, which the title clips. null for other tools. */
  readonly command: string | null
}
/** A clipped text, or the words to show when there is none ("No output"). */
export type RecordBody = { readonly text: string; readonly more: number } | { readonly empty: string }
/**
 * `label` is null when the record has a single section. `copy` is what a Copy control puts on the clipboard:
 * the shown text without the "… N more characters" line, or a unified diff. It is null when the body shows its empty words,
 * or when Hermes cut the diff short, since a copy would then drop lines without saying so.
 */
export type RecordSection =
  | { readonly kind: 'changes'; readonly label: string | null; readonly path: string; readonly lines: FileDiff['lines']; readonly copy: string | null }
  | { readonly kind: 'output' | 'result' | 'input'; readonly label: string | null; readonly body: RecordBody; readonly copy: string | null }

export type PromptCard =
  | {
      readonly state: 'asking'
      readonly promptId: PromptId
      readonly heading: string
      /** The command for an approval, long tokens wrapped by CSS. null for a clarify. */
      readonly command: string | null
      /** Why Hermes asks: its flagged reason in a sentence, or its question as given. */
      readonly why: string | null
      readonly pick: PromptPick
      /** An answer is on its way, or the session is not live. Buttons are disabled, the card stays amber. */
      readonly busy: boolean
      readonly error: string | null
    }
  /** Hollow caution ring. `command` is null when the step next to the card already shows it. */
  | { readonly state: 'answered'; readonly words: string; readonly command: string | null }

/** One button per choice, with a typed answer for a clarify; or checkboxes for a question that takes several answers. */
export type PromptPick =
  | { readonly kind: 'one'; readonly buttons: readonly PromptButton[]; readonly freeText: boolean }
  | { readonly kind: 'many'; readonly choices: readonly string[] }

/** `confirm` holds the words of the second yes a button needs before it answers, or null when one press answers. */
export interface PromptButton {
  readonly reply: PromptReply
  readonly label: string
  readonly role: 'primary' | 'plain' | 'decline'
  readonly confirm: { readonly title: string; readonly body: string } | null
}

const VIEW_STATE = {
  opening: 'opening', live: 'ready', offline: 'ready', 'catching-up': 'ready', rebuilding: 'ready', unavailable: 'unavailable'
} as const satisfies Record<Sync['state'], ThreadView['state']>

/** A settled turn's view holds from `from` until `until`, when one of its notices stops showing. */
interface Memo { readonly view: TurnView; readonly from: number; readonly until: number | null }

const settledViews = new WeakMap<SettledTurn, Memo>()

const LIVE_INTERLUDE = 'interlude:live' as TurnId

/**
 * The whole thread, and the one entry point: the renderer calls it on every session value and the
 * tests call it on every fixture step. Settled turns are memoised by reference, so a streaming delta
 * recomputes only the open turn and every settled `TurnView` keeps its identity for `React.memo`.
 * A tick of `clock` that changes no turn's time line keeps that identity too.
 */
export function threadView(session: Session, clock: ViewClock): ThreadView {
  const { run, sync } = session
  const turns: readonly Turn[] = run.state === 'running' ? [...session.history, run.turn] : session.history
  const starts = turns.map(turn => turn.began?.at ?? null)
  const lines = timeLines(starts, clock)
  const settled = session.history.map((turn, index) => settledView(turn, lines[index] ?? null, clock.now))
  const open = run.state === 'running'
    ? turnView(run.turn, lines.at(-1) ?? null, sync.state === 'live', clock.now, nodes => openEnd(run.turn, nodes, turnActivityOf(run), sync.state, clock))
    : null
  const interlude = turnView({ id: LIVE_INTERLUDE, request: null, items: session.interlude }, null, false, clock.now, () => NO_END)
  const elapsing = open !== null && (open.end.kind === 'tip' || (open.end.kind === 'at' && open.end.tone === 'live'))
  const hides = [
    ...settled.map(memo => memo.until),
    hidesAt(session.interlude, clock.now),
    run.state === 'running' ? hidesAt(run.turn.items, clock.now) : null
  ]
  return {
    state: VIEW_STATE[sync.state],
    turns: [...settled.map(memo => memo.view), interlude, ...(open === null ? [] : [open])].filter(turn => !isEmptyInterlude(turn)),
    pending: [
      ...session.queue.flatMap(row => (row.from === 'here' ? [{ key: row.inputId, text: row.text, attachments: row.attachments, status: 'queued' as const, detail: null }] : [])),
      ...session.outbox.map(entry => ({
        key: entry.inputId, text: entry.text, attachments: entry.attachments, status: entry.state.s, detail: entry.state.s === 'failed' ? entry.state.message : null
      }))
    ],
    asks: session.requests.flatMap(request => askCard(request, sync.state === 'live', clock)),
    earlier: session.earlier,
    changesAt: earliest([changesAt(starts, lines, elapsing ? starts.at(-1) ?? null : null, clock), ...hides])
  }
}

function earliest(times: readonly (number | null)[]): number | null {
  const due = times.filter(at => at !== null)
  return due.length === 0 ? null : Math.min(...due)
}

/** What Hermes said between turns, once every line of it has stopped showing. */
const isEmptyInterlude = (turn: TurnView) => turn.request === null && turn.end.kind === 'none' && turn.nodes.length === 0

function settledView(turn: SettledTurn, time: string | null, now: number): Memo {
  const memo = settledViews.get(turn)
  const current = memo !== undefined && memo.from <= now && (memo.until === null || now < memo.until)
  if (current && memo.view.time === time) return memo
  const view = current ? { ...memo.view, time } : turnView(turn, time, false, now, () => settledEnd(turn.outcome))
  const held = current ? { ...memo, view } : { view, from: now, until: hidesAt(turn.items, now) }
  settledViews.set(turn, held)
  return held
}

function turnView(turn: Pick<Turn, 'id' | 'request' | 'items'> & Partial<Pick<SettledTurn, 'tokens'>>, time: string | null, live: boolean, now: number, end: (nodes: readonly ThreadNode[]) => ThreadEnd): TurnView {
  const at = (index: number) => `${turn.id}/${index}`
  const helpers = new Map(turn.items.flatMap(item => (item.kind === 'helper' ? [[item.id, item] as const] : [])))
  const asked = new Set(turn.items.flatMap(item => (item.kind === 'prompt' && item.ask.kind === 'approval' && (item.state.s === 'waiting' || item.state.s === 'sending') ? [item.ask.command] : [])))
  const nodes = groupRuns(placeApprovals(turn.items).filter(placed => isShown(placed, turn.items, helpers, now))).map((run): ThreadNode => {
    if ('tools' in run) {
      const steps = run.tools.map(placed => stepView(placed.item, at(placed.at), placed.partner !== null))
      const [first] = steps
      if (steps.length === 1 && first) return { kind: 'step', key: first.key, step: first }
      const last = steps.at(-1)
      return {
        kind: 'group',
        key: `${turn.id}/g${run.tools[0]?.at}`,
        title: last?.state === 'running' ? last.title : groupTitle(run.tools.map(placed => placed.item)),
        count: steps.length,
        stat: groupStat(run.tools.map(placed => placed.item)),
        steps
      }
    }
    const { item, partner } = run.other
    const key = at(run.other.at)
    switch (item.kind) {
      case 'text':
        return { kind: 'prose', key, markdown: trimBlankLines(item.markdown), streaming: !item.sealed }
      case 'prompt':
        return { kind: 'prompt', key, card: promptCard(item, partner !== null, live) }
      case 'notice':
        return item.what === 'closed' ? { kind: 'closed', key, asked: item.asked, end: item.end, words: closedWords(item.asked, item.end) } : { kind: 'notice', key, ...noticeWords(item) }
      case 'reasoning':
        return { kind: 'reasoning', key, text: trimBlankLines(item.text), streaming: !item.sealed, duration: thoughtFor(item) }
      case 'helper':
        return { kind: 'helper', key, helper: helperView(item, key, helpers, asked) }
      case 'plan':
        return { kind: 'plan', key, plan: planView(item, key, !('outcome' in turn)) }
      case 'moa':
        return { kind: 'moa', key, ...moaWords(item), references: item.references }
      case 'status':
        return item.what === 'line'
          ? { kind: 'status', key, about: item.about, text: item.text }
          : { kind: 'notice', key, tone: NOTICE_TONES[item.level], text: item.text, detail: item.detail }
      case 'steer':
        return { kind: 'steer', key, text: item.text }
    }
  })
  return {
    key: turn.id, time, request: turn.request?.text ?? null, attachments: turn.request?.attachments ?? NO_ATTACHMENTS, rowId: turn.request?.rowId ?? null,
    nodes, end: end(nodes),
    tokens: tokenWords(turn.tokens ?? null)
  }
}

const COUNT = new Intl.NumberFormat('en-US')
const NO_ATTACHMENTS: readonly Attachment[] = []

function tokenWords(tokens: Tokens | null): string | null {
  if (tokens === null) return null
  const reasoning = tokens.reasoning > 0 ? `, ${COUNT.format(tokens.reasoning)} reasoning` : ''
  return `${COUNT.format(tokens.input)} in, ${COUNT.format(tokens.output)} out${reasoning}`
}

interface Placed<I extends Item = Item> {
  readonly item: I
  readonly at: number
  readonly partner: Item | null
}

/**
 * An approval sits directly above the tool that ran its command. The real gateway starts the tool and
 * then asks, so the prompt arrives after its tool; a scripted one may ask first. Either way the pair
 * reads "You allowed this once." then "Ran rm ...", and the prompt splits the tool run there.
 */
function placeApprovals(items: readonly Item[]): readonly Placed[] {
  const partners = new Map<number, number>()
  items.forEach((item, at) => {
    if (item.kind !== 'prompt' || item.ask.kind !== 'approval') return
    const { command } = item.ask
    const ran = (index: number) => {
      const tool = items[index]
      return tool?.kind === 'tool' && tool.args.command === command && !partners.has(index)
    }
    const tool = ran(at - 1) ? at - 1 : ran(at + 1) ? at + 1 : null
    if (tool === null) return
    partners.set(at, tool)
    partners.set(tool, at)
  })
  const placed = (at: number): Placed => {
    const partner = partners.get(at)
    return { item: items[at]!, at, partner: partner === undefined ? null : items[partner]! }
  }
  const order: Placed[] = []
  for (let at = 0; at < items.length; at++) {
    if (items[at + 1]?.kind === 'prompt' && partners.get(at + 1) === at) {
      order.push(placed(at + 1), placed(at))
      at++
    } else {
      order.push(placed(at))
    }
  }
  return order
}

type Helpers = ReadonlyMap<HelperId, HelperItem>

function isShown({ item, partner }: Placed, items: readonly Item[], helpers: Helpers, now: number): boolean {
  switch (item.kind) {
    case 'status':
      return isShownAt(item, now)
    case 'text':
      return trimBlankLines(item.markdown) !== ''
    case 'reasoning':
      return item.text.trim() !== ''
    case 'tool':
      if (SHOWN_ELSEWHERE.get(item.name)?.showsTool(items)) return false
      return partner?.kind !== 'prompt' || !isPending(partner)
    case 'helper':
      return item.parentId === null || !helpers.has(item.parentId)
    default:
      return true
  }
}

interface ShownElsewhere {
  readonly showsTool: (items: readonly Item[]) => boolean
  readonly liveEndNode: (nodes: readonly ThreadNode[]) => ThreadNode | undefined
}
const IN_HELPERS: ShownElsewhere = {
  showsTool: items => items.some(item => item.kind === 'helper' && item.parentId === null),
  liveEndNode: nodes => nodes.findLast(node => node.kind === 'helper' && (node.helper.state === 'queued' || node.helper.state === 'working'))
}
const IN_PLAN: ShownElsewhere = {
  showsTool: items => items.some(item => item.kind === 'plan'),
  liveEndNode: nodes => nodes.find(node => node.kind === 'plan')
}
const SHOWN_ELSEWHERE: ReadonlyMap<string, ShownElsewhere> = new Map([['delegate_task', IN_HELPERS], ['todo', IN_PLAN], ['todo_list', IN_PLAN]])

const isPending = (prompt: PromptItem) => prompt.state.s === 'waiting' || prompt.state.s === 'sending'

const trimBlankLines = (markdown: string) => markdown.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '')

type Run = { readonly tools: readonly Placed<ToolItem>[] } | { readonly other: Placed<Exclude<Item, ToolItem>> }

function groupRuns(placed: readonly Placed[]): readonly Run[] {
  const runs: ({ tools: Placed<ToolItem>[] } | { other: Placed<Exclude<Item, ToolItem>> })[] = []
  for (const entry of placed) {
    const last = runs.at(-1)
    if (!isTool(entry)) runs.push({ other: entry as Placed<Exclude<Item, ToolItem>> })
    else if (last && 'tools' in last) last.tools.push(entry)
    else runs.push({ tools: [entry] })
  }
  return runs
}

const isTool = (placed: Placed): placed is Placed<ToolItem> => placed.item.kind === 'tool'

interface ToolWords {
  readonly done: string
  readonly doing: string
  readonly created: string | null
  readonly isCommand: boolean
  subject(args: ToolItem['args']): string | null
}

const SUBJECT_LIMIT = 56

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const basename = (path: unknown) => text(text(path)?.replace(/\/+$/, '').split('/').at(-1))
const command = (args: ToolItem['args']) => text(text(args.command)?.replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*/, ''))
const file = (args: ToolItem['args']) => basename(args.path)

const TOOL_WORDS: { readonly [toolName: string]: ToolWords } = {
  write_file: { done: 'Wrote', doing: 'Writing', created: 'Created', isCommand: false, subject: file },
  patch: { done: 'Edited', doing: 'Editing', created: null, isCommand: false, subject: file },
  terminal: { done: 'Ran', doing: 'Running', created: null, isCommand: true, subject: command },
  process: { done: 'Ran', doing: 'Running', created: null, isCommand: true, subject: command },
  read_file: { done: 'Read', doing: 'Reading', created: null, isCommand: false, subject: file },
  search_files: { done: 'Searched', doing: 'Searching', created: null, isCommand: false, subject: args => text(args.pattern) }
}
const usedWords = (name: string): ToolWords => ({ done: 'Used', doing: 'Using', created: null, isCommand: false, subject: () => name })

const wordsOf = (tool: ToolItem) => TOOL_WORDS[tool.name] ?? usedWords(tool.name)
const diffsOf = (tool: ToolItem) => (tool.status.s === 'done' ? tool.status.diffs : [])

const LABELS = { changes: 'Changes', output: 'Output', result: 'Result', input: 'Input' } as const

/** `waited`: the tool waited on an approval, so its duration counts the time you took to answer. */
function stepView(tool: ToolItem, key: string, waited: boolean): StepView {
  const words = wordsOf(tool)
  const { status } = tool
  const diffs = diffsOf(tool)
  const verb = status.s === 'running' ? words.doing : (diffs[0]?.createsFile && words.created) || words.done
  const subject = clip(words.subject(tool.args) ?? tool.name)

  const sections: RecordSection[] = diffs.map(diff => ({ kind: 'changes', label: null, path: diff.path, lines: changeLines(diff), copy: unifiedDiff(diff) }))
  if (status.s === 'done') {
    const kind = words.isCommand ? 'output' : 'result'
    const body = resultBody(status.result, kind)
    if (body !== null && (diffs.length === 0 || isError(status.result))) sections.push({ kind, label: null, body, copy: copyOf(body) })
  }
  if (diffs.length === 0 && !words.isCommand && Object.keys(tool.args).length > 0) {
    const body = { text: JSON.stringify(tool.args, null, 2), more: 0 }
    sections.push({ kind: 'input', label: null, body, copy: body.text })
  }

  return {
    key,
    title: [{ t: 'text', v: `${verb} ` }, { t: 'code', v: subject }],
    state: status.s,
    stat: sumStat(diffs),
    duration: status.s === 'done' && !waited ? formatDuration(status.durationS) : null,
    image: status.s === 'done' ? status.image : null,
    record: sections.length === 0
      ? null
      : {
          sections: sections.map(section => ({ ...section, label: sections.length === 1 ? null : LABELS[section.kind] })),
          command: words.isCommand ? text(tool.args.command) : null
        }
  }
}

const clip = (subject: string, limit = SUBJECT_LIMIT) => (subject.length > limit ? `${subject.slice(0, limit - 1)}…` : subject)

const copyOf = (body: RecordBody) => ('empty' in body ? null : body.text)

const DIFF_COPY_MARK = { add: '+', del: '-', ctx: ' ' } as const

/**
 * The full diff, so a created file keeps its first hunk header, which `changeLines` drops for display. The target is
 * `/dev/null` only when Hermes's header said so: a `+0,0` hunk alone may empty a file rather than delete it.
 */
function unifiedDiff(diff: FileDiff): string | null {
  if (diff.cut) return null
  const body = diff.lines.map(line => (line.t === 'hunk' ? line.text : `${DIFF_COPY_MARK[line.t]}${line.text}`))
  return [`--- ${diff.createsFile ? '/dev/null' : `a/${diff.path}`}`, `+++ ${diff.deletesFile ? '/dev/null' : `b/${diff.path}`}`, ...body].join('\n') + '\n'
}

function changeLines(diff: FileDiff): FileDiff['lines'] {
  const hunks = diff.lines.filter(line => line.t === 'hunk')
  return diff.createsFile && hunks.length === 1 && diff.lines[0]?.t === 'hunk' ? diff.lines.slice(1) : diff.lines
}

type Result = Extract<ToolItem['status'], { s: 'done' }>['result']

const EMPTY_WORDS = { output: 'No output', result: 'No result' } as const

function resultBody(result: Result, kind: keyof typeof EMPTY_WORDS): RecordBody | null {
  if (result.kind === 'none') return null
  const body = result.kind === 'command' ? result.output : result.text
  return trimBlankLines(body) === '' ? { empty: EMPTY_WORDS[kind] } : { text: trimBlankLines(body), more: result.clipped }
}

const isError = (result: Result) =>
  (result.kind === 'command' && result.exitCode !== null && result.exitCode !== 0) || (result.kind === 'text' && result.isError)

function formatDuration(seconds: number | null): string | null {
  if (seconds === null || seconds < 1) return null
  if (seconds < 10) return `${seconds.toFixed(1)} s`
  if (seconds < 60) return `${Math.round(seconds)} s`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)} min ${whole % 60} s`
}

function thoughtFor({ sealed, startedAt, endedAt }: ReasoningItem): string | null {
  if (!sealed || startedAt === null || endedAt === null) return null
  const ms = endedAt - startedAt
  return ms < 1000 ? 'under a second' : formatDuration(ms / 1000)
}

const GOAL_LIMIT = 120

const HELPER_ENDS = {
  completed: { state: 'done', words: null },
  failed: { state: 'failed', words: 'Failed' },
  timeout: { state: 'failed', words: 'Timed out' },
  interrupted: { state: 'failed', words: 'Stopped' }
} as const satisfies Record<HelperEnd, { readonly state: HelperState; readonly words: string | null }>

const helperState = ({ state }: HelperItem): HelperState => (state.s === 'ended' ? HELPER_ENDS[state.status].state : state.s)

type ToolStep = Extract<HelperItem['steps'][number], { kind: 'tool' }>

const started = (step: ToolStep): Phrase => [{ t: 'text', v: 'Started ' }, { t: 'code', v: clip(step.preview ?? step.name) }]

function toolStepTitle(step: ToolStep): Phrase {
  const words = TOOL_WORDS[step.name]
  if (words === undefined) return [{ t: 'text', v: 'Used ' }, { t: 'code', v: clip(step.name) }]
  return [{ t: 'text', v: `${words.done} ` }, { t: 'code', v: clip(step.preview ?? step.name) }]
}

/** `asked`: commands an approval card waits on. A helper whose newest tool is one of them shows no now line, since it is not running yet. */
function helperView(helper: HelperItem, key: string, helpers: Helpers, asked: ReadonlySet<string>): HelperView {
  const { state } = helper
  const tools = helper.steps.flatMap((step, index) => (step.kind === 'tool' && step.name !== 'delegate_task' ? [{ step, index }] : []))
  const latest = state.s === 'working' ? tools.at(-1)?.index ?? null : null
  return {
    goal: clip(firstLine(helper.goal), GOAL_LIMIT),
    state: helperState(helper),
    ended: state.s === 'ended' ? HELPER_ENDS[state.status].words : null,
    now: asked.has(tools.at(-1)?.step.preview ?? '') ? null : nowOf(state, tools.at(-1)?.step),
    count: helper.toolCount ?? helper.steps.filter(step => step.kind === 'tool').length,
    duration: state.s === 'ended' ? formatDuration(state.durationS) : null,
    steps: helper.steps.flatMap((step, index): HelperStepView[] => {
      if (step.kind === 'tool') {
        if (step.name === 'delegate_task') return []
        return [{ kind: 'step', key: `${key}/s${index}`, title: index === latest ? started(step) : toolStepTitle(step), latest: index === latest }]
      }
      const child = helpers.get(step.id)
      if (child === undefined) return []
      return [{ kind: 'helper', key: `${key}/h${index}`, goal: clip(firstLine(child.goal), GOAL_LIMIT), state: helperState(child), more: helpersUnder(child, helpers) }]
    }),
    summary: state.s === 'ended' && state.summary !== null ? trimBlankLines(state.summary) || null : null
  }
}

function nowOf(state: HelperItem['state'], last: ToolStep | undefined): Phrase | null {
  if (state.s === 'queued') return [{ t: 'text', v: 'Waiting to start' }]
  if (state.s !== 'working') return null
  if (state.doing === 'thinking') return [{ t: 'text', v: 'Thinking' }]
  return state.doing === 'tool' && last !== undefined ? started(last) : null
}

function helpersUnder(helper: HelperItem, helpers: Helpers): number {
  const seen = new Set<HelperId>([helper.id])
  const visit = (parent: HelperItem): void => {
    for (const step of parent.steps) {
      const child = step.kind === 'helper' ? helpers.get(step.id) : undefined
      if (child === undefined || seen.has(child.id)) continue
      seen.add(child.id)
      visit(child)
    }
  }
  visit(helper)
  return seen.size - 1
}

const PLAN_STATES = {
  pending: 'todo', in_progress: 'doing', completed: 'done', cancelled: 'cancelled'
} as const satisfies Record<PlanEntry['status'], PlanEntryView['state']>

function planView(plan: PlanItem, key: string, open: boolean): PlanView {
  const cancelled = plan.entries.filter(entry => entry.status === 'cancelled').length
  return {
    done: plan.entries.filter(entry => entry.status === 'completed').length,
    total: plan.entries.length - cancelled,
    cancelled,
    entries: parentsFirst(plan.entries).map(({ entry, depth }) => ({ key: `${key}/e${entry.id}`, text: entry.text, state: PLAN_STATES[entry.status], depth })),
    openByDefault: open
  }
}

function parentsFirst(entries: readonly PlanEntry[]): readonly { readonly entry: PlanEntry; readonly depth: number }[] {
  const ids = new Set(entries.map(entry => entry.id))
  const placed = new Set<string>()
  const out: { entry: PlanEntry; depth: number }[] = []
  const visit = (entry: PlanEntry, depth: number): void => {
    if (placed.has(entry.id)) return
    placed.add(entry.id)
    out.push({ entry, depth })
    for (const child of entries) if (child.parentId === entry.id) visit(child, depth + 1)
  }
  for (const entry of entries) if (entry.parentId === null || !ids.has(entry.parentId)) visit(entry, 0)
  for (const entry of entries) visit(entry, 0)
  return out
}

function sumStat(diffs: readonly FileDiff[]): DiffStat | null {
  if (diffs.length === 0) return null
  return { added: diffs.reduce((n, diff) => n + diff.added, 0), removed: diffs.reduce((n, diff) => n + diff.removed, 0) }
}

function groupStat(tools: readonly ToolItem[]): DiffStat | null {
  const diffs = tools.flatMap(diffsOf)
  return new Set(diffs.map(diff => diff.path)).size > 1 ? sumStat(diffs) : null
}

function groupTitle(tools: readonly ToolItem[]): Phrase {
  const files = new Map<string, { created: boolean; more: boolean }>()
  for (const diff of tools.flatMap(diffsOf)) {
    const seen = files.get(diff.path)
    if (seen) seen.more = true
    else files.set(diff.path, { created: diff.createsFile, more: false })
  }
  const parts: Phrase[] = [...files].map(([path, { created, more }]) => [
    { t: 'text', v: `${created ? (more ? 'Created and edited' : 'Created') : 'Edited'} ` },
    { t: 'code', v: basename(path) ?? path }
  ])
  const commands = tools.filter(tool => wordsOf(tool).isCommand)
  const [only] = commands
  if (commands.length === 1 && only) parts.push([{ t: 'text', v: 'Ran ' }, { t: 'code', v: clip(command(only.args) ?? only.name) }])
  else if (commands.length > 1) parts.push([{ t: 'text', v: `Ran ${commands.length} commands` }])
  if (parts.length === 0) return [{ t: 'text', v: `Used ${tools.length} tools` }]
  return joinParts(parts)
}

function joinParts(parts: readonly Phrase[]): Phrase {
  return mergeText(parts.flatMap((part, index): Phrase => {
    if (index === 0) return part
    const [head, ...rest] = part
    if (!head) return []
    const separator = index === parts.length - 1 ? ' and ' : ', '
    return [{ t: 'text', v: separator }, { t: head.t, v: head.v.charAt(0).toLowerCase() + head.v.slice(1) }, ...rest]
  }))
}

function mergeText(pieces: Phrase): Phrase {
  return pieces.reduce<{ t: 'text' | 'code'; v: string }[]>((merged, piece) => {
    const previous = merged.at(-1)
    if (piece.t === 'text' && previous?.t === 'text') previous.v += piece.v
    else merged.push({ ...piece })
    return merged
  }, [])
}

type Role = 'primary' | 'plain' | 'decline'

const APPROVAL_CHOICES: { readonly [choice: string]: { readonly label: string; readonly role: Role; readonly answered: string } } = {
  once: { label: 'Run once', role: 'primary', answered: 'You allowed this once.' },
  session: { label: 'Allow in this chat', role: 'plain', answered: 'You allowed this for this chat.' },
  always: { label: 'Always allow', role: 'plain', answered: 'You allowed commands like this from now on.' },
  deny: { label: "Don't run", role: 'decline', answered: 'You said no.' }
}
const ROLE_ORDER = { primary: 0, plain: 1, decline: 2 } as const satisfies Record<Role, number>

const PROMPT_WORDS = {
  approval: { heading: 'Run this command?', freeText: false },
  clarify: { heading: 'Hermes has a question', freeText: true }
} as const satisfies Record<PromptItem['ask']['kind'], { heading: string; freeText: boolean }>

function alwaysConfirm(ask: Extract<PromptItem['ask'], { kind: 'approval' }>): PromptButton['confirm'] {
  return {
    title: 'Always allow commands like this?',
    body: `Hermes won't ask again for commands matching “${ask.reason ?? ask.command}”, in this chat or any other.`
  }
}

function promptPick(ask: PromptItem['ask']): PromptPick {
  if (ask.kind === 'clarify' && ask.multi) return { kind: 'many', choices: ask.choices }
  const choices = ask.kind === 'approval' ? APPROVAL_CHOICES : {}
  const buttons = ask.choices
    .map((value): PromptButton => ({
      reply: { kind: 'choice', value },
      label: choices[value]?.label ?? value,
      role: choices[value]?.role ?? 'plain',
      confirm: ask.kind === 'approval' && value === 'always' ? alwaysConfirm(ask) : null
    }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
  return { kind: 'one', buttons, freeText: PROMPT_WORDS[ask.kind].freeText }
}

function promptCard(prompt: PromptItem, paired: boolean, live: boolean): PromptCard {
  const { ask, state } = prompt
  if (state.s === 'waiting' || state.s === 'sending') {
    return {
      state: 'asking',
      promptId: prompt.id,
      heading: PROMPT_WORDS[ask.kind].heading,
      command: ask.kind === 'approval' ? ask.command : null,
      why: ask.kind === 'approval' ? (ask.reason === null ? null : `Hermes flagged it as “${ask.reason}”.`) : ask.question,
      pick: promptPick(ask),
      busy: state.s === 'sending' || !live,
      error: state.s === 'waiting' ? state.error : null
    }
  }
  return {
    state: 'answered',
    words: answeredWords(prompt, state),
    command: ask.kind === 'approval' && !paired ? ask.command : null
  }
}

function answeredWords(prompt: PromptItem, state: Exclude<PromptItem['state'], { s: 'waiting' | 'sending' }>): string {
  if (state.s === 'withdrawn') return 'Hermes withdrew this request.'
  const { reply } = state
  if (reply === null) return 'Answered from another window.'
  const { ask } = prompt
  if (ask.kind === 'approval' || reply.kind === 'deny') {
    const value = reply.kind === 'deny' ? 'deny' : reply.value
    return (ask.kind === 'approval' && reply.kind !== 'text' ? APPROVAL_CHOICES[value]?.answered : undefined) ?? `You answered “${value}”.`
  }
  const answers = (ask.multi ? multiAnswers(reply.value) : null) ?? [reply.value]
  const quoted = answers.filter(answer => answer !== '').map(answer => `“${answer}”`)
  const last = quoted.pop()
  if (last === undefined) return 'You skipped this question.'
  return `You answered ${quoted.length === 0 ? last : `${quoted.join(', ')} and ${last}`}.`
}

interface CardWords { readonly heading: string; readonly label: string; readonly answered: string }

const SECRET_WORDS = {
  sudo: { heading: 'Hermes needs your sudo password', label: 'Password', answered: 'You sent a password.' },
  env: { heading: 'Hermes needs a secret', label: 'Secret value', answered: 'You sent the secret.' },
  vault: null,
  login: null,
  code: null
} as const satisfies Record<SecretFor['is'], CardWords | null>

const wordsOfSecret = (is: Asked): CardWords | null => (is in SECRET_WORDS ? SECRET_WORDS[is as SecretFor['is']] : null)

const END_WORDS = {
  answered: null,
  skipped: 'You skipped this.',
  elsewhere: 'Answered from another window.',
  done: 'Answered from another window.',
  timeout: 'Nobody answered in time, so Hermes stopped waiting.',
  interrupted: 'Hermes withdrew this request.',
  withdrawn: 'Hermes withdrew this request.'
} as const satisfies Record<RequestEnd, string | null>

function closedWords(asked: Asked, end: RequestEnd): string | null {
  const card = wordsOfSecret(asked)
  return card === null ? null : END_WORDS[end] ?? card.answered
}

function askCard(request: HermesRequest, live: boolean, clock: ViewClock): readonly AskCard[] {
  const { ask, state, deadline } = request
  if (ask.kind !== 'secret') return []
  const words = wordsOfSecret(ask.for.is)
  if (words === null) return []
  const { for: secret } = ask
  return [{
    key: `ask:${request.id}`,
    requestId: request.id,
    heading: words.heading,
    command: secret.is === 'sudo' ? secret.command : null,
    why: secret.is === 'env' ? secret.prompt : null,
    name: secret.is === 'env' ? secret.name : null,
    label: words.label,
    waits: deadline === null ? null : `Hermes waits until ${timeOfDay(deadline, clock.timeZone)}.`,
    busy: state.s === 'sending' || !live,
    error: state.s === 'waiting' ? state.error : null
  }]
}

const DECLINED_WORDS: { readonly [method: string]: string } = {
  setup_beat: "Hermes asked to show a setup step. Highwing can't show that yet, so it said no."
}

function noticeWords(notice: Exclude<NoticeItem, { what: 'closed' }>): { readonly tone: 'error' | 'info'; readonly text: string; readonly detail: null } {
  if (notice.what === 'said') return { tone: notice.tone, text: notice.text, detail: null }
  const method = notice.method.split('.')[0] ?? notice.method
  return { tone: 'info', text: DECLINED_WORDS[method] ?? `Hermes sent a request Highwing can't show yet (${notice.method}), so it said no.`, detail: null }
}

const PAUSED_WORDS = {
  opening: 'Opening this chat.',
  offline: 'Paused while Highwing is disconnected.',
  'catching-up': 'Catching up after the connection dropped.',
  rebuilding: 'Catching up after the connection dropped.',
  unavailable: "Highwing can't reach this chat right now."
} as const satisfies Record<Exclude<Sync['state'], 'live'>, string>

const TIP_WORDS = {
  idle: 'Thinking',
  thinking: 'Thinking',
  writing: 'Writing',
  stopping: 'Stopping'
} as const satisfies Record<Exclude<TurnActivity['kind'], 'preparing' | 'working' | 'asking' | 'reasoning' | 'helping'>, string>

function openEnd(turn: Turn, nodes: readonly ThreadNode[], activity: TurnActivity, sync: Sync['state'], clock: ViewClock): ThreadEnd {
  if (sync !== 'live') return { kind: 'paused', words: PAUSED_WORDS[sync] }
  const elapsed = elapsedWords(turn.began?.at ?? null, clock.now)
  const tip = (words: string): ThreadEnd => ({ kind: 'tip', words: [{ t: 'text', v: words }], elapsed })
  const liveOn = (node: ThreadNode | undefined): ThreadEnd => (node === undefined ? tip(TIP_WORDS.thinking) : { kind: 'at', nodeKey: node.key, tone: 'live', elapsed })
  const nodeOf = (item: number) => {
    const key = `${turn.id}/${item}`
    return nodes.find(n => n.key === key || (n.kind === 'group' && n.steps.some(step => step.key === key)))
  }
  switch (activity.kind) {
    case 'asking':
      return { kind: 'at', nodeKey: nodeOf(activity.item)?.key ?? `${turn.id}/${activity.item}`, tone: 'asking' }
    case 'working': {
      const tool = turn.items[activity.item]
      const shownIn = tool?.kind === 'tool' ? SHOWN_ELSEWHERE.get(tool.name) : undefined
      return liveOn(nodeOf(activity.item) ?? shownIn?.liveEndNode(nodes))
    }
    case 'reasoning':
    case 'helping':
      return liveOn(nodeOf(activity.item))
    case 'preparing':
      return { kind: 'tip', words: [{ t: 'text', v: 'Preparing ' }, { t: 'code', v: activity.tool }], elapsed }
    default:
      return tip(TIP_WORDS[activity.kind])
  }
}

const LOST_WORDS = 'Ended while Highwing was disconnected.'
const NO_END: ThreadEnd = { kind: 'none' }

function settledEnd(outcome: Outcome): ThreadEnd {
  switch (outcome.kind) {
    case 'complete': return { kind: 'done', words: 'Done' }
    case 'failed': return { kind: 'failed', words: failureWords(outcome) }
    case 'stopped': return { kind: 'stopped', words: 'Stopped' }
    case 'lost': return { kind: 'lost', words: LOST_WORDS }
    case 'interlude': return NO_END
  }
}

/** Codes are Hermes's `FailoverReason` values (`agent/error_classifier.py`). */
const FAILURE_WORDS: { readonly [code: string]: string } = {
  auth_permanent: "Hermes couldn't sign in to its model provider. Check the provider's key or sign-in in Hermes.",
  auth: 'The model provider turned down Hermes\'s sign-in.',
  billing: 'The model provider says the account is out of credit.',
  rate_limit: 'The model provider is limiting requests. Try again in a moment.',
  upstream_rate_limit: 'The model provider is limiting requests. Try again in a moment.',
  overloaded: 'The model provider is overloaded. Try again in a moment.',
  server_error: 'The model provider had an error. Try again.',
  timeout: 'The model provider took too long to answer.',
  context_overflow: 'This chat is too long for the model.',
  model_not_found: "The model provider doesn't offer the chosen model.",
  content_policy_blocked: 'The model provider refused this request.'
}

export function failureWords(outcome: Extract<Outcome, { kind: 'failed' }>): string {
  return (outcome.code !== null ? FAILURE_WORDS[outcome.code] : undefined) ?? outcome.message
}

const END_GLYPH = { done: '✓', failed: '✗', stopped: '⊘', lost: '~', paused: '◌' } as const

/**
 * The view as text, one line per node, for golden tests, bug reports and a replay CLI:
 *
 *   @ Today 14:05                                              time line, when the turn has one
 *   + [image] error.png  [file] contract.pdf                   what was sent with the request, when anything was
 *   > make notes.md with a three-item todo list ...            request
 *   | I'll create the notes file first, then make the edit.    prose (first line)
 *   ■ Created and edited `notes.md` · 2 steps                  group, its steps indented under it
 *       ● Created `notes.md`  +5
 *   ● Ran `ls -la && ls scratch`                               step
 *   ○ You allowed this once.                                   answered prompt
 *   ◆ Run this command?                                        asking prompt, its command, reason and buttons indented
 *   ! Hermes asked for your sudo password. ...                 notice, `! warn:` or `! error:` for those tones
 *   ≋ Asking 3 models · Combining their answers                MoA round, its references indented when opened
 *   · goal: Goal achieved ...                                  status line, its kind when not `other`
 *   ○ You sent a password.                                     where a request with a card closed, in its words
 *   ◇ code: elsewhere                                          where a request with no card closed, and how
 *   » use trash-put instead                                    words the user put into the running turn
 *   ✓ Done                                                     end: ✓ done, ✗ failed, ⊘ stopped, ~ lost, each with its words
 *     1,204 in, 380 out                                        what the reply used, when Hermes said
 *
 *   ▸ Thought                                                  reasoning, ` …` after it while it streams
 *   ◆ Helper Check disk usage · 1 step  3.3 s                  helper: ◆ done or failed, ◇ queued or working,
 *       Started `du -sh`                                       its now line while closed and working
 *   ☐ Plan · 1 of 3 done                                       plan: ☑ once every entry is done
 *
 *   ◈ Hermes needs your sudo password                          ask card, after the turns: its command, why, variable
 *       Hermes waits until 14:07.                               name, wait, its field and buttons, and its error
 *
 * `◉` replaces the glyph of the node that carries the live end, or opens a tip line ("◉ Thinking").
 * Once a minute has passed the live end adds `, 3 min` after its words. `◌` is a paused end. `⋯` is a
 * pending message. Keys in `opened` print what that row holds under it: a step's record sections,
 * a reasoning block's text, a helper's steps and summary, a plan's entries.
 */
export function outline(view: ThreadView, opened: ReadonlySet<string> = new Set()): string {
  const lines: string[] = []
  if (view.state !== 'ready') lines.push(`(${view.state})`)
  if (view.earlier !== 'none') lines.push(`… earlier turns${view.earlier === 'loading' ? ' (loading)' : ''}`)
  view.turns.forEach((turn, index) => {
    if (index > 0) lines.push('')
    if (turn.time !== null) lines.push(`@ ${turn.time}`)
    if (turn.attachments.length > 0) lines.push(attachmentLine(turn.attachments))
    if (turn.request !== null) lines.push(`> ${firstLine(turn.request)}`)
    const liveKey = turn.end.kind === 'at' ? turn.end.nodeKey : null
    const elapsed = turn.end.kind === 'at' && turn.end.tone === 'live' ? turn.end.elapsed : null
    for (const node of turn.nodes) lines.push(...nodeLines(node, node.key === liveKey, elapsed, opened))
    const end = endLine(turn.end)
    if (end !== null) lines.push(end)
    if (turn.tokens !== null) lines.push(`  ${turn.tokens}`)
  })
  for (const card of view.asks) lines.push(...askLines(card))
  for (const message of view.pending) {
    if (message.attachments.length > 0) lines.push(attachmentLine(message.attachments))
    lines.push(`⋯ ${firstLine(message.text)}  (${message.status}${message.detail ? `: ${message.detail}` : ''})`)
  }
  return lines.join('\n')
}

const attachmentLine = (attachments: readonly Attachment[]) => `+ ${attachments.map(({ kind, name }) => `[${kind}] ${name}`).join('  ')}`

function askLines(card: AskCard): string[] {
  return [
    `◈ ${card.heading}${card.busy ? '  (busy)' : ''}`,
    ...(card.command === null ? [] : [`    ${card.command}`]),
    ...(card.why === null ? [] : [`    ${card.why}`]),
    ...(card.name === null ? [] : [`    ${card.name}`]),
    ...(card.waits === null ? [] : [`    ${card.waits}`]),
    `    (${card.label}) [Skip] [Send]`,
    ...(card.error === null ? [] : [`    ! ${card.error}`])
  ]
}

function pickLine(pick: PromptPick): string {
  if (pick.kind === 'many') return [...pick.choices, 'Other'].map(choice => `[ ] ${choice}`).join('  ') + '  [Answer] [Skip]'
  return `${pick.buttons.map(button => `[${button.label}]`).join(' ')}${pick.freeText ? ' [Type an answer]' : ''}`
}

function nodeLines(node: ThreadNode, live: boolean, elapsed: string | null, opened: ReadonlySet<string>): string[] {
  switch (node.kind) {
    case 'prose':
      return [`| ${firstLine(node.markdown)}${node.streaming ? ' …' : ''}`]
    case 'step':
      return stepLines(node.step, live ? '◉' : '●', '', live ? elapsed : null, opened)
    case 'group':
      return [
        `${live ? '◉' : '■'} ${phrase(node.title)} · ${node.count} steps${live ? elapsedSuffix(elapsed) : ''}${meta(node.stat, null)}`,
        ...node.steps.flatMap(step => stepLines(step, '●', '    ', null, opened))
      ]
    case 'prompt': {
      const { card } = node
      if (card.state === 'answered') return [`○ ${card.words}${card.command === null ? '' : ` \`${card.command}\``}`]
      return [
        `◆ ${card.heading}${card.busy ? '  (busy)' : ''}`,
        ...(card.command === null ? [] : [`    ${card.command}`]),
        ...(card.why === null ? [] : [`    ${card.why}`]),
        `    ${pickLine(card.pick)}`,
        ...(card.error === null ? [] : [`    ! ${card.error}`])
      ]
    }
    case 'notice': {
      const head = `! ${node.tone === 'info' ? '' : `${node.tone}: `}${firstLine(node.text)}`
      return node.detail !== null && opened.has(node.key) ? [head, ...node.detail.split('\n').map(line => `    ${line}`)] : [head]
    }
    case 'closed':
      return [node.words === null ? `◇ ${node.asked}: ${node.end}` : `○ ${node.words}`]
    case 'reasoning': {
      const head = `${live ? '◉' : '▸'} Thought${node.streaming ? ' …' : ''}${live ? elapsedSuffix(elapsed) : ''}`
      return opened.has(node.key) ? [head, ...node.text.split('\n').map(line => `    ${line}`)] : [head]
    }
    case 'helper':
      return helperLines(node.key, node.helper, live, elapsed, opened)
    case 'plan': {
      const { plan } = node
      const glyph = live ? '◉' : plan.total > 0 && plan.done === plan.total ? '☑' : '☐'
      const head = `${glyph} Plan · ${plan.done} of ${plan.total} done${plan.cancelled > 0 ? `, ${plan.cancelled} cancelled` : ''}${live ? elapsedSuffix(elapsed) : ''}`
      if (!opened.has(node.key)) return [head]
      return [head, ...plan.entries.map(entry => `    ${'  '.repeat(entry.depth)}${ENTRY_MARK[entry.state]} ${entry.text}`)]
    }
    case 'steer':
      return [`» ${firstLine(node.text)}`]
    case 'moa': {
      const head = `≋ ${node.title}${node.meta === null ? '' : ` · ${node.meta}`}`
      return opened.has(node.key) ? [head, ...node.references.map(({ label, text }) => `    ${label}: ${firstLine(text)}`)] : [head]
    }
    case 'status':
      return [`· ${node.about === 'other' ? '' : `${node.about}: `}${firstLine(node.text)}`]
  }
}

const ENTRY_MARK = { todo: '[ ]', doing: '[>]', done: '[x]', cancelled: '[-]' } as const satisfies Record<PlanEntryView['state'], string>

const isEnded = (state: HelperState) => state === 'done' || state === 'failed'
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

function helperLines(key: string, helper: HelperView, live: boolean, elapsed: string | null, opened: ReadonlySet<string>): string[] {
  const glyph = live ? '◉' : isEnded(helper.state) ? '◆' : '◇'
  const head = `${glyph} Helper ${helper.goal} · ${plural(helper.count, 'step')}${live ? elapsedSuffix(elapsed) : ''}${helper.ended === null ? '' : `  (${helper.ended})`}${meta(null, helper.duration)}`
  if (!opened.has(key)) return helper.now === null ? [head] : [head, `    ${phrase(helper.now)}`]
  return [
    head,
    ...helper.steps.map(step => step.kind === 'step'
      ? `    ${step.latest ? '○' : '●'} ${phrase(step.title)}`
      : `    ${isEnded(step.state) ? '◆' : '◇'} Helper ${step.goal}${step.more > 0 ? `  and ${plural(step.more, 'helper')} of its own` : ''}`),
    ...(helper.summary === null ? [] : [`    Helper's summary: ${firstLine(helper.summary)}`])
  ]
}

function stepLines(step: StepView, glyph: string, indent: string, elapsed: string | null, opened: ReadonlySet<string>): string[] {
  const head = `${indent}${glyph} ${phrase(step.title)}${elapsedSuffix(elapsed)}${meta(step.stat, step.duration)}${step.state === 'cut' ? '  (cut)' : ''}`
  if (!opened.has(step.key) || step.record === null) return [head]
  const pad = `${indent}    `
  return [head, ...step.record.sections.flatMap(section => [
    ...(section.label === null ? [] : [`${pad}${section.label}`]),
    ...sectionLines(section).map(line => `${pad}  ${line}`)
  ])]
}

const DIFF_MARK = { hunk: '', add: '+ ', del: '- ', ctx: '  ' } as const

function sectionLines(section: RecordSection): string[] {
  if (section.kind === 'changes') return [section.path, ...section.lines.map(line => `${DIFF_MARK[line.t]}${line.text}`)]
  if ('empty' in section.body) return [section.body.empty]
  return [...section.body.text.split('\n'), ...(section.body.more > 0 ? [`… ${section.body.more} more characters`] : [])]
}

function endLine(end: ThreadEnd): string | null {
  switch (end.kind) {
    case 'at':
    case 'none': return null
    case 'tip': return `◉ ${phrase(end.words)}${elapsedSuffix(end.elapsed)}`
    default: return `${END_GLYPH[end.kind]} ${end.words}`
  }
}

const elapsedSuffix = (elapsed: string | null) => (elapsed === null ? '' : `, ${elapsed}`)

function meta(stat: DiffStat | null, duration: string | null): string {
  const parts = [
    ...(stat === null ? [] : [[stat.added > 0 ? `+${stat.added}` : '', stat.removed > 0 ? `-${stat.removed}` : ''].filter(Boolean).join(' ') || '±0']),
    ...(duration === null ? [] : [duration])
  ]
  return parts.length === 0 ? '' : `  ${parts.join('  ')}`
}

const phrase = (words: Phrase) => words.map(piece => (piece.t === 'code' ? `\`${piece.v}\`` : piece.v)).join('')
const firstLine = (value: string) => value.split('\n')[0] ?? ''

const SETTLED_ENDS: ReadonlySet<ThreadEnd['kind']> = new Set(['done', 'failed', 'stopped', 'lost', 'none'])

/**
 * Properties every view must hold, checked on every prefix of every fixture. Returns the
 * violations, empty when the view is sound.
 */
export function checkThread(view: ThreadView): string[] {
  const problems: string[] = []
  const keys = new Set<string>()
  const claim = (key: string) => {
    if (keys.has(key)) problems.push(`key ${key} is used twice`)
    keys.add(key)
  }
  view.turns.forEach((turn, index) => {
    const where = `turn ${turn.key}`
    const last = index === view.turns.length - 1
    const settled = SETTLED_ENDS.has(turn.end.kind)
    claim(turn.key)
    if (turn.time === '') problems.push(`${where}: the time line is an empty string`)
    if (turn.tokens !== null && !settled) problems.push(`${where}: shows token counts before it ended`)
    for (const node of turn.nodes) {
      claim(node.key)
      if (node.kind === 'helper') node.helper.steps.forEach(step => claim(step.key))
      if (node.kind === 'plan') node.plan.entries.forEach(entry => claim(entry.key))
      if (node.kind === 'group') {
        node.steps.forEach(step => claim(step.key))
        if (node.steps.length < 2) problems.push(`${where}: group ${node.key} has ${node.steps.length} step`)
        if (node.count !== node.steps.length) problems.push(`${where}: group ${node.key} counts ${node.count} of ${node.steps.length} steps`)
      }
      if (node.kind === 'step' && node.step.key !== node.key) problems.push(`${where}: step node ${node.key} holds step ${node.step.key}`)
    }
    const streaming = turn.nodes.filter(node => node.kind === 'prose' && node.streaming)
    if (streaming.length > 1) problems.push(`${where}: ${streaming.length} prose nodes are streaming`)
    if (streaming.length === 1 && turn.nodes.at(-1) !== streaming[0]) problems.push(`${where}: streaming prose is not the last node`)
    const plans = turn.nodes.filter(node => node.kind === 'plan')
    if (plans.length > 1) problems.push(`${where}: ${plans.length} plan nodes`)
    const thinking = turn.nodes.filter(node => node.kind === 'reasoning' && node.streaming)
    if (thinking.length > 1) problems.push(`${where}: ${thinking.length} reasoning nodes are streaming`)
    if (!last && !settled) problems.push(`${where}: only the last turn may be unsettled, this one ends ${turn.end.kind}`)
    // A settled turn may hold a working helper: Hermes runs helpers in the background.
    if (settled) {
      if (streaming.length > 0) problems.push(`${where}: ends ${turn.end.kind} while prose streams`)
      if (thinking.length > 0) problems.push(`${where}: ends ${turn.end.kind} while reasoning streams`)
      const steps = turn.nodes.flatMap(node => (node.kind === 'step' ? [node.step] : node.kind === 'group' ? node.steps : []))
      if (steps.some(step => step.state === 'running')) problems.push(`${where}: ends ${turn.end.kind} while a step runs`)
      if (turn.nodes.some(node => node.kind === 'prompt' && node.card.state === 'asking')) problems.push(`${where}: ends ${turn.end.kind} while a prompt asks`)
    }
    const { end } = turn
    if (end.kind === 'at') {
      const node = turn.nodes.find(n => n.key === end.nodeKey)
      if (!node) problems.push(`${where}: the end sits on ${end.nodeKey}, which is not a node`)
      else if (end.tone === 'asking' && !(node.kind === 'prompt' && node.card.state === 'asking'))
        problems.push(`${where}: the asking end sits on ${node.kind} ${node.key}`)
      else if (end.tone === 'live' && !carriesLiveEnd(node))
        problems.push(`${where}: the live end sits on ${node.kind} ${node.key}`)
    }
  })
  for (const message of view.pending) claim(message.key)
  return problems
}

function carriesLiveEnd(node: ThreadNode): boolean {
  switch (node.kind) {
    case 'step':
    case 'group':
    case 'plan':
      return true
    case 'reasoning':
      return node.streaming
    case 'helper':
      return !isEnded(node.helper.state)
    default:
      return false
  }
}
