import type { BotCreated, BotDetails, BotDraft, BotEdit, BotId, BotMark, Marked, PetChoice } from './bots'
import type { GroupDraft, GroupId } from './groups'
import type { ChatRef, Unstarted } from './open'
import type { PathMatch } from './path'
import type { ChatVersions } from './versions'
import type {
  AdmissionId, AttachmentId, BranchId, BusyMode, CheckpointId, ContextFill, ControlAction, Effort, HelperId, InputId, ModelOption, ModelRef, ProcessId, PromptId,
  PromptReply, QueuedAction, RequestId, RequestReply, SessionId, SideTask, Told, TurnId
} from './session'

export type Command =
  /**
   * Show this chat. Answers the session shown, or null for a chat that has none yet. It never
   * makes a session, and a refusal leaves the open chat as it was.
   */
  | { readonly do: 'open'; readonly ref: ChatRef }
  /**
   * A new chat in a bot that must be able to start now. When its first message could not be sent (no connection, a
   * socket bound to one profile, a Hermes that makes no chat for Highwing), it is refused and the open chat stays.
   * A plain `open` of a new chat opens the draft anyway, and its first send says why.
   */
  | { readonly do: 'open'; readonly ref: { readonly kind: 'new'; readonly bot: BotId; readonly draftId: string }; readonly upFront: true }
  /**
   * The first message to a chat that has no session yet: makes the session and sends `text` there.
   * Messages sent while it is being made go to that one session, in the order sent.
   */
  | { readonly do: 'start'; readonly chat: Unstarted; readonly text: string; readonly attachments?: readonly AttachmentId[] }
  /**
   * A line that starts with a listed `/name` runs that Hermes command or skill instead of going to the
   * agent as text. Text sent while a turn runs queues, steers the turn or redirects it, as the chat's
   * busy mode says (`sendPlan`). `attachments` go with the message in the order given; absent means
   * none. A command line with any is refused.
   */
  | { readonly do: 'send'; readonly sessionId: SessionId; readonly text: string; readonly attachments?: readonly AttachmentId[] }
  /** Asks beside the chat (`btw`) or runs a prompt apart from it (`background`). The answer lands in `sides`. Needs the chat attached. */
  | { readonly do: 'side'; readonly sessionId: SessionId; readonly kind: SideTask['kind']; readonly text: string }
  /**
   * Cut this chat before the stored row `rowId` (the message it names and everything after it, in the thread and in
   * Hermes's history), then send `text` as a new message. Nothing is sent when Hermes refuses the cut.
   */
  | { readonly do: 'rewind'; readonly sessionId: SessionId; readonly rowId: number; readonly text: string }
  /**
   * Make a new chat holding this one through the reply to the message stored at row `rowId`, and show it with that
   * message in its box. The same `branchId` names the same new chat however often it is sent. This chat is unchanged.
   * Answers the new chat. Refused while a reply runs or a message waits to be sent.
   */
  | { readonly do: 'branch'; readonly sessionId: SessionId; readonly rowId: number; readonly branchId: BranchId }
  /**
   * The messages of this chat that were tried more than once, each with the chats that hold its tries. Read from
   * Hermes on each ask, never stored. Empty when the chat has none. Refused when Hermes cannot say.
   */
  | { readonly do: 'versions'; readonly sessionId: SessionId }
  | { readonly do: 'stop'; readonly sessionId: SessionId }
  /** Moves the chat to another folder on the machine Hermes runs on. Refused while a turn runs. */
  | { readonly do: 'move'; readonly sessionId: SessionId; readonly cwd: string }
  /**
   * Summarises the older turns to free context, keeping `focus` in detail. Answers Hermes's report. Hermes then
   * rewrites the stored rows, so the chat is read again. Refused while a turn runs.
   */
  | { readonly do: 'compress'; readonly sessionId: SessionId; readonly focus: string | null }
  /** The chat rendered as a file for the user to save. Hermes writes nothing. */
  | { readonly do: 'export'; readonly sessionId: SessionId; readonly format: ExportFormat }
  /** Answers a question of the turn, by `promptId`, or something Hermes asks outside it, by `requestId`. */
  | { readonly do: 'answer'; readonly sessionId: SessionId; readonly promptId: PromptId; readonly reply: PromptReply }
  | { readonly do: 'answer'; readonly sessionId: SessionId; readonly requestId: RequestId; readonly reply: RequestReply }
  /** Drops one of this client's messages that Hermes has not listed. A listed one is a `queued` row. */
  | { readonly do: 'discard'; readonly sessionId: SessionId; readonly inputId: InputId }
  /**
   * Acts on one row of Hermes's queue, by what the row's state offers: `cancel` it, send it into the
   * running turn now, `edit` its text (which moves it to the back), or `release` a lost one so the
   * queue runs again. An action the row does not offer is refused, and nothing is sent.
   */
  | { readonly do: 'queued'; readonly sessionId: SessionId; readonly admissionId: AdmissionId; readonly action: Exclude<QueuedAction, 'edit'> }
  | { readonly do: 'queued'; readonly sessionId: SessionId; readonly admissionId: AdmissionId; readonly action: 'edit'; readonly text: string }
  | { readonly do: 'rename'; readonly sessionId: SessionId; readonly title: string }
  | { readonly do: 'archive'; readonly sessionId: SessionId; readonly archived: boolean }
  | { readonly do: 'loadEarlier'; readonly sessionId: SessionId }
  | { readonly do: 'models'; readonly sessionId: SessionId }
  /** `confirm` is the token of a `ModelConfirm`, sent to say yes to it. */
  | { readonly do: 'pickModel'; readonly sessionId: SessionId; readonly model: ModelOption; readonly confirm?: string }
  | { readonly do: 'contextBreakdown'; readonly sessionId: SessionId }
  /** The files and folders in this chat's working folder that `word` (an `@` and what follows it) starts. */
  | { readonly do: 'completePath'; readonly sessionId: SessionId; readonly word: string }
  /**
   * Makes the profile, stores `picture` as its picture, asks for the roster again, then opens the new bot. `picture`: a PNG,
   * JPEG or WebP data URL, or null for none. A picture Hermes refuses leaves the bot made, with one more warning that says so.
   */
  | { readonly do: 'createBot'; readonly draft: BotDraft; readonly picture: string | null }
  /** Whether Hermes has an image model to draw a picture with. false for a Hermes without the call. */
  | { readonly do: 'canGeneratePicture' }
  /** A picture Hermes's image model draws from `prompt`: a PNG, JPEG or WebP data URL of at most `GENERATED_MAX_BYTES`. */
  | { readonly do: 'generatePicture'; readonly prompt: string }
  /** The pets Hermes lists, curated ones first, read on each ask. */
  | { readonly do: 'pets' }
  /** A pet's idle frame as a PNG data URL, or null when Hermes has none. `url` is the pet's `PetChoice.url`. */
  | { readonly do: 'petPicture'; readonly slug: string; readonly url: string | null }
  /** The models a bot's chat could use, with no chat open. null: the socket's own profile, which a new bot copies its credentials from. */
  | { readonly do: 'botModels'; readonly bot: BotId | null }
  | { readonly do: 'describeBot'; readonly bot: BotId }
  /**
   * One save of the details dialog, then the roster is asked for again. `revision` is the one `describeBot` answered:
   * a rename refused because the name changed elsewhere since is a `conflict`.
   */
  | { readonly do: 'editBot'; readonly bot: BotId; readonly edit: BotEdit; readonly revision: number | null }
  /** `data`: a PNG, JPEG or WebP as a data URL. The roster is asked for again after. */
  | { readonly do: 'setBotPicture'; readonly bot: BotId; readonly data: string }
  /** The roster is asked for again after. */
  | { readonly do: 'removeBotPicture'; readonly bot: BotId }
  /** The bot's picture as a data URL, or null for none. */
  | { readonly do: 'botPicture'; readonly bot: BotId }
  /**
   * Makes the group chat, lists it in `groups` and shows it. The same draft sent again makes no second group: Hermes
   * answers a repeated id with the group it already made.
   */
  | { readonly do: 'createGroup'; readonly draft: GroupDraft }
  /**
   * Sets one of Hermes's own flags on the bot (`MARK_SETS`), so Hermes desktop and every machine agree. Saved only
   * when Hermes says so, and the roster shows the flag before this answers. Any attempt is followed by a fresh read
   * of the roster.
   */
  | { readonly do: 'markBot'; readonly bot: BotId; readonly mark: BotMark }
  /** Reads the roster again. Hermes sends no event when a profile changes. */
  | { readonly do: 'refreshBots' }
  /**
   * Says `text` to the group. `@handle` asks only those members, and no mention asks them all. A newer message keeps a
   * member's late reply out of the thread. Answers once Hermes has the message or refuses it, and the replies arrive in
   * `groupChat`. Refused while Hermes is not running group chats, and for text over 64 KB.
   */
  | { readonly do: 'sendToGroup'; readonly group: GroupId; readonly text: string }
  /** Stops every member's running turn in the group. */
  | { readonly do: 'stopGroup'; readonly group: GroupId }
  /** Sets one of Hermes's switches for the chat, for every client that has it open. */
  | { readonly do: 'tune'; readonly sessionId: SessionId; readonly set: 'reasoning'; readonly on: boolean }
  /** YOLO: Hermes runs this chat's commands without asking. */
  | { readonly do: 'tune'; readonly sessionId: SessionId; readonly set: 'yolo'; readonly on: boolean }
  /** Fast: the model's fast tier, from the next turn. Refused for a model that has none. */
  | { readonly do: 'tune'; readonly sessionId: SessionId; readonly set: 'fast'; readonly on: boolean }
  /** Set during a turn, it applies from the next. The new level shows in `tuning` when Hermes says it. */
  | { readonly do: 'tune'; readonly sessionId: SessionId; readonly set: 'effort'; readonly to: Effort | 'default' }
  | { readonly do: 'tune'; readonly sessionId: SessionId; readonly set: 'busy'; readonly to: BusyMode }
  /** Stops a background process of the chat. Hermes lists it as exited on the next read. */
  | { readonly do: 'killProcess'; readonly sessionId: SessionId; readonly processId: ProcessId }
  /** Stops one helper the agent started. Its end comes as Hermes's own `subagent.complete`, with status `interrupted`. */
  | { readonly do: 'stopHelper'; readonly sessionId: SessionId; readonly helperId: HelperId }
  /**
   * Presses a goal, loop, heartbeat or criterion button. Answers the words to show under the composer. An
   * action that starts a turn sends its message, as a slash command does.
   */
  | { readonly do: 'control'; readonly sessionId: SessionId; readonly action: ControlAction }
  /** The checkpoints Hermes took of the chat's folder before the agent changed it, newest first. */
  | { readonly do: 'checkpoints'; readonly sessionId: SessionId }
  /** What changed in the folder since `checkpoint`. */
  | { readonly do: 'checkpointDiff'; readonly sessionId: SessionId; readonly checkpoint: CheckpointId }
  /**
   * Puts the folder, or one file in it, back as it was at `checkpoint`. A whole folder also takes back the chat's
   * last turn, so the chat is read again, and is refused while a turn runs.
   */
  | { readonly do: 'restore'; readonly sessionId: SessionId; readonly checkpoint: CheckpointId; readonly scope: RestoreScope }
  /**
   * Puts this client's emoji on a settled turn's answer, for every client. The same emoji again, or `null`,
   * takes it off, and another emoji replaces it.
   */
  | { readonly do: 'react'; readonly sessionId: SessionId; readonly turn: TurnId; readonly emoji: string | null }
  /** Retry: dial now. Start: dial now and let Hermes start its gateway. The only way a dial after launch starts it. */
  | { readonly do: 'reconnect'; readonly start: boolean }

