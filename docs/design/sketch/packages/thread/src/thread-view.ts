/**
 * Design C as data. `Session -> ThreadView` is a pure function with no DOM, no clock and no I/O.
 * The React components map this view one to one and decide nothing: every grouping, wording and
 * record rule from the design spec lives in this package and is tested from event logs.
 * Imports only `@highwing/hermes/domain`.
 *
 * Public: `threadView`, `outline`, `checkThread` and the view types. The renderer and the tests call
 * the same `threadView`. The rule functions below it are private to this module.
 */
import type { Activity, FileDiff, Item, NoticeItem, Outcome, PromptId, PromptItem, PromptReply, Session, Sync, ToolItem, Turn } from '@highwing/hermes/domain'

/** Text with literal parts. `code` is set in JetBrains Mono; nothing here is HTML. */
export type Phrase = readonly { readonly t: 'text' | 'code'; readonly v: string }[]

export interface ThreadView {
  readonly state: 'opening' | 'ready' | 'unavailable'
  readonly turns: readonly TurnView[]
  /** Messages sent and not yet picked up, shown under the last turn. */
  readonly pending: readonly { readonly key: string; readonly text: string; readonly status: 'sending' | 'queued' | 'failed'; readonly detail: string | null }[]
  readonly earlier: Session['earlier']
}

