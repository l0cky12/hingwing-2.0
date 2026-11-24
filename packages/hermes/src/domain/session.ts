/**
 * The domain model of one Hermes session, as Highwing shows it.
 *
 * Plain JSON data only: no classes, Maps, Dates or functions. That is an invariant, because this
 * value crosses Electron IPC and is compared by reference for memoisation.
 * Nothing here names a wire field. `wire/parse.ts` is the only producer from gateway data.
 * Entry point: `@highwing/hermes/domain` (browser-safe).
 */
import type { BotId } from './bots'

declare const brand: unique symbol
type Brand<T, B extends string> = T & { readonly [brand]: B }

export type SessionId = Brand<string, 'SessionId'>
export type TurnId = Brand<string, 'TurnId'>
export type ToolId = Brand<string, 'ToolId'>
export type PromptId = Brand<string, 'PromptId'>
/** Hermes's `subagent_id`: one helper the agent handed part of the errand to. */
export type HelperId = Brand<string, 'HelperId'>

/** A request Hermes holds open on the socket. For a connector card it is the operation's id. */
export type RequestId = Brand<string, 'RequestId'>
/** Idempotency key of one user message. Minted once when the user presses Send, reused on every retry. */
export type InputId = Brand<string, 'InputId'>
/** Idempotency key of one branch. Minted by the window for a message and reused on every retry until Hermes answers. It is the `request_id` Hermes keys the branch's receipt on. */
export type BranchId = Brand<string, 'BranchId'>
/** Hermes's `execution_generation`: one run of the agent. Travels on the thing it fences. */
export type Generation = Brand<number, 'Generation'>
/** A file Highwing holds for a message, until the message is sent and for the rest of the app's run after. */
export type AttachmentId = Brand<string, 'AttachmentId'>

/** A file attached to a message. `kind` comes from the file's bytes, never its name: `image` for PNG, JPEG, GIF and WebP. `size` is in bytes. */
export interface Attachment { readonly id: AttachmentId; readonly name: string; readonly kind: 'image' | 'file'; readonly size: number }

/** A model as Hermes names it, shown as given. */
export type ModelId = Brand<string, 'ModelId'>

/** `provider` is null when Hermes named the model without one. */
export interface ModelRef { readonly id: ModelId; readonly provider: string | null }

/** A model Hermes offers. `provider` is the slug Hermes wants back on a pick, `providerName` its label. */
export interface ModelOption { readonly id: ModelId; readonly provider: string; readonly providerName: string }

export interface SessionModel {
  /** What this chat runs on, as Hermes last said. null until it says. */
  readonly current: ModelRef | null
  readonly next: { readonly model: ModelRef; readonly during: Generation } | null
  /** A held pick that Hermes will apply only after a second yes, sent back with `token`. */
  readonly ask: { readonly model: ModelRef; readonly token: string; readonly message: string } | null
}

export interface Tokens { readonly input: number; readonly output: number; readonly reasoning: number }

/** How full the chat's context window is, as Hermes last said. `percent` is Hermes's own rounding of `used` over `max`. */
export interface ContextFill { readonly used: number; readonly max: number; readonly percent: number; readonly estimated: boolean }

export interface SessionUsage {
  /**
   * Hermes's session-wide token totals as of the last turn end, or as read while the chat was idle.
   * The next turn's share is measured from here. null: unknown.
   */
  readonly totals: Tokens | null
  /** null until Hermes says. Hermes names no fill before the chat's first model call. */
  readonly context: ContextFill | null
}

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }

/** What a session holds, apart from how current it is. The reducer writes this and nothing else does. */
export interface SessionContent {
  readonly id: SessionId
  readonly title: string
  readonly cwd: string | null
  /** Settled turns, oldest first. */
  readonly history: readonly SettledTurn[]
  /** Whether the gateway holds older turns than `history[0]`. */
  readonly earlier: 'none' | 'more' | 'loading'
  /** The one place that says whether the agent is working. */
  readonly run: Run
  /**
   * What Hermes said since the last turn ended, while none runs: a goal check's verdict, a notice, a
   * request this build declined. Oldest first. Empty while a turn runs, because a line said then is an
   * item of that turn. When the next turn starts, these move into `history` as one entry whose outcome
   * is `interlude`. Live only: a rebuild drops them.
   */
  readonly interlude: readonly Item<'settled'>[]
  /**
   * What Hermes waits on outside the turn, oldest first: a password, a secret, a batch of questions,
   * a plugin command's choice, a connector card. A request lives as long as Hermes holds it open, so a
   * turn that settles leaves it here, and one can wait while no turn runs. A closed one leaves a
   * `closed` notice where it closed.
   */
  readonly requests: readonly HermesRequest[]
  /** Messages the user sent that no turn has picked up yet. */
  readonly outbox: readonly OutboxEntry[]
  readonly model: SessionModel
  readonly usage: SessionUsage
  /** Whether Hermes runs this chat's commands without an approval card. null until Hermes says, which an older Hermes never does. */
  readonly yolo: boolean | null
  readonly tuning: Tuning
}

