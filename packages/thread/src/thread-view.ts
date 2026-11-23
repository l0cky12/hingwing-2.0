import {
  activityOf,
  type Activity, type FileDiff, type Item, type NoticeItem, type Outcome, type PromptId, type PromptItem, type PromptReply,
  type Session, type SettledTurn, type Sync, type ToolItem, type Turn
} from '@highwing/hermes/domain'
import { changesAt, elapsedWords, timeLines, type ViewClock } from './when'

export type { ViewClock }

/** Text with literal parts. `code` is set in JetBrains Mono; nothing here is HTML. */
export type Phrase = readonly { readonly t: 'text' | 'code'; readonly v: string }[]

export interface ThreadView {
  readonly state: 'opening' | 'ready' | 'unavailable'
  readonly turns: readonly TurnView[]
  /** Messages sent and not yet picked up, shown under the last turn. */
  readonly pending: readonly { readonly key: string; readonly text: string; readonly status: 'sending' | 'queued' | 'failed'; readonly detail: string | null }[]
  readonly earlier: Session['earlier']
  /**
   * The earliest instant after the clock's `now` at which the same session would read differently
   * (an elapsed time ticks over, a time line appears or says a new day), or null when none will.
   */
  readonly changesAt: number | null
}

export interface TurnView {
  /** Stable for the life of the turn. Node keys below are stable while the turn only grows. */
  readonly key: string
  /** The quiet line above the request: "Today 14:05". null draws nothing. Never the empty string. */
  readonly time: string | null
  readonly request: string | null
  /** Top to bottom along the thread. */
  readonly nodes: readonly ThreadNode[]
  readonly end: ThreadEnd
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
  | { readonly kind: 'notice'; readonly key: string; readonly tone: 'error' | 'info'; readonly text: string }

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

export interface DiffStat { readonly added: number; readonly removed: number }

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
}

export interface RecordView { readonly sections: readonly RecordSection[] }
/** A clipped text, or the words to show when there is none ("No output"). */
export type RecordBody = { readonly text: string; readonly more: number } | { readonly empty: string }
/** `label` is null when the record has a single section. */
export type RecordSection =
  | { readonly kind: 'changes'; readonly label: string | null; readonly path: string; readonly lines: FileDiff['lines'] }
  | { readonly kind: 'output' | 'result' | 'input'; readonly label: string | null; readonly body: RecordBody }

export type PromptCard =
  | {
      readonly state: 'asking'
      readonly promptId: PromptId
      readonly heading: string
      /** The command for an approval, long tokens wrapped by CSS. null for a clarify. */
      readonly command: string | null
      /** Why Hermes asks: its flagged reason in a sentence, or its question as given. */
      readonly why: string | null
      readonly buttons: readonly { readonly reply: PromptReply; readonly label: string; readonly role: 'primary' | 'plain' | 'decline' }[]
      readonly freeText: boolean
      /** An answer is on its way, or the session is not live. Buttons are disabled, the card stays amber. */
      readonly busy: boolean
      readonly error: string | null
    }
  /** Hollow caution ring. `command` is null when the step next to the card already shows it. */
  | { readonly state: 'answered'; readonly words: string; readonly command: string | null }

const VIEW_STATE = {
  opening: 'opening', live: 'ready', offline: 'ready', 'catching-up': 'ready', rebuilding: 'ready', unavailable: 'unavailable'
} as const satisfies Record<Sync['state'], ThreadView['state']>

const settledViews = new WeakMap<SettledTurn, TurnView>()

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
  const settled = session.history.map((turn, index) => settledView(turn, lines[index] ?? null))
  const open = run.state === 'running'
    ? turnView(run.turn, lines.at(-1) ?? null, sync.state === 'live', nodes => openEnd(run.turn, nodes, activityOf(session), sync.state, clock))
    : null
  const elapsing = open !== null && (open.end.kind === 'tip' || (open.end.kind === 'at' && open.end.tone === 'live'))
  return {
    state: VIEW_STATE[sync.state],
    turns: open === null ? settled : [...settled, open],
    pending: session.outbox.map(entry => ({
      key: entry.inputId,
      text: entry.text,
      status: entry.state.s,
      detail: entry.state.s === 'failed' ? entry.state.message : null
    })),
    earlier: session.earlier,
    changesAt: changesAt(starts, lines, elapsing ? starts.at(-1) ?? null : null, clock)
  }
}

function settledView(turn: SettledTurn, time: string | null): TurnView {
  const memo = settledViews.get(turn)
  if (memo?.time === time) return memo
  const view = memo === undefined ? turnView(turn, time, false, () => settledEnd(turn.outcome)) : { ...memo, time }
  settledViews.set(turn, view)
  return view
}

