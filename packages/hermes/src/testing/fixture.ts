/**
 * `@highwing/hermes/testing`: a recorded or generated gateway, played back through the real client.
 */
import { readFileSync } from 'node:fs'
import type { SessionId } from '../domain/session'
import type { Reach } from '../wire/link'

export { play, playToEnd, type Moment } from './play'
export { recordingDialer } from './record'
export { scriptedDialer, type ScriptedDialer, type ScriptOptions } from './script'

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
    /**
     * The story chat's YOLO at the start; every Bot Chat starts off. Absent: attach replies carry no
     * `info.yolo` until a recorded frame names it, and the gateway refuses `config.set` as an unknown method, as a Hermes without `config.set` does.
     */
    readonly yolo?: boolean
    /** Every YOLO set is refused `permission_denied`, as Hermes refuses a viewer without control of the chat. */
    readonly yoloDenied?: boolean
    /**
     * The canned `profiles.list` reply, as Hermes sends it. Absent: the gateway refuses
     * `profiles.list` as an unknown method, as a Hermes older than the call does.
     */
    readonly profiles?: unknown
    /** The `warnings` every successful `profiles.create` answers with, as Hermes words a step that failed after it made the profile. Default none. */
    readonly createWarnings?: readonly string[]
    /** `'profile'`: play a Hermes with no `interactive` ticket, whose every socket is bound to the home profile. Default `'host'`. */
    readonly reach?: Reach
    /** false: the home bot has no Bot Chat, and the story session is only a chat of the home profile. Default true. */
    readonly homeBotChat?: boolean
    /** Bytes the app's image loader answers with in place of the network and the disk, as base64 under the web URL or absolute path asked for. A key not here is missing. */
    readonly media?: Readonly<Record<string, string>>
    /** profile -> the chats it has beside its Bot Chat, before the story starts. Not for the home profile, whose list is `list`. */
    readonly chats?: { readonly [profile: string]: readonly ChatSeed[] }
    /**
     * profile -> what its bot does with a message handed to it by `bot_relay.deliver`. A profile with
     * no entry is not running. Absent: the gateway refuses every `bot_relay.*` call as an unknown
     * method, as a Hermes without the bot relay does.
     */
    readonly relay?: { readonly [profile: string]: RelayScript }
  }
  readonly steps: readonly FixtureStep[]
}

/** `reply`: the bot's one answer, sent `delay_ms` after the call (default 0). `refuse`: the reason Hermes refuses the delivery with. */
export type RelayScript = { readonly reply: string; readonly delay_ms?: number } | { readonly refuse: string }

/** A chat a bot has before the story starts. */
export interface ChatSeed {
  readonly id: string
  readonly title: string
  /** Seconds since the epoch, as Hermes stamps a row. Every row of the chat has it. */
  readonly last_active: number
  readonly rows: readonly { readonly role: 'user' | 'assistant'; readonly text: string }[]
  /** Out of `session.list` unless it asks for hidden chats, as a Bot Chat is. */
  readonly hidden?: boolean
  /** The approval the chat's running turn waits on. */
  readonly asking?: { readonly command: string; readonly description: string }
  /** The id of the chat of the same profile this one was branched from. */
  readonly branched_from?: string
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
  /** From here on the gateway's stored rows for the session are these. A resume that asks for history gets them. */
  | { readonly at: number; readonly stored: readonly unknown[] }
  /** The gateway closes the socket. The story continues on the client's next dial. */
  | { readonly at: number; readonly drop: number }

type Json = { readonly [key: string]: unknown }

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const STEP_KINDS = ['push', 'await', 'stored', 'drop'] as const

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
    push: ['at', 'push'], await: ['at', 'await', 'params', 'reply', 'error'], stored: ['at', 'stored'], drop: ['at', 'drop']
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
    case 'stored':
      return Array.isArray(value.stored) ? { at, stored: value.stored } : '"stored" must be an array of rows'
    case 'drop':
      return Number.isInteger(value.drop) ? { at, drop: value.drop as number } : '"drop" must be a close code'
  }
}

