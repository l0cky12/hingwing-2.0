/**
 * `@highwing/hermes/testing`: a recorded or generated gateway, played back through the real client.
 */
import { readFileSync } from 'node:fs'
import { APPROVAL_MODES, type ApprovalMode, type SessionId } from '../domain/session'
import { systemClock, type Reach } from '../wire/link'
import { transcriptOf, type Transcribe } from '../wire/transcribe'
import { isKanban, type Kanban } from './kanban'

export { play, playToEnd, type Moment } from './play'
export { fixtureRead } from './kanban'
export { maskedFrame, recordingDialer } from './record'
export { fixtureLatency, scriptedDialer, type ScriptedDialer, type ScriptOptions } from './script'

/**
 * A fixture is a JSONL file: one header line, then steps in order.
 * Frames are stored as they appear on the wire, so a recording needs no conversion and a parser bug shows up in replay.
 * No ticket can appear in one: the ticket travels in the upgrade request, which is never a frame.
 */
export interface Fixture {
  readonly header: {
    readonly fixture: 1
    readonly hermes: string
    readonly source: 'generated' | 'recorded'
    readonly sessionId: SessionId
    /** Canned answers for calls that are not part of the story. */
    readonly describe: unknown
    readonly list: unknown
    /** The session's stored display rows before the story starts. */
    readonly stored: readonly unknown[]
    /**
     * The session's pending list before the story starts, as an attach reply's `pending` carries it:
     * what a chat holds when it is opened after Hermes restarted. Absent: nothing is pending.
     */
    readonly pending?: readonly unknown[]
    readonly catalog?: unknown
    /**
     * The canned `model.options` reply, whose `model` and `provider` are the session's model at the
     * start. Absent: the gateway refuses `model.options` as an unknown method, as an older Hermes does.
     */
    readonly models?: unknown
    /** Models a switch to needs a second yes, as Hermes's guard asks for a costly model. */
    readonly guarded?: readonly string[]
    /**
     * true: `session.mutate` takes the operation `branch`, as a Hermes with branching does. Absent: the gateway
     * reads it as a metadata edit it does not know and refuses it `invalid_params` with no field, as an older Hermes does.
     */
    readonly branches?: true
    /**
     * true: the gateway answers `projects.tree` with the chats beside the story, each branch naming the chat it was
     * branched from. Absent: it refuses the call as an unknown method, as a Hermes whose socket reaches no legacy handler does.
     */
    readonly tree?: true
    /**
     * Canned usage. `before` and `after` are `session.stats` replies: the gateway answers `before` until the
     * story's first turn ends and `after` from then on, and every turn end carries `after` as Hermes's usage
     * view. `breakdown` is the `session.context_breakdown` reply. Absent: the gateway refuses both calls as
     * unknown methods, as a Hermes older than them does, and no frame carries usage.
     */
    readonly usage?: { readonly before: Json; readonly after: Json; readonly breakdown: Json }
    /** Canned `session.account_usage`. Absent: the gateway refuses it as an unknown method. */
    readonly accountUsage?: Json
    /** Canned `usage.bars`. Absent: the gateway refuses it as an unknown method. */
    readonly usageBars?: Json
    /** Canned `insights.get`. Absent: the gateway refuses it as an unknown method. */
    readonly insights?: Json
    /**
     * The story chat's YOLO at the start; every Bot Chat starts off. Absent: attach replies carry no
     * `info.yolo` until a recorded frame names it, and the gateway refuses a `config.set` of `yolo` as an unknown method, as a Hermes without `config.set` does.
     */
    readonly yolo?: boolean
    /**
     * Fields of the story session's attach `info` before the story starts, as Hermes said them: `cwd`, `reasoning_effort`,
     * `fast`, `yolo`. Recorded session.info frames change them. Absent: the attach reply names none of them.
     */
    readonly info?: { readonly [key: string]: Json[string] }
    /** Every YOLO set is refused `permission_denied`, as Hermes refuses a viewer without control of the chat. */
    readonly yoloDenied?: boolean
    /**
     * Every bot's `approvals.mode` at the start, which `config.get` of `approval_mode` answers and `config.set` of it changes.
     * `info.yolo` stays the chat's own flag, as on Hermes. Absent: Hermes refuses both, as for a key it does not know.
     */
    readonly approvals?: ApprovalMode
    /** Every bot's `approvals.deny`, which `config.get` of `full` answers. Absent: that key is refused as `controls` says. */
    readonly deny?: readonly string[]
    /**
     * The story session's controls as `config.get` answers them, by key: `{ "show_reasoning": "1" }`.
     * `config.set` changes them, except a set of key `yolo`, which `yolo` serves. Absent: the gateway refuses both as unknown methods, as a Hermes
     * that serves neither does.
     */
    readonly controls?: { readonly [key: string]: string }
    /**
     * The canned `profiles.list` reply, as Hermes sends it. Absent: the gateway refuses
     * `profiles.list` as an unknown method, as a Hermes older than the call does.
     */
    readonly profiles?: unknown
    /** The `warnings` every successful `profiles.create` answers with, as Hermes words a step that failed after it made the profile. Default none. */
    readonly createWarnings?: readonly string[]
    /** profile -> its SOUL.md, the persona `profiles.describe` answers. A profile not here has none. */
    readonly souls?: { readonly [profile: string]: string }
    /** profile -> its installed skills: `description` is what the catalog says, `body` its SKILL.md. Absent: every profile has none. */
    readonly skills?: { readonly [profile: string]: readonly { readonly name: string; readonly description: string; readonly body: string; readonly enabled?: boolean }[] }
    /** Another client turns that skill on or off afterMs after the first `profiles.describe` of the profile, and Hermes pushes `skills.changed`. */
    readonly skillsElsewhere?: { readonly profile: string; readonly name: string; readonly enabled: boolean; readonly afterMs: number }
    /**
     * The first `profiles.configure` that writes `ui_meta` finds another client renamed the bot to this title just before,
     * one revision on, as Hermes's revision check would.
     */
    readonly configureClash?: string | { readonly title: string; readonly times: number }
    /** Every `profiles.set_asset` that stores a picture fails with 5065 and these words, as Hermes does when it cannot write the file. */
    readonly assetFails?: string
    /**
     * What `image.generate` answers. Absent: the gateway refuses it as an unknown method, as a Hermes without it does.
     * A socket bound to one profile is refused it too, since it reaches no legacy handler.
     */
    readonly images?: Images
    /**
     * Each profile's screen, as `display.*` answers it: whether the agent uses it, and its frame as a JPEG data URL. A profile not
     * named has a screen that is off. Absent: the gateway refuses every `display.*` call as an unknown method, as a Hermes without
     * the screen does, and so does a socket bound to one profile.
     */
    readonly display?: Display
    /** What `llm.oneshot` answers. Absent: the gateway refuses it as an unknown method, as a Hermes without it does, and so does a socket bound to one profile. */
    readonly oneshot?: Oneshot
    /** What `pet.gallery` and `pet.thumb` answer. Absent: the gateway refuses both as unknown methods, as a Hermes without pets does. */
    readonly pets?: Pets
    /**
     * The Connect apps window's catalog and accounts. Absent: `connectors.catalog`, `connectors.accounts`,
     * `connectors.accounts.remove` and `connectors.operation.status` are unknown methods, and `connectors.connect`
     * stays on the story for the in-turn card.
     */
    readonly connectors?: Connectors
    /**
     * What `learning.frames`, `learning.detail`, `learning.edit` and `learning.delete` answer for memory entries.
     * Absent: the gateway refuses each as an unknown method, as a Hermes without the calls does, and so does a socket
     * bound to one profile. `limits` are the char caps. Absent keys use Hermes's defaults, 2200 for MEMORY.md and 1375
     * for USER.md. A replacement over a cap is refused in Hermes's words. A removal is not capped.
     */
    readonly memory?: MemoryScript
    /**
     * profile -> the password managers on the Hermes machine for that profile, which `vault.*` answers and changes. A profile or a
     * manager not here is not installed. Absent: the gateway refuses every `vault.*` call as an unknown method, as a Hermes without them does.
     */
    readonly vault?: VaultScript
    /**
     * profile -> the backup model keys of its config.yaml, which `cli.exec` reads and writes as `hermes -p <profile> config get|set|unset`
     * does. A profile not here holds only Hermes's default, an empty `fallback_providers`. Absent: the gateway refuses `cli.exec` as an
     * unknown method, as an older Hermes does, and so does a socket bound to one profile.
     */
    readonly backups?: { readonly [profile: string]: BackupConfig }
    /** What `mcp.servers.*` answer. Absent: the gateway refuses every one as an unknown method, as a Hermes without them does, and so does a socket bound to one profile. */
    readonly mcp?: McpScript
    /**
     * The plugins `plugins.manage` lists for every profile, which its `toggle` turns on and off for all of them. Absent: the gateway refuses
     * the call as an unknown method, as a Hermes without it does, and so does a socket bound to one profile.
     */
    readonly plugins?: readonly PluginSeed[]
    /**
     * The rows of Hermes's public plugin catalog, as `docs/api/plugins.json` holds them, which the app reads in place of the network.
     * `plugins.manage` `install` takes a `catalog_name` listed here. Absent: the app's read of the catalog fails, and every install is refused as not in the catalog.
     */
    readonly pluginCatalog?: readonly Json[]
    /** catalog name -> the words Hermes refuses its install with, as error 5026. */
    readonly pluginRefusals?: Readonly<Record<string, string>>
    /** The toolsets `tools.list` answers for any chat or none. Absent: the gateway refuses the call as an unknown method, as a Hermes without it does, and so does a socket bound to one profile. */
    readonly tools?: readonly ToolsetSeed[]
    /** true: play an older Hermes that lists plugins and toolsets but can't turn them on or off. Default false. */
    readonly listOnly?: boolean
    /** `'profile'`: play a Hermes with no `interactive` ticket, whose every socket is bound to the home profile. Default `'host'`. */
    readonly reach?: Reach
    /** false: the home bot has no Bot Chat, and the story session is only a chat of the home profile. Default true. */
    readonly homeBotChat?: boolean
    /** The kanban plugin's replies, which the app reads over HTTP rather than the socket. Absent: the Hermes has no kanban plugin and every read of it is a 404. */
    readonly kanban?: Kanban
    /** Bytes the app's image loader answers with in place of the network and the disk, as base64 under the web URL or absolute path asked for. A key not here is missing. */
    readonly media?: Readonly<Record<string, string>>
    /** What Hermes's speech upload answers: `text` heard (default empty) after `delay_ms` (default 0), or a failure with `error` in its words. Absent: a Hermes with no speech-to-text. */
    readonly transcribe?: Oneshot
    /** The app's limits on an attachment, in bytes, lower than Hermes's own so a run can stage a file over one. Either may be absent. */
    readonly attachLimits?: { readonly image?: number; readonly file?: number }
    /** profile -> the chats it has beside its Bot Chat, before the story starts. Not for the home profile, whose list is `list`. */
    readonly chats?: { readonly [profile: string]: readonly ChatSeed[] }
    /**
     * profile -> what its bot does with a message handed to it by `bot_relay.deliver`. A profile with
     * no entry is not running. Absent: the gateway refuses every `bot_relay.*` call as an unknown
     * method, as a Hermes without the bot relay does.
     */
    readonly relay?: { readonly [profile: string]: RelayScript }
    /**
     * profile -> how long each turn of its chats takes, in ms. A message starts its turn at once and its reply ends it
     * this long after, so the bot is seen working. A profile not here answers before the next frame is read.
     */
    readonly turnMs?: { readonly [profile: string]: number }
    /** false: the gateway refuses `session.active_list` as an unknown method, as a Hermes older than it does. Default true. */
    readonly activeList?: boolean
    /**
     * The group chats of the home profile and what Hermes says of them. Absent: the gateway refuses every `groups.*`
     * call as an unknown method, as a Hermes without group chats does.
     */
    readonly groups?: GroupsScript
    /**
     * The cron stores `cron.manage` lists, and the home store's runs. Absent: the gateway refuses `cron.manage` as an
     * unknown method, as a Hermes that serves no scheduled jobs to Highwing does, and so does a socket bound to one profile.
     */
    readonly cron?: CronScript
    /**
     * What `complete.path` answers. `words` maps a typed word (`@not`) to the reply as Hermes sends it, and a
     * word not listed answers `{ items: [] }`. `cwd` is the story session's `info.cwd`. Absent: the gateway
     * refuses `complete.path` as an unknown method, as a Hermes without it does.
     */
    readonly paths?: { readonly cwd?: string; readonly words: { readonly [word: string]: unknown } }
    /**
     * The story session's answers to `process.list` and `session.control.read` at the start, by method. A `reads`
     * step changes them. Absent: the gateway refuses that read as an unknown method, as a Hermes without it does.
     */
    readonly reads?: Reads
    /**
     * The story session's to-do list before the story starts, as an attach reply's `todo_state` carries it. A recorded
     * `todo.updated` frame replaces it. Absent: the session has none.
     */
    readonly todo_state?: { readonly todos: readonly unknown[]; readonly revision: number }
  }
  readonly steps: readonly FixtureStep[]
}