/**
 * Hermes's switches for this chat, shared with every client that has it open. Each is null until
 * Hermes answers the read, and stays null on a Hermes that refuses it.
 */
export interface Tuning {
  /** Whether Hermes streams the model's reasoning for this chat. It applies from the next turn. */
  readonly reasoning: boolean | null
}

/** The value a window reads. */
export interface Session extends SessionContent {
  /**
   * How current this value is. Never stored: the session's actor derives it from its attach state
   * (`Gate` in reduce.ts) and the `Link` each time it publishes. Independent of `run`, so a running
   * turn can be shown while offline.
   */
  readonly sync: Sync
}

export type Sync =
  | { readonly state: 'opening' } //      first attach in flight, nothing to show yet
  | { readonly state: 'live' } //         attached, events flow
  | { readonly state: 'offline' } //      socket lost, content is the last known
  | { readonly state: 'catching-up' } //  socket back, replay and re-attach in flight
  | { readonly state: 'rebuilding' } //   frames were lost for good, content will be replaced from the gateway
  | { readonly state: 'unavailable'; readonly message: string } // the gateway refused the attach

/**
 * Running, waiting for approval and settled, in one structure:
 * - running            = `run.state === 'running'`
 * - waiting for the user = a prompt item in `run.turn` whose state is `waiting` or `sending`
 * - settled            = `run.state === 'idle'`; every turn in `history` has an `outcome`
 * An open turn has no outcome field and a settled turn requires one. A pending prompt, a running
 * tool and streaming text or reasoning can only exist inside `run.turn`, because the settled item
 * types exclude those states. A helper is the exception: Hermes can run helpers in the background,
 * after the turn that started them ends, so a helper in a settled turn may still be working.
 * There are no busy or needs-input flags to keep in step. `activityOf` in `reduce.ts` derives the rest.
 */
export type Run =
  | { readonly state: 'idle' }
  | {
      readonly state: 'running'
      readonly generation: Generation
      readonly turn: OpenTurn
      /** Stop was sent for this generation. The turn still ends only on the gateway's word. */
      readonly stop: 'none' | 'requested'
    }

/** When a turn began, and whose clock read it. `at` is Unix milliseconds. */
export interface Began {
  readonly at: number
  /**
   * `hermes`: the stored request row's time, read on the gateway's clock. `client`: this client's clock
   * when the turn's first live frame arrived, since the gateway sends no time with a live event.
   */
  readonly clock: 'hermes' | 'client'
}

interface TurnBase<S extends 'open' | 'settled'> {
  readonly id: TurnId
  /** null when the turn was started by something other than a user message we know. */
  readonly request: Request | null
  /**
   * null when unknown: a stored row with no time, a turn whose request sits on an older page, a turn
   * first heard through replay or catch-up, a running turn found at attach with no stored request.
   * An open turn's value never moves once a frame has set it.
   */
  readonly began: Began | null
  /**
   * In arrival order. Append-only while open, except that a tool, a prompt, a helper, a declined
   * notice, a MoA round, a compaction line and a keyed notice are updated in place by id, the plan in
   * place by revision, and streaming reasoning in place. A helper is updated in place in a settled turn too.
   */
  readonly items: readonly Item<S>[]
}
export interface OpenTurn extends TurnBase<'open'> {
  /** Name of a tool the model is still writing the call for. Cleared by the next item. */
  readonly announced: string | null
}
export interface SettledTurn extends TurnBase<'settled'> {
  readonly outcome: Outcome
  /**
   * Stored row ids this turn covers: every row for a turn read from history, the rows the gateway's
   * completion receipt named for a turn that settled live (possibly none). Earlier pages drop a row
   * that is already covered here.
   */
  readonly rows: readonly number[]
  /**
   * What this turn added to Hermes's session totals. null for a turn read from history, a turn whose
   * end named no totals, and a turn that began while the totals before it were unknown.
   */
  readonly tokens: Tokens | null
}
export type Turn = OpenTurn | SettledTurn