function turnView(turn: Turn, time: string | null, live: boolean, end: (nodes: readonly ThreadNode[]) => ThreadEnd): TurnView {
  const at = (index: number) => `${turn.id}/${index}`
  const nodes = groupRuns(placeApprovals(turn.items).filter(isShown)).map((run): ThreadNode => {
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
        return { kind: 'notice', key, ...noticeWords(item) }
    }
  })
  return { key: turn.id, time, request: turn.request?.text ?? null, nodes, end: end(nodes) }
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

function isShown({ item, partner }: Placed): boolean {
  if (item.kind === 'text') return trimBlankLines(item.markdown) !== ''
  if (item.kind === 'tool' && partner?.kind === 'prompt') return !isPending(partner)
  return true
}

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

  const sections: RecordSection[] = diffs.map(diff => ({ kind: 'changes', label: null, path: diff.path, lines: changeLines(diff) }))
  if (status.s === 'done') {
    const kind = words.isCommand ? 'output' : 'result'
    const body = resultBody(status.result, kind)
    if (body !== null && (diffs.length === 0 || isError(status.result))) sections.push({ kind, label: null, body })
  }
  if (diffs.length === 0 && !words.isCommand && Object.keys(tool.args).length > 0)
    sections.push({ kind: 'input', label: null, body: { text: JSON.stringify(tool.args, null, 2), more: 0 } })

  return {
    key,
    title: [{ t: 'text', v: `${verb} ` }, { t: 'code', v: subject }],
    state: status.s,
    stat: sumStat(diffs),
    duration: status.s === 'done' && !waited ? formatDuration(status.durationS) : null,
    record: sections.length === 0
      ? null
      : { sections: sections.map(section => ({ ...section, label: sections.length === 1 ? null : LABELS[section.kind] })) }
  }
}

const clip = (subject: string) => (subject.length > SUBJECT_LIMIT ? `${subject.slice(0, SUBJECT_LIMIT - 1)}…` : subject)

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