const isSeed = (value: unknown): value is ChatSeed =>
  isObject(value) && typeof value.id === 'string' && value.id !== '' && typeof value.title === 'string' && typeof value.last_active === 'number'
  && Array.isArray(value.rows) && value.rows.every(row => isObject(row) && (row.role === 'user' || row.role === 'assistant') && typeof row.text === 'string')
  && (value.hidden === undefined || typeof value.hidden === 'boolean')
  && (value.asking === undefined || (isObject(value.asking) && typeof value.asking.command === 'string' && typeof value.asking.description === 'string'))
  && (value.branched_from === undefined || (typeof value.branched_from === 'string' && value.branched_from !== '' && value.branched_from !== value.id))

const parentsListed = (seeds: readonly ChatSeed[]) => seeds.every(seed => seed.branched_from === undefined || seeds.some(other => other.id === seed.branched_from))

const isRelayScript = (value: unknown): value is RelayScript =>
  isObject(value) && ('refuse' in value
    ? typeof value.refuse === 'string' && value.refuse !== '' && Object.keys(value).length === 1
    : typeof value.reply === 'string' && (value.delay_ms === undefined || (typeof value.delay_ms === 'number' && value.delay_ms >= 0))
      && Object.keys(value).every(key => key === 'reply' || key === 'delay_ms'))

function parseHeader(value: unknown): Fixture['header'] | string {
  if (!isObject(value)) return 'the header must be an object'
  const { fixture, hermes, source, sessionId, stored } = value
  if (fixture !== 1) return '"fixture" must be 1'
  if (typeof hermes !== 'string' || hermes === '') return '"hermes" must name the Hermes version'
  if (source !== 'generated' && source !== 'recorded') return '"source" must be "generated" or "recorded"'
  if (typeof sessionId !== 'string' || sessionId === '') return '"sessionId" must be a session id'
  if (!('describe' in value) || !('list' in value)) return 'the header needs "describe" and "list"'
  if (!Array.isArray(stored)) return '"stored" must be an array of rows'
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
  const { yolo, yoloDenied } = value
  if (yolo !== undefined && typeof yolo !== 'boolean') return '"yolo" must be true or false'
  if (yoloDenied !== undefined && typeof yoloDenied !== 'boolean') return '"yoloDenied" must be true or false'
  const { profiles } = value
  if (profiles !== undefined && !(isObject(profiles) && Array.isArray(profiles.profiles))) return '"profiles" must be a profiles.list reply with "profiles"'
  const { createWarnings } = value
  if (createWarnings !== undefined && !(Array.isArray(createWarnings) && createWarnings.every(warning => typeof warning === 'string'))) return '"createWarnings" must be a list of strings'
  const { reach, homeBotChat } = value
  if (reach !== undefined && reach !== 'host' && reach !== 'profile') return '"reach" must be "host" or "profile"'
  if (homeBotChat !== undefined && typeof homeBotChat !== 'boolean') return '"homeBotChat" must be true or false'
  const { media } = value
  if (media !== undefined && !(isObject(media) && Object.values(media).every(bytes => typeof bytes === 'string'))) return '"media" must map a url or path to base64 bytes'
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
  return {
    fixture, hermes, source, sessionId: sessionId as SessionId, describe: value.describe, list: value.list, stored,
    ...('catalog' in value ? { catalog: value.catalog } : {}),
    ...(models === undefined ? {} : { models }), ...(guarded === undefined ? {} : { guarded: guarded as string[] }),
    ...(usage === undefined ? {} : { usage }),
    ...(yolo === undefined ? {} : { yolo }), ...(yoloDenied === undefined ? {} : { yoloDenied }),
    ...(branches === undefined ? {} : { branches }), ...(tree === undefined ? {} : { tree }),
    ...(profiles === undefined ? {} : { profiles }),
    ...(createWarnings === undefined ? {} : { createWarnings: createWarnings as string[] }),
    ...(reach === undefined ? {} : { reach }), ...(homeBotChat === undefined ? {} : { homeBotChat }),
    ...(media === undefined ? {} : { media: media as Record<string, string> }),
    ...(chats === undefined ? {} : { chats: chats as { readonly [profile: string]: readonly ChatSeed[] } }),
    ...(relay === undefined ? {} : { relay: relay as { readonly [profile: string]: RelayScript } })
  }
}

/** Reads a fixture file, checking the header and every step. Throws with the line number of the first bad line. */
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