export interface Request {
  readonly text: string
  readonly inputId: InputId | null
  /** The stored row id of this message, the address a rewind cuts before. null until Hermes names it. */
  readonly rowId: number | null
  /** What this client sent with the message, in order. Empty for a message read from Hermes, which keeps no record of them. */
  readonly attachments: readonly Attachment[]
}

export type Outcome =
  | { readonly kind: 'complete' }
  | { readonly kind: 'failed'; readonly message: string; readonly code: string | null; readonly retryable: boolean }
  | { readonly kind: 'stopped' }
  /**
   * The turn ended while this client was not attached and no replay delivered its end. How it ended
   * is unknown, so the thread says so in words and never draws the Done ring for it.
   */
  | { readonly kind: 'lost' }
  /** Not a run of the agent: what Hermes said between two turns. `request` and `began` are null and `rows` is empty. */
  | { readonly kind: 'interlude' }

/** `Item<'settled'>` is assignable to `Item<'open'>`, so views take `Item` and handle both. */
export type Item<S extends 'open' | 'settled' = 'open'> =
  | TextItem<S> | ReasoningItem<S> | ToolItem<S> | HelperItem | PlanItem | PromptItem<S> | MoaItem | NoticeItem | StatusItem

export interface TextItem<S extends 'open' | 'settled' = 'open'> {
  readonly kind: 'text'
  readonly markdown: string
  /** A sealed segment takes no more deltas. The next delta starts a new text item. */
  readonly sealed: S extends 'open' ? boolean : true
}

/** What the model thought before it acted or answered. One item per block, which is one model call. */
export interface ReasoningItem<S extends 'open' | 'settled' = 'open'> {
  readonly kind: 'reasoning'
  readonly text: string
  /** A sealed block takes no more deltas. The next reasoning delta starts a new block. */
  readonly sealed: S extends 'open' ? boolean : true
  /**
   * This client's clock when the block's first frame, and the frame that closed it, came off the live
   * socket. null when that frame was replayed or the block came from history: the wire carries no time.
   */
  readonly startedAt: number | null
  readonly endedAt: number | null
}

export interface ToolItem<S extends 'open' | 'settled' = 'open'> {
  readonly kind: 'tool'
  readonly id: ToolId
  readonly name: string
  readonly args: { readonly [key: string]: Json }
  readonly status: S extends 'open' ? ToolStatus : Exclude<ToolStatus, { s: 'running' }>
}
export type ToolStatus =
  | { readonly s: 'running'; readonly note: string | null }
  | { readonly s: 'done'; readonly durationS: number | null; readonly diffs: readonly FileDiff[]; readonly result: ToolResult; readonly image: string | null }
  | { readonly s: 'cut' } // the turn ended first, or history holds no result for it

/** A unified diff for one file, parsed at the boundary. ANSI colour and Hermes's header lines are gone. */
export interface FileDiff {
  readonly path: string
  /** The first hunk starts at `@@ -0,0`. */
  readonly createsFile: boolean
  /** The file header's target is `/dev/null`. */
  readonly deletesFile: boolean
  /**
   * The lines may not be the whole diff. Hermes caps the diff it sends at 80 lines and 6 files, and this file is where
   * it stopped: the "omitted" summary follows it, or a hunk is short of its counts. A diff with no whole hunk at all,
   * such as one without an `@@` header, is cut too.
   */
  readonly cut: boolean
  readonly added: number
  readonly removed: number
  readonly lines: readonly { readonly t: 'hunk' | 'add' | 'del' | 'ctx'; readonly text: string }[]
}
/** Text is ANSI-stripped and capped at the boundary. `clipped` counts the characters dropped. */
export type ToolResult =
  | { readonly kind: 'command'; readonly output: string; readonly exitCode: number | null; readonly clipped: number }
  | { readonly kind: 'text'; readonly text: string; readonly isError: boolean; readonly clipped: number }
  | { readonly kind: 'none' }

/**
 * A helper the agent handed part of the errand to (`delegate_task`), as Hermes's `subagent.*` frames
 * tell it. Keyed by `id`. A helper of a helper is an item of its own whose `parentId` names its parent.
 */