function promptCard(prompt: PromptItem, paired: boolean, live: boolean): PromptCard {
  const { ask, state } = prompt
  if (state.s === 'waiting' || state.s === 'sending') {
    const choices = ask.kind === 'approval' ? APPROVAL_CHOICES : {}
    const buttons = ask.choices
      .map(value => ({ reply: { kind: 'choice', value } as const, label: choices[value]?.label ?? value, role: choices[value]?.role ?? 'plain' }))
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
    return {
      state: 'asking',
      promptId: prompt.id,
      heading: PROMPT_WORDS[ask.kind].heading,
      command: ask.kind === 'approval' ? ask.command : null,
      why: ask.kind === 'approval' ? (ask.reason === null ? null : `Hermes flagged it as “${ask.reason}”.`) : ask.question,
      buttons,
      freeText: PROMPT_WORDS[ask.kind].freeText,
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
  const known = prompt.ask.kind === 'approval' && reply.kind === 'choice' ? APPROVAL_CHOICES[reply.value] : undefined
  return known?.answered ?? `You answered “${reply.value}”.`
}

const DECLINED_WORDS: { readonly [method: string]: string } = {
  sudo: "Hermes asked for your sudo password. Highwing can't show that prompt yet, so it said no.",
  secret: "Hermes asked for a secret. Highwing can't show that prompt yet, so it said no.",
  setup_beat: "Hermes asked to show a setup step. Highwing can't show that yet, so it said no."
}

function noticeWords(notice: NoticeItem): { readonly tone: 'error' | 'info'; readonly text: string } {
  if (notice.what === 'said') return { tone: notice.tone, text: notice.text }
  const method = notice.method.split('.')[0] ?? notice.method
  return { tone: 'info', text: DECLINED_WORDS[method] ?? `Hermes sent a request Highwing can't show yet (${notice.method}), so it said no.` }
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
} as const satisfies Record<Exclude<Activity['kind'], 'preparing' | 'working' | 'asking'>, string>

function openEnd(turn: Turn, nodes: readonly ThreadNode[], activity: Activity, sync: Sync['state'], clock: ViewClock): ThreadEnd {
  if (sync !== 'live') return { kind: 'paused', words: PAUSED_WORDS[sync] }
  const elapsed = elapsedWords(turn.began?.at ?? null, clock.now)
  switch (activity.kind) {
    case 'asking':
    case 'working': {
      const key = `${turn.id}/${activity.item}`
      const node = nodes.find(n => n.key === key || (n.kind === 'group' && n.steps.some(step => step.key === key)))
      const nodeKey = node?.key ?? key
      return activity.kind === 'asking' ? { kind: 'at', nodeKey, tone: 'asking' } : { kind: 'at', nodeKey, tone: 'live', elapsed }
    }
    case 'preparing':
      return { kind: 'tip', words: [{ t: 'text', v: 'Preparing ' }, { t: 'code', v: activity.tool }], elapsed }
    default:
      return { kind: 'tip', words: [{ t: 'text', v: TIP_WORDS[activity.kind] }], elapsed }
  }
}

const LOST_WORDS = 'Ended while Highwing was disconnected.'

function settledEnd(outcome: Outcome): ThreadEnd {
  switch (outcome.kind) {
    case 'complete': return { kind: 'done', words: 'Done' }
    case 'failed': return { kind: 'failed', words: failureWords(outcome) }
    case 'stopped': return { kind: 'stopped', words: 'Stopped' }
    case 'lost': return { kind: 'lost', words: LOST_WORDS }
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

function failureWords(outcome: Extract<Outcome, { kind: 'failed' }>): string {
  return (outcome.code !== null ? FAILURE_WORDS[outcome.code] : undefined) ?? outcome.message
}

const END_GLYPH = { done: '✓', failed: '✗', stopped: '⊘', lost: '~', paused: '◌' } as const

/**
 * The view as text, one line per node, for golden tests, bug reports and a replay CLI:
 *
 *   @ Today 14:05                                              time line, when the turn has one
 *   > make notes.md with a three-item todo list ...            request
 *   | I'll create the notes file first, then make the edit.    prose (first line)
 *   ■ Created and edited `notes.md` · 2 steps                  group, its steps indented under it
 *       ● Created `notes.md`  +5
 *   ● Ran `ls -la && ls scratch`                               step
 *   ○ You allowed this once.                                   answered prompt
 *   ◆ Run this command?                                        asking prompt, its command, reason and buttons indented
 *   ! Hermes asked for your sudo password. ...                 notice
 *   ✓ Done                                                     end: ✓ done, ✗ failed, ⊘ stopped, ~ lost, each with its words
 *
 * `◉` replaces the glyph of the step or group that carries the live end, or opens a tip line
 * ("◉ Thinking"). Once a minute has passed the live end adds `, 3 min` after its words. `◌` is a
 * paused end. `⋯` is a pending message. Keys in `opened` print that row's record sections under it.
 */
export function outline(view: ThreadView, opened: ReadonlySet<string> = new Set()): string {
  const lines: string[] = []
  if (view.state !== 'ready') lines.push(`(${view.state})`)
  if (view.earlier !== 'none') lines.push(`… earlier turns${view.earlier === 'loading' ? ' (loading)' : ''}`)
  view.turns.forEach((turn, index) => {
    if (index > 0) lines.push('')
    if (turn.time !== null) lines.push(`@ ${turn.time}`)
    if (turn.request !== null) lines.push(`> ${firstLine(turn.request)}`)
    const liveKey = turn.end.kind === 'at' ? turn.end.nodeKey : null
    const elapsed = turn.end.kind === 'at' && turn.end.tone === 'live' ? turn.end.elapsed : null
    for (const node of turn.nodes) lines.push(...nodeLines(node, node.key === liveKey, elapsed, opened))
    const end = endLine(turn.end)
    if (end !== null) lines.push(end)
  })
  for (const message of view.pending) lines.push(`⋯ ${firstLine(message.text)}  (${message.status}${message.detail ? `: ${message.detail}` : ''})`)
  return lines.join('\n')
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
        `    ${card.buttons.map(button => `[${button.label}]`).join(' ')}${card.freeText ? ' [Type an answer]' : ''}`,
        ...(card.error === null ? [] : [`    ! ${card.error}`])
      ]
    }
    case 'notice':
      return [`! ${node.text}`]
  }
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
    case 'at': return null
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

const SETTLED_ENDS: ReadonlySet<ThreadEnd['kind']> = new Set(['done', 'failed', 'stopped', 'lost'])

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
    for (const node of turn.nodes) {
      claim(node.key)
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
    if (!last && !settled) problems.push(`${where}: only the last turn may be unsettled, this one ends ${turn.end.kind}`)
    if (settled) {
      if (streaming.length > 0) problems.push(`${where}: ends ${turn.end.kind} while prose streams`)
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
      else if (end.tone === 'live' && node.kind !== 'step' && node.kind !== 'group')
        problems.push(`${where}: the live end sits on ${node.kind} ${node.key}`)
    }
  })
  return problems
}