/**
 * `send`, `start` and `compress` answer the words to show under the composer: a command's output or note, or
 * `null` for none. `answer` says where the words of a denial went, and nothing for any other reply.
 */
export type ResultOf<C extends Command> =
  C extends { do: 'open' } ? SessionId | null
  : C extends { do: 'send' | 'start' | 'compress' | 'control' } ? string | null
  : C extends { do: 'export' } ? Exported
  : C extends { do: 'branch' } ? SessionId
  : C extends { do: 'versions' } ? ChatVersions
  : C extends { do: 'answer' } ? Told | undefined
  : C extends { do: 'models' | 'botModels' } ? ModelMenu
  : C extends { do: 'createBot' } ? BotCreated
  : C extends { do: 'describeBot' } ? BotDetails
  : C extends { do: 'botPicture' | 'petPicture' } ? string | null
  : C extends { do: 'canGeneratePicture' } ? boolean
  : C extends { do: 'generatePicture' } ? string
  : C extends { do: 'pets' } ? readonly PetChoice[]
  : C extends { do: 'markBot' } ? Marked
  : C extends { do: 'pickModel' } ? ModelConfirm | null
  : C extends { do: 'contextBreakdown' } ? ContextBreakdown
  : C extends { do: 'completePath' } ? readonly PathMatch[]
  : C extends { do: 'checkpoints' } ? Checkpoints
  : C extends { do: 'checkpointDiff' } ? CheckpointDiff
  : C extends { do: 'restore' } ? Restored
  : void