/**
 * `available`: Hermes has an image model. `picture`: the data URL a generation answers as `image_data`. Absent, the
 * download failed, so the reply names only the backend's `image`. `error`: every generation fails with these words.
 * `delay_ms`: how long a generation takes (default 0).
 */
export interface Display { readonly [profile: string]: { readonly running: boolean; readonly thumbnail?: string } }
export interface Images { readonly available: boolean; readonly picture?: string; readonly error?: string; readonly delay_ms?: number }

/** What `llm.oneshot` answers: `text` as the model wrote it (default empty) after `delay_ms` (default 0), or a failure with `error` in its words. */
export interface Oneshot { readonly text?: string; readonly error?: string; readonly delay_ms?: number }

/**
 * `pets`: the gallery's entries as Hermes sends them. `thumbs`: slug -> the PNG data URL `pet.thumb` answers for a pet the
 * gallery lists as installed, one asked with a petdex `url`, or one it answered before; any other ask answers `{ ok: false }`. `delay_ms`: how long
 * each call takes (default 0). `refused_once`: slugs whose first `pet.thumb` answers `{ ok: false }`, as Hermes does for a petdex
 * fetch that timed out and keeps nothing (agent/pet/store.py:240-246), and is answered as usual after.
 */
/**
 * `entries` are the chunks of MEMORY.md and USER.md, in file order. `limits.memory` caps MEMORY.md and `limits.user`
 * caps USER.md, in characters, the way MemoryStore does.
 */