export interface HelperItem {
  readonly kind: 'helper'
  readonly id: HelperId
  /** The helper that started this one. null for a helper the agent itself started. */
  readonly parentId: HelperId | null
  /** 0 for a helper the agent started, 1 for that helper's own, and so on. */
  readonly depth: number
  readonly goal: string
  readonly state: HelperState
  /** Hermes's own count of the tools the helper ran. null until a frame says. */
  readonly toolCount: number | null
  /**
   * In arrival order: each tool the helper started, and each helper of its own. Hermes reports when a
   * helper's tool starts, never when it ends.
   */
  readonly steps: readonly HelperStep[]
}
export type HelperState =
  | { readonly s: 'queued' }
  | { readonly s: 'working'; readonly doing: 'thinking' | 'tool' | null }
  | { readonly s: 'ended'; readonly status: HelperEnd; readonly durationS: number | null; readonly summary: string | null }
/** How a helper ended. Hermes's `error` is `failed` here. */
export type HelperEnd = 'completed' | 'failed' | 'timeout' | 'interrupted'
export type HelperStep =
  | { readonly kind: 'tool'; readonly name: string; readonly preview: string | null }
  | { readonly kind: 'helper'; readonly id: HelperId }

/** Hermes's to-do list for the turn. One per turn, replaced in place by a newer revision. */
export interface PlanItem {
  readonly kind: 'plan'
  readonly revision: number
  /** In Hermes's order. */
  readonly entries: readonly PlanEntry[]
}
export interface PlanEntry {
  readonly id: string
  readonly text: string
  readonly status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  /** The entry this one sits under. null at the top level. */
  readonly parentId: string | null
}

export interface PromptItem<S extends 'open' | 'settled' = 'open'> {
  readonly kind: 'prompt'
  readonly id: PromptId
  /**
   * The run that asked, read from the prompt's own payload. The answer carries it, so an answer
   * cannot land on a later turn.
   */
  readonly generation: Generation
  readonly ask: Ask
  readonly state: S extends 'open' ? PromptState : Exclude<PromptState, { s: 'waiting' | 'sending' }>
  /**
   * When Hermes stops waiting, on this client's clock: the moment the question came off the live
   * socket plus Hermes's `timeout_s`. null when Hermes set no limit, when the question was first
   * heard through a snapshot or a replay, whose arrival says nothing about when it was asked, and
   * once its turn has settled.
   */
  readonly deadline: S extends 'open' ? number | null : null
}
/** A question the turn asks, fenced by its generation. What Hermes asks outside the turn is a `RequestAsk`. */
export type Ask =
  | { readonly kind: 'approval'; readonly command: string; readonly reason: string | null; readonly choices: readonly string[] }
  | { readonly kind: 'clarify'; readonly question: string; readonly choices: readonly string[]; readonly multi: boolean }
export type PromptReply = { readonly kind: 'choice'; readonly value: string } | { readonly kind: 'text'; readonly value: string }
export type PromptState =
  | { readonly s: 'waiting'; readonly error: string | null } // error: the last attempt to answer failed
  | { readonly s: 'sending'; readonly reply: PromptReply }
  | { readonly s: 'answered'; readonly reply: PromptReply | null } // null: answered from another client
  | { readonly s: 'withdrawn' } // Hermes cancelled it, or the turn ended

export type NoticeItem =
  /** Hermes's own words. */
  | { readonly kind: 'notice'; readonly what: 'said'; readonly tone: 'error' | 'info'; readonly text: string }
  /**
   * Hermes asked the window for something only Hermes Desktop has (its preview, its terminal pane,
   * a setup card). A window was showing the chat, so the request was refused at once and the agent
   * does not wait. Keyed by `requestId`.
   */
  | { readonly kind: 'notice'; readonly what: 'declined'; readonly requestId: string; readonly method: string }
  /** Where a request closed, and how. Keyed by `requestId`. */
  | { readonly kind: 'notice'; readonly what: 'closed'; readonly requestId: RequestId; readonly asked: Asked; readonly end: RequestEnd }

export interface HermesRequest {
  readonly id: RequestId
  readonly ask: RequestAsk
  readonly state: RequestState
  /**
   * When Hermes stops waiting, on this client's clock: the moment the request came off the live
   * socket plus Hermes's own wait for it. null when Hermes's config sets the wait (a batch), and for
   * a request first heard through a snapshot or during an attach.
   */
  readonly deadline: number | null
}

