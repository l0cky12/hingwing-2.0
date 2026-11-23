/**
 * `@highwing/hermes/testing`: a recorded or generated gateway, played back through the real client.
 */
import { readFileSync } from 'node:fs'
import type { SessionId } from '../domain/session'

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
  }
  readonly steps: readonly FixtureStep[]
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

function parseHeader(value: unknown): Fixture['header'] | string {
  if (!isObject(value)) return 'the header must be an object'
  const { fixture, hermes, source, sessionId, stored } = value
  if (fixture !== 1) return '"fixture" must be 1'
  if (typeof hermes !== 'string' || hermes === '') return '"hermes" must name the Hermes version'
  if (source !== 'generated' && source !== 'recorded') return '"source" must be "generated" or "recorded"'
  if (typeof sessionId !== 'string' || sessionId === '') return '"sessionId" must be a session id'
  if (!('describe' in value) || !('list' in value)) return 'the header needs "describe" and "list"'
  if (!Array.isArray(stored)) return '"stored" must be an array of rows'
  return {
    fixture, hermes, source, sessionId: sessionId as SessionId, describe: value.describe, list: value.list, stored,
    ...('catalog' in value ? { catalog: value.catalog } : {})
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