export interface MemoryScript {
  readonly entries: readonly { readonly file: 'MEMORY.md' | 'USER.md'; readonly text: string }[]
  readonly limits?: { readonly memory?: number; readonly user?: number }
}

export interface Pets {
  readonly pets: readonly unknown[]
  readonly thumbs: { readonly [slug: string]: string }
  readonly delay_ms?: number
  readonly refused_once?: readonly string[]
}

export interface ConnectorCatalogSeed {
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly category: string
  readonly logo_url?: string | null
}

export interface ConnectorAccountSeed {
  readonly connection_id: string
  readonly connector: string
  readonly status: string
  readonly label: string
  readonly active: boolean
  readonly created_at: string
  readonly updated_at: string
}

/** `signInUrl` is the http(s) page every connect in this fixture opens. */
export interface Connectors {
  readonly catalog: readonly ConnectorCatalogSeed[]
  readonly accounts: readonly ConnectorAccountSeed[]
  readonly signInUrl: string
}
/**
 * One password manager of one profile. `enabled`: the profile has not opted out (default true). `unlocked`: unlocked at the start
 * (default false), as a 1Password service-account token always is. `logins`: the labels of its logins. `password`: the master password
 * that unlocks it; absent, none does. `refuses`: what Hermes says to any other, default the manager tool's "Invalid master password."
 * `token`: a 1Password service-account token, which keeps it unlocked through a lock (agent/vault_backends/onepassword.py:73).
 * `listFails`: what `vault.list` refuses with while it is unlocked, as Hermes does when `op` rejects a revoked token.
 */
export interface ManagerSeed {
  readonly installed: boolean
  readonly enabled?: boolean
  readonly unlocked?: boolean
  readonly logins?: readonly string[]
  readonly password?: string
  readonly refuses?: string
  readonly token?: boolean
  readonly listFails?: string
}
export const VAULT_MANAGERS = ['onepassword', 'bitwarden'] as const
export type VaultScript = { readonly [profile: string]: { readonly [M in typeof VAULT_MANAGERS[number]]?: ManagerSeed } }

/** The two keys Hermes reads a profile's backup models from, each as config.yaml holds it (hermes_cli/fallback_config.py:139-152). */
export const BACKUP_KEYS = ['fallback_providers', 'fallback_model'] as const
export type BackupConfig = { readonly [K in typeof BACKUP_KEYS[number]]?: unknown }

/**
 * One tool server a profile holds. `status` and `tools`: what `mcp.servers.status` says of it (default `configured`, 0).
 * `needs_auth`: Hermes parked it on a rejected sign-in. `plugin`: the plugin that provides it, which Hermes won't let a client change.
 */
export interface McpServerSeed {
  readonly name: string
  readonly url?: string
  readonly headers?: { readonly [name: string]: string }
  readonly command?: string
  readonly args?: readonly string[]
  readonly status?: 'connected' | 'disabled' | 'connecting' | 'failed' | 'lazy' | 'configured'
  readonly tools?: number
  readonly needs_auth?: boolean
  readonly plugin?: string
}

/** What `mcp.servers.test` finds at a server, by its name: its tools, an error, or a wish to sign in. A name not here fails with "Connection refused". */
export type McpProbe = { readonly tools: readonly string[] } | { readonly error: string } | { readonly oauth_needed: true }

/** `servers`: profile -> the servers it holds at the start. */
export interface McpScript {
  readonly servers: { readonly [profile: string]: readonly McpServerSeed[] }
  readonly probes?: { readonly [name: string]: McpProbe }
}

/**
 * One row of `plugins.manage` `list`, with `status` as `_plugin_status` words it (hermes_cli/plugins_cmd.py:933-946). `key` defaults to
 * `name`. `restart_required`: turning it on waits for Hermes to restart. Turning it off always does, as in Hermes.
 */
export interface PluginSeed {
  readonly name: string
  readonly key?: string
  readonly version: string
  readonly description: string
  readonly source: 'bundled' | 'user' | 'entrypoint'
  readonly status: 'enabled' | 'disabled' | 'not enabled'
  readonly restart_required?: boolean
}

/** One row of `tools.list`. Its `tool_count` is the number of `tools`. */
export interface ToolsetSeed {
  readonly name: string
  readonly description: string
  readonly enabled: boolean
  readonly tools: readonly string[]
}

/** `reply`: the bot's one answer, sent `delay_ms` after the call (default 0). `refuse`: the reason Hermes refuses the delivery with. */
export type RelayScript = { readonly reply: string; readonly delay_ms?: number } | { readonly refuse: string }
/**
 * `jobs`: the home profile's store, rows as `cron.manage` lists them (cron/job_args.py `_format_job`), each with at least `job_id`.
 * `profiles`: each other profile's store. A list names the store of the profile its frame names and says so in `scoped`.
 * `unscoped`: play a Hermes older than the `profile` param, which lists the home store for every profile and says nothing of scope.
 * `runs`: each one rewrites a home job's `last_run_at`, `last_status` and `last_error` `after_ms` after the gateway's first list,
 * and pushes `cron.changed` to every socket, as Hermes's watcher does when the scheduler writes cron/jobs.json (tui_gateway/change_watcher.py:468).
 * `history`: each job's reply to `GET /api/cron/jobs/<job_id>/runs`, body as Hermes sends it. A job with no entry answers 404, as a Hermes without the route does.
 */
export interface CronScript {
  readonly jobs: readonly CronRow[]
  readonly profiles?: { readonly [profile: string]: readonly CronRow[] }
  readonly unscoped?: boolean
  readonly runs?: readonly CronRun[]
  readonly history?: { readonly [job_id: string]: unknown }
}
export interface CronRow { readonly job_id: string; readonly [key: string]: unknown }
export interface CronRun { readonly after_ms: number; readonly job_id: string; readonly last_run_at: string; readonly last_status: string; readonly last_error?: string }

export interface GroupsScript {
  /**
   * What `groups.capabilities` says of `driver`: whether Hermes runs its group chats now. Default true. Hermes makes a
   * group either way. false: `groups.send` and `groups.stop` are refused `runtime_coordination_required`.
   */
  readonly driver?: boolean
  /**
   * The profiles `groups.capabilities` names as seatable, and the only ones `groups.create` seats: any other is
   * refused `invalid_params` on field `members`. Absent: every profile of the header's `profiles`. null: the reply
   * names none, as a Hermes older than `seatable_profiles` does, and every profile is seated.
   */
  readonly seatable?: readonly string[] | null
  /** The groups before the story starts, most recently changed first. */
  readonly rooms?: readonly RoomSeed[]
  /** false: `groups.state` carries no `change_events` and the gateway pushes no `groups.changed`, as behind a forwarding backend. Default true. */
  readonly change_events?: boolean
  /**
   * What each profile's bot does with each turn it is given, in order, across every group. A bot with no turn left, or
   * no entry, passes: its turn settles and posts nothing.
   */
  readonly turns?: { readonly [profile: string]: readonly TurnScript[] }
}