export type RequestAsk =
  /** One value typed into a masked field. It goes to Hermes once and is kept nowhere in Highwing. */
  | { readonly kind: 'secret'; readonly for: SecretFor }
  /**
   * One to five questions asked together, or a plugin command's one choice. `answers` holds what
   * Hermes has locked so far, by question id. An answer can be changed until every question is
   * locked. The last lock submits the batch.
   */
  | { readonly kind: 'questions'; readonly questions: readonly Question[]; readonly answers: { readonly [questionId: string]: Answer } }
  /**
   * Connectors, MCP servers, plugins or skills to sign in to, install or enable while a tool waits.
   * Hermes sends the whole card with every change. `rev` orders those: an older one changes nothing.
   */
  | { readonly kind: 'connect'; readonly rev: number; readonly targets: readonly ConnectTarget[]; readonly suggested: readonly string[] }

export type SecretFor =
  | { readonly is: 'sudo'; readonly command: string }
  /** Saved to the bot's `.env` on the machine Hermes runs on. The model never reads it. */
  | { readonly is: 'env'; readonly name: string; readonly prompt: string }
  | { readonly is: 'vault'; readonly backend: string; readonly name: string }
  /** A login to save for a site. Its reply carries the `identifier` too. */
  | { readonly is: 'login'; readonly site: string; readonly origin: string }
  /** A one-time code the user reads from a device. */
  | { readonly is: 'code'; readonly site: string | null; readonly hint: string | null }

export interface Question {
  readonly id: string
  readonly text: string
  /** Empty: a typed answer only. */
  readonly choices: readonly string[]
  readonly multi: boolean
}
/** The picked labels, or one typed line. null: skipped. */
export type Answer = readonly string[] | null

export interface ConnectTarget {
  readonly name: string
  readonly kind: 'connector' | 'mcp' | 'plugin' | 'skill'
  readonly action: 'authorize' | 'connect' | 'enable' | 'install' | 'reconnect'
  readonly state: 'pending' | 'started' | 'connected' | 'skipped' | 'failed' | 'expired' | 'not-connected'
  /** Nothing more is needed from the user for it. */
  readonly resolved: boolean
  readonly detail: string | null
  readonly instructions: string | null
  /** The page to sign in on. Kept only when it is an http or https link. */
  readonly url: string | null
  /** Values Hermes needs typed in. A `secret` one is sent once and kept nowhere in Highwing. */
  readonly fields: readonly { readonly name: string; readonly prompt: string | null; readonly required: boolean; readonly secret: boolean; readonly initial: string }[]
}

/** No state holds a typed value: `sending` keeps only what `RecordedReply` can say. */
export type RequestState =
  | { readonly s: 'waiting'; readonly error: string | null } // error: the last answer did not reach Hermes
  /** An answer is on its way. A result frame gets no reply, so this lasts until Hermes closes the request. */
  | { readonly s: 'sending'; readonly reply: RecordedReply }

/** What a window answers a request with. The `answer` command refuses a kind the request does not take, and sends nothing. */
export type RequestReply =
  /** For a `secret` ask. `identifier` only for a login. */
  | { readonly kind: 'secret'; readonly value: string; readonly identifier?: string }
  /** One answer of a `questions` ask. */
  | { readonly kind: 'lock'; readonly question: string; readonly answer: Answer }
  /** A secret: no value, which Hermes reads as "no". Questions: stop here, keeping the locked answers. A connector card: continue with what is connected. */
  | { readonly kind: 'skip' }
  /** One target of a `connect` ask. `values` are the fields it asked for, by name. */
  | { readonly kind: 'connect'; readonly target: string; readonly as: 'approved' | 'skipped'; readonly values?: { readonly [field: string]: string } }

/**
 * What a session may remember of a reply to a request. It has no member that carries a typed value,
 * so the reducer cannot store a secret and no push can carry one.
 */
export type RecordedReply = Exclude<RequestReply, { kind: 'secret' | 'connect' }> | { readonly kind: 'withheld' }

/** What a closed request had asked for. */
export type Asked = SecretFor['is'] | Exclude<RequestAsk['kind'], 'secret'>
export type RequestEnd =
  | 'answered' //    this client answered it
  | 'skipped' //     this client skipped it
  | 'elsewhere' //   another client settled it, or it was gone when this one attached again
  | 'done' //        a connector card settled: every target resolved, or someone continued
  | 'timeout' //     nobody answered within Hermes's wait
  | 'interrupted' // the turn was stopped
  | 'withdrawn' //   Hermes took it back for another reason