export type ExportFormat = 'md' | 'json' | 'html'
export const EXPORT_FORMATS: readonly ExportFormat[] = ['md', 'json', 'html']

/** A rendered chat and the file name Hermes suggests for it. */
export interface Exported { readonly filename: string; readonly content: string }

/** What Hermes offers this chat. `options` empty: nothing is set up. `fallback`: the model Hermes names for it. */
export interface ModelMenu { readonly options: readonly ModelOption[]; readonly fallback: ModelRef | null }

/** Hermes wants a second yes before it switches, usually for a costly model. Nothing changed yet. */
export interface ModelConfirm { readonly token: string; readonly message: string }

/** What fills a chat's context window, read when asked for. `max` is 0 when Hermes has not sized the window yet. */
export interface ContextBreakdown extends ContextFill {
  readonly model: string | null
  /** In Hermes's display order. Their tokens are estimates and need not add up to `used`. */
  readonly categories: readonly { readonly id: string; readonly label: string; readonly tokens: number }[]
}

/** `off`: Hermes keeps no checkpoints for this chat. */
export type Checkpoints = { readonly kept: 'off' } | { readonly kept: 'on'; readonly items: readonly Checkpoint[] }
/** `at`: when it was taken, as git's ISO 8601 date. `reason`: why Hermes took it, such as the tool about to change the folder. */
export interface Checkpoint { readonly id: CheckpointId; readonly at: string | null; readonly reason: string }

/** Patch text as git prints it, which Hermes cuts at 4000 characters, and git's summary of it. */
export interface CheckpointDiff { readonly stat: string; readonly patch: string }

/** `folder` keeps files the user edited since the checkpoint unless `edits` is `overwrite`. */
export type RestoreScope = { readonly kind: 'folder'; readonly edits: 'keep' | 'overwrite' } | { readonly kind: 'file'; readonly path: string }

/**
 * What a restore did. `files`: what it put back, null when Hermes did not list them. `kept`: files the user edited
 * since the checkpoint, left as they are. `lastTurn`: whether the chat's last turn was taken back with it.
 */
export interface Restored { readonly files: readonly string[] | null; readonly kept: readonly string[]; readonly lastTurn: 'removed' | 'kept' }

/** A command that could not be carried out. A value, not an exception, so it crosses IPC unchanged. */
export interface Refusal {
  readonly kind: 'offline' | 'not-attached' | 'stale' | 'conflict' | 'rejected' | 'unsupported'
  /** Plain words for the user. */
  readonly message: string
  /** The field of the request Hermes refused, so a form shows the reason under it. `members`: the bots of a new group chat. */
  readonly field?: 'name' | 'members'
}
export type Outcome<T = void> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: Refusal }