/** A group as `groups.create` would have made it. Each seat's id is its profile, and its handle follows Highwing's own rule: `ada` for the bot shown as Ada. */
export interface RoomSeed {
  readonly id: string
  readonly name: string
  /** In the order they answer. */
  readonly members: readonly { readonly profile: string; readonly handle: string }[]
  /** Hermes's `authority_epoch` for the room. Default 1. */
  readonly epoch?: number
  /** What was said before the story starts, oldest first. A member's line answers the user's line before it. */
  readonly log?: readonly ({ readonly user: string } | { readonly member: string; readonly text: string })[]
}

/**
 * One turn of one bot. It shows as running in `groups.state` from the moment it starts until it ends. `reply`: it
 * posts this after `delay_ms` (default 0). `fail`: it fails with these words after `delay_ms`. `hold`: it runs until a
 * `groups.stop` or a newer message ends it.
 */
export type TurnScript =
  | { readonly reply: string; readonly delay_ms?: number }
  | { readonly fail: string; readonly delay_ms?: number }
  | { readonly hold: true }

/** Hermes's answer to each read a client makes when it starts watching a chat, by method. */
export type Reads = Readonly<Partial<Record<typeof READS[number], unknown>>>
export const READS = ['process.list', 'session.control.read'] as const

/** A chat a bot has before the story starts. */
export interface ChatSeed {
  readonly id: string
  readonly title: string
  /** Seconds since the epoch, as Hermes stamps a row. Every row of the chat has it. */
  readonly last_active: number
  /** A `tool` row is one step of the turn, stored with no name or arguments. */
  readonly rows: readonly { readonly role: 'user' | 'assistant' | 'tool'; readonly text: string }[]
  /** Out of `session.list` unless it asks for hidden chats, as a Bot Chat is. */
  readonly hidden?: boolean
  /** Pinned by the user. A Bot Chat the roster names is pinned unless it is seeded. */
  readonly pinned?: boolean
  /** The approval the chat's running turn waits on. */
  readonly asking?: { readonly command: string; readonly description: string }
  /** The id of the chat of the same profile this one was branched from. */
  readonly branched_from?: string
  /** How many of its newest rows a resume shows, as Hermes trims a long chat. `session.transcript` still pages every row. */
  readonly shown?: number
}

export type FixtureStep =
  /** The gateway sends a frame: an `event` notification or a server request. `at` is ms since the start. */
  | { readonly at: number; readonly push: unknown }
  /**
   * The story waits here until the client calls `method`, then answers with `reply` or `error`.
   * `params` are the recorded ones. Replay does not compare ids or keys the client mints fresh
   * (`input_id`, `request_id`); it does check that the key set matches what the method accepts.
   */
  | { readonly at: number; readonly await: string; readonly params: unknown; readonly reply?: unknown; readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown } }
  /**
   * The story waits here until an attached socket answers the server request whose id is `answer`:
   * with `result`, or with `error` when it declines. A recorded `value` of `MASKED` stands for
   * whatever was typed, and matches any value that is not empty.
   */
  | { readonly at: number; readonly answer: string; readonly result: unknown }
  | { readonly at: number; readonly answer: string; readonly error: { readonly code: number; readonly message: string } }
  /** From here on the gateway's stored rows for the session are these. A resume that asks for history gets them. */
  | { readonly at: number; readonly stored: readonly unknown[] }
  /** From here on the gateway answers these reads with these replies. A read it does not name answers as before. */
  | { readonly at: number; readonly reads: Reads }
  /** The gateway closes the socket. The story continues on the client's next dial. */
  | { readonly at: number; readonly drop: number }

export const MASKED = '•••'

type Json = { readonly [key: string]: unknown }

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const STEP_KINDS = ['push', 'await', 'answer', 'stored', 'reads', 'drop'] as const

const isReads = (value: unknown): value is Reads => isObject(value) && Object.keys(value).every(key => (READS as readonly string[]).includes(key))

function parseStep(value: unknown, previousAt: number): FixtureStep | string {
  if (!isObject(value)) return 'a step must be an object'
  const { at } = value
  if (typeof at !== 'number' || !Number.isFinite(at) || at < previousAt) {
    return `"at" must be a number of ms no smaller than the step before (${previousAt})`
  }
  const kinds = STEP_KINDS.filter(kind => kind in value)
  const [kind] = kinds
  if (kind === undefined || kinds.length > 1) return `a step needs exactly one of ${STEP_KINDS.join(', ')}`
  const allowed: Readonly<Record<typeof kind, readonly string[]>> = {
    push: ['at', 'push'], await: ['at', 'await', 'params', 'reply', 'error'], answer: ['at', 'answer', 'result', 'error'], stored: ['at', 'stored'], reads: ['at', 'reads'], drop: ['at', 'drop']
  }
  const extra = Object.keys(value).filter(key => !allowed[kind].includes(key))
  if (extra.length > 0) return `a ${kind} step has unknown keys: ${extra.join(', ')}`
  switch (kind) {
    case 'push': {
      const frame = value.push
      if (!isObject(frame) || frame.jsonrpc !== '2.0' || typeof frame.method !== 'string') {
        return '"push" must be a JSON-RPC 2.0 frame with a method'
      }
      return { at, push: frame }
    }
    case 'await': {
      const { await: method, params, reply, error } = value
      if (typeof method !== 'string' || method === '') return '"await" must name a method'
      if (!isObject(params)) return '"params" must be an object'
      if ('reply' in value && 'error' in value) return 'an await step has a reply or an error, not both'
      if (error === undefined) return 'reply' in value ? { at, await: method, params, reply } : { at, await: method, params }
      if (!isObject(error) || typeof error.code !== 'number' || typeof error.message !== 'string') {
        return '"error" must have a numeric code and a message'
      }
      return { at, await: method, params, error: { code: error.code, message: error.message, ...('data' in error ? { data: error.data } : {}) } }
    }
    case 'answer': {
      const { answer, error } = value
      if (typeof answer !== 'string' || answer === '') return '"answer" must be the id of a server request'
      if ('result' in value === 'error' in value) return 'an answer step has a result or an error, not both and not neither'
      if (!('error' in value)) return { at, answer, result: value.result }
      if (!isObject(error) || typeof error.code !== 'number' || typeof error.message !== 'string') return '"error" must have a numeric code and a message'
      return { at, answer, error: { code: error.code, message: error.message } }
    }
    case 'stored':
      return Array.isArray(value.stored) ? { at, stored: value.stored } : '"stored" must be an array of rows'
    case 'reads':
      return isReads(value.reads) ? { at, reads: value.reads } : `"reads" must map ${READS.join(' or ')} to a reply`
    case 'drop':
      return Number.isInteger(value.drop) ? { at, drop: value.drop as number } : '"drop" must be a close code'
  }
}

const isSeed = (value: unknown): value is ChatSeed =>
  isObject(value) && typeof value.id === 'string' && value.id !== '' && typeof value.title === 'string' && typeof value.last_active === 'number'
  && Array.isArray(value.rows) && value.rows.every(row => isObject(row) && (row.role === 'user' || row.role === 'assistant' || row.role === 'tool') && typeof row.text === 'string')
  && (value.hidden === undefined || typeof value.hidden === 'boolean')
  && (value.pinned === undefined || typeof value.pinned === 'boolean')
  && (value.asking === undefined || (isObject(value.asking) && typeof value.asking.command === 'string' && typeof value.asking.description === 'string'))
  && (value.branched_from === undefined || (typeof value.branched_from === 'string' && value.branched_from !== '' && value.branched_from !== value.id))
  && (value.shown === undefined || (Number.isInteger(value.shown) && (value.shown as number) > 0))