export interface TurnView {
  /** Stable for the life of the turn. Node keys below are stable while the turn only grows. */
  readonly key: string
  readonly request: string | null
  /** Top to bottom along the thread. */
  readonly nodes: readonly ThreadNode[]
  /** One field, so a turn cannot have two live ends or none. */
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
 * - `paused`: the turn was running when the link dropped. Graphite, no pulse, says so.
 * - `done`: graphite check ring, `words` for screen readers only.
 * - `failed` and `stopped`: brick, with words.
 * - `lost`: graphite, no check ring, with words ("Ended while Highwing was disconnected."). How the
 *   turn ended is unknown, so nothing on screen claims it succeeded.
 */
export type ThreadEnd =
  | { readonly kind: 'at'; readonly nodeKey: string; readonly tone: 'live' | 'asking' }
  | { readonly kind: 'tip'; readonly words: Phrase }
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
/** `label` is null when the record has a single section. */
export type RecordSection =
  | { readonly kind: 'changes'; readonly label: string | null; readonly path: string; readonly lines: FileDiff['lines'] }
  | { readonly kind: 'output' | 'result' | 'input'; readonly label: string | null; readonly body: { readonly text: string; readonly more: number } | 'empty' }

export type PromptCard =
  | {
      readonly state: 'asking'
      readonly promptId: PromptId
      readonly heading: string
      /** The command for an approval, long tokens wrapped by CSS. null for a clarify. */
      readonly command: string | null
      /** Hermes's own reason or question, quoted as given. */
      readonly quote: string | null
      readonly buttons: readonly { readonly reply: PromptReply; readonly label: string; readonly role: 'primary' | 'plain' | 'decline' }[]
      readonly freeText: boolean
      /** An answer is on its way, or the session is not live. Buttons are disabled, the card stays amber. */
      readonly busy: boolean
      readonly error: string | null
    }
  /** Hollow caution ring. `command` is null when the step next to the card already shows it. */
  | { readonly state: 'answered'; readonly words: string; readonly command: string | null }

/**
 * The whole thread, and the one entry point: the renderer calls it on every session value and the
 * tests call it on every fixture step. It calls `activityOf(session)` itself. Settled turns are
 * memoised by reference in a module-level WeakMap, so a streaming delta recomputes only the open turn
 * and every settled `TurnView` keeps its identity for `React.memo`.
 */
export function threadView(session: Session): ThreadView {
  throw new Error('not implemented')
}

/** One turn. `live` is null for settled turns. */
function turnView(turn: Turn, live: { readonly activity: Activity; readonly sync: Sync['state'] } | null): TurnView {
  // TODO nodes = groupRuns(turn.items).map(run => run.tools ? (run.tools.length === 1 ? step : group) : other)
  //   keys: `${turn.id}/${index of the node's first item}`; a group prefixes "g". Items only append, so
  //   keys hold while the turn grows. A step that becomes a group gets the group key; its own key survives inside.
  // TODO end = threadEnd(...)
  throw new Error('not implemented')
}

/**
 * The grouping rule. Consecutive tool items between two non-tool items form a run.
 * Output order equals input order, and every item appears exactly once.
 */
function groupRuns(items: readonly Item[]): readonly ({ readonly tools: readonly ToolItem[]; readonly at: number } | { readonly other: Exclude<Item, ToolItem>; readonly at: number })[] {
  throw new Error('not implemented')
}

/**
 * One table for every per-tool wording decision. A new tool is one row.
 * write_file: Wrote/Writing, or Created/Creating when its diff creates the file. patch: Edited/Editing.
 * terminal, process: Ran/Running, isCommand. read_file: Read/Reading. search_files: Searched/Searching.
 * Anything else: "Used <name>" / "Using <name>".
 */
const TOOL_WORDS: { readonly [toolName: string]: ToolWords } = {}
interface ToolWords {
  readonly done: string
  readonly doing: string
  /** A command row shows Output and never Input. */
  readonly isCommand: boolean
  /** The file's basename, or the command without a leading `cd X && `. Clipped to 56 characters by `stepView`. */
  subject(args: ToolItem['args']): string | null
}

function stepView(tool: ToolItem, key: string): StepView {
  // TODO record sections, in order:
  //   changes: one per diff; a lone new-file hunk header is left out of `lines`.
  //   output (commands) or result (other tools): only when there is no diff, or the result is an error.
  //     An empty command output is body 'empty' ("No output").
  //   input: only when there is no diff and the tool is not a command.
  //   No sections -> record null. One section -> its label is null.
  throw new Error('not implemented')
}

/**
 * The group's summary. Per file, in first-touched order: "Created" when the first diff for that file
 * creates it, "Created and edited" when more diffs for it follow, "Edited" otherwise. Then
 * "ran <cmd>" for one command or "ran N commands". Parts are joined with "and". No diffs and no
 * commands: "Used N tools".
 */
function groupTitle(tools: readonly ToolItem[]): Phrase {
  throw new Error('not implemented')
}

/**
 * Asking: "Run this command?", Hermes's reason quoted, buttons from `ask.choices` through one wording
 * table (once -> "Run once" primary, session -> "Allow in this chat", always -> "Always allow",
 * deny -> "Don't run" decline; an unknown choice shows its raw value).
 * Answered: "You allowed this once." and so on; reply null -> "Answered from another window.";
 * withdrawn -> "Hermes withdrew this request."
 * `neighbours` are the tool items directly before and after the prompt. When one of them ran the same
 * command, the answered card drops it. Hermes may emit the tool row before or after the prompt.
 */
function promptCard(prompt: PromptItem, neighbours: readonly ToolItem[], live: boolean): PromptCard {
  throw new Error('not implemented')
}

/**
 * A notice's words. `said` shows Hermes's text as given. `declined` goes through one table from the
 * request method to a sentence: sudo -> "Hermes asked for your sudo password. Highwing can't show
 * that prompt yet, so it said no.", secret, setup_beat, and a fallback that names the method.
 */
function noticeWords(notice: NoticeItem): { readonly tone: 'error' | 'info'; readonly text: string } {
  throw new Error('not implemented')
}

/**
 * Settled turn: done, failed, stopped or lost, straight from `outcome`. `lost` never maps to done.
 * Open turn, link not live: paused. Otherwise from the activity:
 *   asking  -> at the prompt's node, tone asking
 *   working -> at the node holding that tool (its step, or its group), tone live
 *   thinking, preparing, writing, stopping -> tip
 */
function threadEnd(turn: Turn, nodes: readonly ThreadNode[], live: Parameters<typeof turnView>[1]): ThreadEnd {
  throw new Error('not implemented')
}

/** Plain words for a failed turn. One table from `Outcome.code` (auth_permanent, rate limit, ...) to a sentence, falling back to the gateway's message. */
function failureWords(outcome: Extract<Outcome, { kind: 'failed' }>): string {
  throw new Error('not implemented')
}

/**
 * The view as text, one line per node, for golden tests, bug reports and a replay CLI. One glyph per
 * part of the thread grammar:
 *
 *   > make notes.md with a three-item todo list ...            request
 *   | I'll create the notes file first, then make the edit.    prose (first line)
 *   ■ Created and edited `notes.md` · 2 steps                  group, its steps indented under it
 *       ● Created `notes.md`  +5
 *       ● Edited `notes.md`  +1 -1
 *   ● Ran `ls -la && ls scratch`                               step
 *   ○ You allowed this once.                                   answered prompt
 *   ! Hermes asked for your sudo password. ...                 notice
 *   ✓ Done                                                     end: ✓ done, ✗ failed, ⊘ stopped, ~ lost, each with its words
 *
 * Live ends: `◉` replaces the glyph of the step or group that carries the live end, or opens a tip
 * line ("◉ Thinking"). `◆` marks a prompt that is asking. `◌` is a paused end. `⋯` is a pending message.
 * Keys in `opened` print that row's record sections under it.
 */
export function outline(view: ThreadView, opened?: ReadonlySet<string>): string {
  throw new Error('not implemented')
}

/**
 * Properties every view must hold, checked on every prefix of every fixture:
 * node keys are unique; an `at` end names an existing node; a group has two or more steps;
 * at most one prose node is streaming and it is the last node; a settled turn never ends in `at`,
 * `tip` or `paused`; only the last turn may be unsettled.
 * Returns the violations, empty when the view is sound.
 */
export function checkThread(view: ThreadView): string[] {
  throw new Error('not implemented')
}