/**
 * One round of mixture-of-agents: several reference models answer, then one model combines their
 * answers. Updated in place until it aggregates. The next round is a new item.
 */
export interface MoaItem {
  readonly kind: 'moa'
  /** Reference models that have answered, of how many. null until Hermes counts them. */
  readonly progress: { readonly done: number; readonly total: number } | null
  readonly references: readonly { readonly label: string; readonly text: string }[]
  readonly phase: { readonly is: 'advising' } | { readonly is: 'aggregating'; readonly by: string | null }
}

/**
 * A line Hermes showed beside the conversation. Never stored, so a rebuild drops it.
 * - `line`: a status line. One compaction is one line, updated from `compacting` to `compacted`.
 * - `notice`: a notice Hermes keyed, such as a credit warning or a sign-in link. One with the same key
 *   replaces it, wherever it sits. `notification.clear` marks it `cleared` rather than removing it, so
 *   an open turn stays append-only.
 */
export type StatusItem =
  | { readonly kind: 'status'; readonly what: 'line'; readonly about: StatusAbout; readonly text: string }
  | {
      readonly kind: 'status'
      readonly what: 'notice'
      readonly key: string
      readonly level: 'info' | 'warn' | 'error' | 'success'
      readonly text: string
      /** The full text behind a short `text`. */
      readonly detail: string | null
      /** How long Hermes shows it, counted from `seenAt`. null: until it is cleared. */
      readonly ttlMs: number | null
      /**
       * This client's clock when the notice came off the live socket. null when it was heard through
       * replay. A notice with a `ttlMs` is kept only when this is known.
       */
      readonly seenAt: number | null
      readonly state: 'shown' | 'cleared'
    }
/** `print`: a line the agent printed. `goal`: a goal check's verdict. `warning`: a degraded side path the turn survived. */
export type StatusAbout = 'compacting' | 'compacted' | 'goal' | 'warning' | 'print' | 'other'

export interface OutboxEntry {
  readonly inputId: InputId
  readonly text: string
  /** What the model reads when it differs from the `text` the thread and the stored history show. */
  readonly apiText?: string
  readonly attachments: readonly Attachment[]
  readonly state: { readonly s: 'sending' } | { readonly s: 'queued' } | { readonly s: 'failed'; readonly message: string }
}

/** Why a dial failed in a way that a later try can fix without the user. */
export type WaitingWhy =
  | 'not-running' // the gateway is absent or still starting
  | 'draining' //    the gateway is shutting down or restarting
  | 'dropped' //     the socket closed or the network failed
  | 'unreachable' // ssh could not reach the machine Hermes runs on
/** Why a dial failed in a way that needs the user. */
export type BlockedWhy =
  | 'hermes-missing' | 'incompatible' | 'auth' | 'inaccessible' | 'refused'
  | 'ssh-missing' | 'ssh-denied' | 'ssh-check' | 'host-changed'

/** The app-wide connection to the gateway. */
export type Link =
  | { readonly state: 'connecting'; readonly attempt: number }
  | { readonly state: 'online' }
  /**
   * Retrying by itself, with backoff. Automatic retries never start the gateway, so `not-running`
   * is shown with a Start button.
   */
  | { readonly state: 'waiting'; readonly attempt: number; readonly retryAt: number; readonly why: WaitingWhy; readonly message: string }
  /** Retrying will not help until the user acts. Shown with plain words and a Retry button. */
  | { readonly state: 'blocked'; readonly why: BlockedWhy; readonly message: string }

/** The most chats a sidebar lists. A list this long may leave out older chats. */
export const STORED_ROWS = 100

export interface Sidebar {
  /** Whose chats the rows are: the bot of the open chat. null: the socket's own profile. */
  readonly bot: BotId | null
  readonly status: 'loading' | 'ready' | 'stale'
  readonly rows: readonly SidebarRow[]
}
export interface SidebarRow {
  readonly id: SessionId
  readonly title: string
  readonly preview: string | null
  readonly lastActiveAt: number | null
  /**
   * Derived when the sidebar is published. A running session is always attached, so `asking` and
   * `running` come from `activityOf` of its session. Until its first attach settles, `running`
   * comes from the gateway's live list.
   */
  readonly badge: 'none' | 'running' | 'asking'
}