const parentsListed = (seeds: readonly ChatSeed[]) => seeds.every(seed => seed.branched_from === undefined || seeds.some(other => other.id === seed.branched_from))

const delay = (value: unknown) => value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0)

const isImages = (value: unknown): value is Images =>
  isObject(value) && typeof value.available === 'boolean' && (value.picture === undefined || typeof value.picture === 'string')
  && (value.error === undefined || typeof value.error === 'string') && delay(value.delay_ms)

const isDisplay = (value: unknown): value is Display =>
  isObject(value) && Object.values(value).every(screen => isObject(screen) && typeof screen.running === 'boolean'
    && (screen.thumbnail === undefined || (typeof screen.thumbnail === 'string' && screen.thumbnail.startsWith('data:image/'))))

const isOneshot = (value: unknown): value is Oneshot =>
  isObject(value) && (value.text === undefined || typeof value.text === 'string') && (value.error === undefined || typeof value.error === 'string') && delay(value.delay_ms)

const isPets = (value: unknown): value is Pets =>
  isObject(value) && Array.isArray(value.pets) && isObject(value.thumbs) && Object.values(value.thumbs).every(thumb => typeof thumb === 'string') && delay(value.delay_ms)
  && (value.refused_once === undefined || (Array.isArray(value.refused_once) && value.refused_once.every(slug => typeof slug === 'string')))

const isCronRun = (value: unknown): value is CronRun =>
  isObject(value) && typeof value.after_ms === 'number' && value.after_ms >= 0 && isText(value.job_id) && isText(value.last_run_at) && isText(value.last_status)
  && (value.last_error === undefined || typeof value.last_error === 'string')

const isCronRows = (value: unknown) => Array.isArray(value) && value.every(job => isObject(job) && isText(job.job_id))

const cronJobIds = (value: { readonly jobs?: unknown; readonly profiles?: unknown }): ReadonlySet<string> =>
  new Set([value.jobs, ...(isObject(value.profiles) ? Object.values(value.profiles) : [])].flatMap(rows => (Array.isArray(rows) ? rows.map(job => (job as { job_id: string }).job_id) : [])))

const isCronScript = (value: unknown): value is CronScript =>
  isObject(value) && isCronRows(value.jobs)
  && (value.profiles === undefined || (isObject(value.profiles) && Object.values(value.profiles).every(isCronRows)))
  && (value.unscoped === undefined || typeof value.unscoped === 'boolean')
  && (value.runs === undefined || (Array.isArray(value.runs) && value.runs.every(run => isCronRun(run) && (value.jobs as { job_id: string }[]).some(job => job.job_id === run.job_id))))
  && (value.history === undefined || (isObject(value.history) && Object.keys(value.history).every(id => cronJobIds(value).has(id))))

const MEMORY_FILES = new Set(['MEMORY.md', 'USER.md'])
const isCharLimit = (value: unknown) => value === undefined || (Number.isSafeInteger(value) && (value as number) > 0)
const isMemory = (value: unknown): value is MemoryScript =>
  isObject(value) && Array.isArray(value.entries) && value.entries.every(entry => isObject(entry) && typeof entry.file === 'string' && MEMORY_FILES.has(entry.file) && typeof entry.text === 'string' && entry.text.trim() !== '')
  && (value.limits === undefined || (isObject(value.limits) && Object.keys(value.limits).every(key => key === 'memory' || key === 'user') && isCharLimit(value.limits.memory) && isCharLimit(value.limits.user)))

const MCP_STATUSES: readonly unknown[] = ['connected', 'disabled', 'connecting', 'failed', 'lazy', 'configured']
const SEED_KEYS = ['name', 'url', 'headers', 'command', 'args', 'status', 'tools', 'needs_auth', 'plugin']

const isMcpServerSeed = (value: unknown): value is McpServerSeed =>
  isObject(value) && Object.keys(value).every(key => SEED_KEYS.includes(key)) && typeof value.name === 'string' && value.name !== ''
  && (typeof value.url === 'string') !== (typeof value.command === 'string')
  && (value.headers === undefined || (isObject(value.headers) && Object.values(value.headers).every(header => typeof header === 'string')))
  && (value.args === undefined || (Array.isArray(value.args) && value.args.every(arg => typeof arg === 'string')))
  && (value.status === undefined || MCP_STATUSES.includes(value.status)) && (value.tools === undefined || Number.isSafeInteger(value.tools))
  && (value.needs_auth === undefined || typeof value.needs_auth === 'boolean') && (value.plugin === undefined || typeof value.plugin === 'string')

const isMcpProbe = (value: unknown): value is McpProbe =>
  isObject(value) && Object.keys(value).length === 1
  && ((Array.isArray(value.tools) && value.tools.every(tool => typeof tool === 'string')) || typeof value.error === 'string' || value.oauth_needed === true)

const isMcpScript = (value: unknown): value is McpScript =>
  isObject(value) && Object.keys(value).every(key => key === 'servers' || key === 'probes')
  && isObject(value.servers) && Object.values(value.servers).every(seeds => Array.isArray(seeds) && seeds.every(isMcpServerSeed))
  && (value.probes === undefined || (isObject(value.probes) && Object.values(value.probes).every(isMcpProbe)))

const PLUGIN_SOURCES: readonly unknown[] = ['bundled', 'user', 'entrypoint']
const PLUGIN_STATUSES: readonly unknown[] = ['enabled', 'disabled', 'not enabled']

const isPluginSeed = (value: unknown): value is PluginSeed =>
  isObject(value) && Object.keys(value).every(key => ['name', 'key', 'version', 'description', 'source', 'status', 'restart_required'].includes(key)) && typeof value.name === 'string' && value.name !== ''
  && (value.key === undefined || (typeof value.key === 'string' && value.key !== '')) && typeof value.version === 'string' && typeof value.description === 'string'
  && PLUGIN_SOURCES.includes(value.source) && PLUGIN_STATUSES.includes(value.status) && (value.restart_required === undefined || typeof value.restart_required === 'boolean')

const isToolsetSeed = (value: unknown): value is ToolsetSeed =>
  isObject(value) && Object.keys(value).every(key => ['name', 'description', 'enabled', 'tools'].includes(key)) && typeof value.name === 'string' && value.name !== ''
  && typeof value.description === 'string' && typeof value.enabled === 'boolean' && Array.isArray(value.tools) && value.tools.every(tool => typeof tool === 'string' && tool !== '')

const isRelayScript =(value: unknown): value is RelayScript =>
  isObject(value) && ('refuse' in value
    ? typeof value.refuse === 'string' && value.refuse !== '' && Object.keys(value).length === 1
    : typeof value.reply === 'string' && (value.delay_ms === undefined || (typeof value.delay_ms === 'number' && value.delay_ms >= 0))
      && Object.keys(value).every(key => key === 'reply' || key === 'delay_ms'))

const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''

const ACCOUNT_STATUS = new Set(['pending', 'active', 'failed', 'expired', 'revoked', 'inactive'])

const isCatalogSeed = (value: unknown): value is ConnectorCatalogSeed =>
  isObject(value) && isText(value.slug) && isText(value.name) && isText(value.description) && isText(value.category)
  && (value.logo_url === undefined || value.logo_url === null || typeof value.logo_url === 'string')

const isAccountSeed = (value: unknown): value is ConnectorAccountSeed =>
  isObject(value) && isText(value.connection_id) && isText(value.connector) && typeof value.status === 'string' && ACCOUNT_STATUS.has(value.status)
  && isText(value.label) && typeof value.active === 'boolean' && isText(value.created_at) && isText(value.updated_at)

const isConnectors = (value: unknown): value is Connectors =>
  isObject(value) && Array.isArray(value.catalog) && value.catalog.every(isCatalogSeed)
  && new Set(value.catalog.map(row => row.slug)).size === value.catalog.length
  && Array.isArray(value.accounts) && value.accounts.every(isAccountSeed)
  && typeof value.signInUrl === 'string' && /^https?:\/\//.test(value.signInUrl)
const isManagerSeed = (value: unknown): value is ManagerSeed =>
  isObject(value) && typeof value.installed === 'boolean'
  && Object.keys(value).every(key => ['installed', 'enabled', 'unlocked', 'logins', 'password', 'refuses', 'token', 'listFails'].includes(key))
  && (value.enabled === undefined || typeof value.enabled === 'boolean') && (value.unlocked === undefined || typeof value.unlocked === 'boolean')
  && (value.logins === undefined || (Array.isArray(value.logins) && value.logins.every(isText)))
  && (value.password === undefined || isText(value.password)) && (value.refuses === undefined || isText(value.refuses))
  && (value.token === undefined || typeof value.token === 'boolean') && (value.listFails === undefined || isText(value.listFails))

const isVaultScript = (value: unknown): value is VaultScript =>
  isObject(value) && Object.values(value).every(managers => isObject(managers)
    && Object.entries(managers).every(([name, seed]) => VAULT_MANAGERS.some(known => known === name) && isManagerSeed(seed)))

const isBackups = (value: unknown): value is { readonly [profile: string]: BackupConfig } =>
  isObject(value) && Object.values(value).every(config => isObject(config) && Object.keys(config).every(key => BACKUP_KEYS.some(known => known === key)))

const isDelay = (value: unknown) => value === undefined || (typeof value === 'number' && value >= 0)

const isTurnScript = (value: unknown): value is TurnScript => {
  if (!isObject(value)) return false
  if ('hold' in value) return value.hold === true && Object.keys(value).length === 1
  const words = 'fail' in value ? 'fail' : 'reply'
  return isText(value[words]) && isDelay(value.delay_ms) && Object.keys(value).every(key => key === words || key === 'delay_ms')
}

const isSeededLine = (value: unknown) =>
  isObject(value) && ((isText(value.user) && Object.keys(value).length === 1) || (isText(value.member) && isText(value.text) && Object.keys(value).length === 2))

const isRoomSeed = (value: unknown): value is RoomSeed =>
  isObject(value) && isText(value.id) && isText(value.name) && Array.isArray(value.members)
  && value.members.length >= 2 && value.members.length <= 6 && value.members.every(seat => isObject(seat) && isText(seat.profile) && isText(seat.handle))
  && (value.epoch === undefined || (Number.isInteger(value.epoch) && (value.epoch as number) >= 1))
  && (value.log === undefined || (Array.isArray(value.log) && value.log.every(isSeededLine)))

const GROUPS_KEYS = ['driver', 'seatable', 'rooms', 'change_events', 'turns']

const isGroupsScript = (value: unknown): value is GroupsScript =>
  isObject(value) && Object.keys(value).every(key => GROUPS_KEYS.includes(key))
  && (value.driver === undefined || typeof value.driver === 'boolean')
  && (value.change_events === undefined || typeof value.change_events === 'boolean')
  && (value.seatable === undefined || value.seatable === null || (Array.isArray(value.seatable) && value.seatable.every(isText)))
  && (value.rooms === undefined || (Array.isArray(value.rooms) && value.rooms.every(isRoomSeed)))
  && (value.turns === undefined || (isObject(value.turns) && Object.values(value.turns).every(turns => Array.isArray(turns) && turns.every(isTurnScript))))

function parseHeader(value: unknown): Fixture['header'] | string {
  if (!isObject(value)) return 'the header must be an object'
  const { fixture, hermes, source, sessionId, stored } = value
  if (fixture !== 1) return '"fixture" must be 1'
  if (typeof hermes !== 'string' || hermes === '') return '"hermes" must name the Hermes version'
  if (source !== 'generated' && source !== 'recorded') return '"source" must be "generated" or "recorded"'
  if (typeof sessionId !== 'string' || sessionId === '') return '"sessionId" must be a session id'
  if (!('describe' in value) || !('list' in value)) return 'the header needs "describe" and "list"'
  if (!Array.isArray(stored)) return '"stored" must be an array of rows'
  const { pending } = value
  if (pending !== undefined && !Array.isArray(pending)) return '"pending" must be an array of pending rows'
  const { models } = value
  if (models !== undefined && !(isObject(models) && Array.isArray(models.providers))) return '"models" must be a model.options reply with "providers"'
  const { guarded, branches, tree } = value
  if (tree !== undefined && tree !== true) return '"tree" must be true'
  if (guarded !== undefined && !(Array.isArray(guarded) && guarded.every(model => typeof model === 'string'))) return '"guarded" must be a list of model names'
  if (branches !== undefined && branches !== true) return '"branches" must be true'
  const { before, after, breakdown } = isObject(value.usage) ? value.usage : {}
  const usage = isObject(before) && isObject(after) && isObject(breakdown) ? { before, after, breakdown } : undefined
  if (value.usage !== undefined && usage === undefined) {
    return '"usage" must hold "before" and "after" session.stats replies and a "breakdown" session.context_breakdown reply'
  }
  const { yolo, yoloDenied, approvals } = value
  if (yolo !== undefined && typeof yolo !== 'boolean') return '"yolo" must be true or false'
  if (approvals !== undefined && !APPROVAL_MODES.some(mode => mode === approvals)) return '"approvals" must be manual, smart or off'
  if (yoloDenied !== undefined && typeof yoloDenied !== 'boolean') return '"yoloDenied" must be true or false'
  const { deny } = value
  if (deny !== undefined && !(Array.isArray(deny) && deny.every(rule => typeof rule === 'string'))) return '"deny" must be a list of strings'
  const { info } = value
  if (info !== undefined && !isObject(info)) return '"info" must be an object of attach info fields'
  const { controls } = value
  if (controls !== undefined && !(isObject(controls) && Object.values(controls).every(held => typeof held === 'string'))) return '"controls" must map control keys to strings'
  const { profiles } = value
  if (profiles !== undefined && !(isObject(profiles) && Array.isArray(profiles.profiles))) return '"profiles" must be a profiles.list reply with "profiles"'
  const { createWarnings } = value
  if (createWarnings !== undefined && !(Array.isArray(createWarnings) && createWarnings.every(warning => typeof warning === 'string'))) return '"createWarnings" must be a list of strings'
  const { souls, configureClash } = value
  if (souls !== undefined && !(isObject(souls) && Object.values(souls).every(soul => typeof soul === 'string'))) return '"souls" must map a profile to its persona'
  const { skills, skillsElsewhere } = value
  const isSkill = (skill: unknown) => isObject(skill) && typeof skill.name === 'string' && skill.name !== '' && typeof skill.description === 'string' && typeof skill.body === 'string'
    && (skill.enabled === undefined || typeof skill.enabled === 'boolean')
  if (skills !== undefined && !(isObject(skills) && Object.values(skills).every(listed => Array.isArray(listed) && listed.every(isSkill)))) {
    return '"skills" must map a profile to a list of { name, description, body, enabled? }'
  }
  if (skillsElsewhere !== undefined && !(isObject(skillsElsewhere) && typeof skillsElsewhere.profile === 'string' && typeof skillsElsewhere.name === 'string'
    && typeof skillsElsewhere.enabled === 'boolean' && Number.isSafeInteger(skillsElsewhere.afterMs) && (skillsElsewhere.afterMs as number) >= 0)) {
    return '"skillsElsewhere" must be { profile, name, enabled, afterMs }'
  }
  const clashTitle = isObject(configureClash) ? configureClash.title : configureClash
  const clashTimes = isObject(configureClash) ? configureClash.times : 1
  if (configureClash !== undefined && (typeof clashTitle !== 'string' || clashTitle.trim() === '' || !Number.isSafeInteger(clashTimes) || (clashTimes as number) < 1)) {
    return '"configureClash" must be the title another client writes, or { title, times }'
  }
  const { assetFails } = value
  if (assetFails !== undefined && (typeof assetFails !== 'string' || assetFails.trim() === '')) return '"assetFails" must be the words a failed write gives'
  const { images, pets, oneshot, display, memory } = value
  if (images !== undefined && !isImages(images)) return '"images" must be { available, picture?, error?, delay_ms? }'
  if (display !== undefined && !isDisplay(display)) return '"display" must map a profile to { running, thumbnail? } with "thumbnail" a data URL'
  if (oneshot !== undefined && !isOneshot(oneshot)) return '"oneshot" must be { text?, error?, delay_ms? }'
  if (pets !== undefined && !isPets(pets)) return '"pets" must be { pets, thumbs, delay_ms?, refused_once? } with "thumbs" mapping a slug to a data URL'
  const { connectors } = value
  if (connectors !== undefined && !isConnectors(connectors)) return '"connectors" must be { catalog, accounts, signInUrl } with a unique slug on every app and an http(s) sign-in page'
  if (memory !== undefined && !isMemory(memory)) return '"memory" must be { entries, limits? } with each entry { file: "MEMORY.md" or "USER.md", text } and limits { memory?, user? }'
  const { vault } = value
  if (vault !== undefined && !isVaultScript(vault)) {
    return '"vault" must map a profile to { onepassword?, bitwarden? }, each { installed, enabled?, unlocked?, logins?, password?, refuses?, token?, listFails? }'
  }
  const { backups } = value
  if (backups !== undefined && !isBackups(backups)) return '"backups" must map a profile to { fallback_providers?, fallback_model? }'
  const { mcp } = value
  if (mcp !== undefined && !isMcpScript(mcp)) {
    return '"mcp" must be { servers, probes? }: "servers" maps a profile to its servers, each { name, url or command, headers?, args?, status?, tools?, needs_auth?, plugin? }, and "probes" maps a name to { tools }, { error } or { oauth_needed: true }'
  }
  const { plugins } = value
  if (plugins !== undefined && !(Array.isArray(plugins) && plugins.every(isPluginSeed))) {
    return '"plugins" must be a list of { name, key?, version, description, source, status, restart_required? }, with "source" bundled, user or entrypoint and "status" enabled, disabled or "not enabled"'
  }
  const { pluginCatalog, pluginRefusals } = value
  if (pluginCatalog !== undefined && !(Array.isArray(pluginCatalog) && pluginCatalog.every(row => isObject(row) && isText(row.name)))) return '"pluginCatalog" must be a list of catalog rows, each with a "name"'
  if (pluginRefusals !== undefined && !(isObject(pluginRefusals) && Object.values(pluginRefusals).every(isText))) return '"pluginRefusals" must map a catalog name to the words Hermes refuses its install with'
  const { tools } = value
  if (tools !== undefined && !(Array.isArray(tools) && tools.every(isToolsetSeed))) return '"tools" must be a list of { name, description, enabled, tools }, with "tools" the names of its tools'
  const { listOnly } = value
  if (listOnly !== undefined && typeof listOnly !== 'boolean') return '"listOnly" must be true or false'
  const { reach, homeBotChat } = value
  if (reach !== undefined && reach !== 'host' && reach !== 'profile') return '"reach" must be "host" or "profile"'
  if (homeBotChat !== undefined && typeof homeBotChat !== 'boolean') return '"homeBotChat" must be true or false'
  const { kanban } = value
  if (kanban !== undefined && !isKanban(kanban)) return '"kanban" must be { board, tasks }: a kanban board reply, and each card\'s detail reply by task id'
  const { media, transcribe } = value
  if (transcribe !== undefined && !isOneshot(transcribe)) return '"transcribe" must be { text?, error?, delay_ms? }'
  if (media !== undefined && !(isObject(media) && Object.values(media).every(bytes => typeof bytes === 'string'))) return '"media" must map a url or path to base64 bytes'
  const { attachLimits } = value
  const limit = (bytes: unknown) => bytes === undefined || (Number.isSafeInteger(bytes) && (bytes as number) > 0)
  if (attachLimits !== undefined && !(isObject(attachLimits) && Object.keys(attachLimits).every(key => key === 'image' || key === 'file') && limit(attachLimits.image) && limit(attachLimits.file))) {
    return '"attachLimits" may hold only "image" and "file", each a number of bytes above 0'
  }
  const { accountUsage, usageBars, insights } = value
  if (accountUsage !== undefined && !isObject(accountUsage)) return '"accountUsage" must be a session.account_usage reply'
  if (usageBars !== undefined && !isObject(usageBars)) return '"usageBars" must be a usage.bars reply'
  if (insights !== undefined && !isObject(insights)) return '"insights" must be an insights.get reply'
  const { reads } = value
  if (reads !== undefined && !isReads(reads)) return `"reads" must map ${READS.join(' or ')} to a reply`
  const { todo_state: todoState } = value
  if (todoState !== undefined && !(isObject(todoState) && Array.isArray(todoState.todos) && Number.isSafeInteger(todoState.revision) && (todoState.revision as number) >= 0)) {
    return '"todo_state" must be { todos, revision } with "revision" a whole number'
  }
  const { chats } = value
  if (chats !== undefined && !(isObject(chats) && Object.values(chats).every(seeds => Array.isArray(seeds) && seeds.every(isSeed)))) {
    return '"chats" must map a profile to its chats, each with id, title, last_active and rows'
  }
  if (chats !== undefined && !Object.values(chats as { readonly [profile: string]: readonly ChatSeed[] }).every(parentsListed)) {
    return '"branched_from" must name another chat of the same profile'
  }
  const { relay } = value
  if (relay !== undefined && !(isObject(relay) && Object.values(relay).every(isRelayScript))) {
    return '"relay" must map a profile to { reply, delay_ms? } or { refuse }'
  }
  const { cron } = value
  if (cron !== undefined && !isCronScript(cron)) {
    return '"cron" must be { jobs, profiles?, unscoped?, runs?, history? }: each job with a "job_id", "profiles" mapping a profile to such jobs, each run { after_ms, job_id, last_run_at, last_status, last_error? } of a listed home job, and "history" mapping a listed job_id to its runs reply'
  }
  const { turnMs, activeList } = value
  if (turnMs !== undefined && !(isObject(turnMs) && Object.values(turnMs).every(ms => Number.isSafeInteger(ms) && (ms as number) >= 0))) {
    return '"turnMs" must map a profile to a whole number of ms'
  }
  if (activeList !== undefined && typeof activeList !== 'boolean') return '"activeList" must be true or false'
  const { groups } = value
  if (groups !== undefined && !isGroupsScript(groups)) {
    return '"groups" may hold only "driver", "seatable", "rooms", "change_events" and "turns": each room { id, name, members, epoch?, log? } seating 2 to 6 { profile, handle }, and each turn { reply, delay_ms? }, { fail, delay_ms? } or { hold: true }'
  }
  const served = new Set(isObject(profiles) && Array.isArray(profiles.profiles) ? profiles.profiles.flatMap(row => (isObject(row) && isText(row.name) ? [row.name] : [])) : ['default'])
  const unserved = [
    ...(groups?.rooms ?? []).flatMap(room => [...room.members.map(seat => seat.profile), ...(room.log ?? []).flatMap(line => ('member' in line ? [line.member] : []))].filter(profile => !served.has(profile)).map(profile => `${room.id}: ${profile}`)),
    ...Object.keys(groups?.turns ?? {}).filter(profile => !served.has(profile)).map(profile => `turns: ${profile}`)
  ]
  if (unserved.length > 0) return `"groups" names profiles the header's "profiles" does not list (${unserved.join(', ')})`
  const { paths } = value
  if (paths !== undefined && !(isObject(paths) && isObject(paths.words) && (paths.cwd === undefined || typeof paths.cwd === 'string'))) {
    return '"paths" must be { cwd?, words } with "words" mapping a typed word to its complete.path reply'
  }
  return {
    fixture, hermes, source, sessionId: sessionId as SessionId, describe: value.describe, list: value.list, stored,
    ...(pending === undefined ? {} : { pending }),
    ...('catalog' in value ? { catalog: value.catalog } : {}),
    ...(models === undefined ? {} : { models }), ...(guarded === undefined ? {} : { guarded: guarded as string[] }),
    ...(usage === undefined ? {} : { usage }),
    ...(accountUsage === undefined ? {} : { accountUsage }), ...(usageBars === undefined ? {} : { usageBars }), ...(insights === undefined ? {} : { insights }),
    ...(yolo === undefined ? {} : { yolo }), ...(yoloDenied === undefined ? {} : { yoloDenied }), ...(approvals === undefined ? {} : { approvals: approvals as ApprovalMode }),
    ...(deny === undefined ? {} : { deny: deny as string[] }),
    ...(branches === undefined ? {} : { branches }), ...(tree === undefined ? {} : { tree }),
    ...(info === undefined ? {} : { info }),
    ...(controls === undefined ? {} : { controls: controls as Record<string, string> }),
    ...(profiles === undefined ? {} : { profiles }),
    ...(createWarnings === undefined ? {} : { createWarnings: createWarnings as string[] }),
    ...(souls === undefined ? {} : { souls: souls as Record<string, string> }),
    ...(skills === undefined ? {} : { skills: skills as NonNullable<Fixture['header']['skills']> }),
    ...(skillsElsewhere === undefined ? {} : { skillsElsewhere: skillsElsewhere as NonNullable<Fixture['header']['skillsElsewhere']> }), ...(configureClash === undefined ? {} : { configureClash: configureClash as string | { title: string; times: number } }),
    ...(assetFails === undefined ? {} : { assetFails }),
    ...(images === undefined ? {} : { images }), ...(display === undefined ? {} : { display }), ...(pets === undefined ? {} : { pets }), ...(oneshot === undefined ? {} : { oneshot }), ...(vault === undefined ? {} : { vault }),
    ...(backups === undefined ? {} : { backups }),
    ...(connectors === undefined ? {} : { connectors }),
    ...(memory === undefined ? {} : { memory }),
    ...(mcp === undefined ? {} : { mcp }),
    ...(plugins === undefined ? {} : { plugins: plugins as readonly PluginSeed[] }),
    ...(pluginCatalog === undefined ? {} : { pluginCatalog: pluginCatalog as Json[] }), ...(pluginRefusals === undefined ? {} : { pluginRefusals: pluginRefusals as Record<string, string> }),
    ...(tools === undefined ? {} : { tools: tools as readonly ToolsetSeed[] }),
    ...(listOnly === undefined ? {} : { listOnly }),
    ...(reach === undefined ? {} : { reach }), ...(homeBotChat === undefined ? {} : { homeBotChat }),
    ...(kanban === undefined ? {} : { kanban }),
    ...(media === undefined ? {} : { media: media as Record<string, string> }), ...(transcribe === undefined ? {} : { transcribe }),
    ...(attachLimits === undefined ? {} : { attachLimits: attachLimits as { image?: number; file?: number } }),
    ...(chats === undefined ? {} : { chats: chats as { readonly [profile: string]: readonly ChatSeed[] } }),
    ...(relay === undefined ? {} : { relay: relay as { readonly [profile: string]: RelayScript } }),
    ...(turnMs === undefined ? {} : { turnMs: turnMs as { readonly [profile: string]: number } }), ...(activeList === undefined ? {} : { activeList }),
    ...(groups === undefined ? {} : { groups }),
    ...(cron === undefined ? {} : { cron }),
    ...(paths === undefined ? {} : { paths: paths as NonNullable<Fixture['header']['paths']> }),
    ...(reads === undefined ? {} : { reads }),
    ...(todoState === undefined ? {} : { todo_state: todoState as NonNullable<Fixture['header']['todo_state']> })
  }
}

/** Reads a fixture file, checking the header and every step. Throws with the line number of the first bad line. */
/** Hermes's words when it has no speech-to-text (tools/transcription_tools.py), shortened. */
const NO_STT = 'No STT provider available. Install faster-whisper for free local transcription.'

/** Speech to text as the header's `transcribe` answers it, through the same reading of Hermes's answer as a live route. */
export function fixtureTranscribe(answer: Oneshot | undefined): Transcribe {
  return async () => {
    await new Promise<void>(resolve => void systemClock.setTimeout(resolve, answer?.delay_ms ?? 0))
    return answer === undefined || answer.error !== undefined
      ? transcriptOf(400, { detail: answer?.error ?? NO_STT })
      : transcriptOf(200, { ok: true, transcript: answer.text ?? '' })
  }
}

export function loadFixture(path: string): Fixture {
  const lines = readFileSync(path, 'utf8').split('\n')
  if (lines.at(-1) === '') lines.pop()
  const fail = (index: number, problem: string): never => {
    throw new Error(`${path}:${index + 1}: ${problem}`)
  }
  const json = (index: number): unknown => {
    try {
      return JSON.parse(lines[index] ?? '')
    } catch (error) {
      return fail(index, `not JSON (${(error as Error).message})`)
    }
  }
  if (lines.length === 0) fail(0, 'the file is empty')
  const header = parseHeader(json(0))
  if (typeof header === 'string') return fail(0, header)
  const steps: FixtureStep[] = []
  for (let index = 1; index < lines.length; index++) {
    const step = parseStep(json(index), steps.at(-1)?.at ?? 0)
    if (typeof step === 'string') return fail(index, step)
    steps.push(step)
  }
  return { header, steps }
}
