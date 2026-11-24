import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { systemClock, wireSocket, type Clock, type Dialer } from '../wire/link'
import { MASKED, type Fixture, type FixtureStep } from './fixture'

type Obj = Readonly<Record<string, unknown>>
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)

type Header = { -readonly [K in keyof Fixture['header']]?: Fixture['header'][K] }

interface Slot { step: FixtureStep | null }

type Found = { readonly push: unknown } | { readonly stored: readonly unknown[] }
const NOTHING: readonly Found[] = []

const OWN_ANSWERS: Readonly<Record<string, (header: Header, reply: Obj, params: Obj) => readonly Found[]>> = {
  'client.capabilities': () => NOTHING,
  'gateway.ping': () => NOTHING,
  'session.detach': () => NOTHING,
  'session.stats': () => NOTHING,
  'session.context_breakdown': () => NOTHING,
  'bot_relay.deliver': () => NOTHING,
  'complete.path': () => NOTHING,
  'runtime.describe': (header, reply) => {
    header.describe ??= reply
    return NOTHING
  },
  'commands.catalog': (header, reply) => {
    header.catalog ??= reply
    return NOTHING
  },
  'profiles.list': (header, reply) => {
    header.profiles ??= reply
    return NOTHING
  },
  'config.get': (header, reply) => {
    if (typeof reply.key === 'string' && typeof reply.value === 'string') header.controls = { [reply.key]: reply.value, ...header.controls }
    return NOTHING
  },
  'config.set': () => NOTHING,
  'session.list': (header, reply, params) => {
    if (params.scope !== 'stored' && params.title === undefined) header.list ??= reply
    return NOTHING
  },
  'session.events.since': (header, reply) => {
    const events = Array.isArray(reply.events) ? reply.events : []
    return events.filter(params => isObject(params) && params.session_id === header.sessionId).map(params => ({ push: { jsonrpc: '2.0', method: 'event', params } }))
  },
  'session.resume': attachReply,
  'session.create': attachReply
}

const masked = (values: unknown) => (isObject(values) ? Object.fromEntries(Object.keys(values).map(name => [name, MASKED])) : values)

/** The answer to a password, secret or code prompt is `{value}`. An empty one is a skip and says nothing. */
const maskedResult = (result: unknown) => (isObject(result) && typeof result.value === 'string' && result.value !== '' ? { ...result, value: MASKED } : result)

function maskedParams(method: string, params: Obj): Obj {
  if (method !== 'connection.respond' || !isObject(params.result) || !Array.isArray(params.result.targets)) return params
  const targets = params.result.targets.map((target: unknown) => (isObject(target) && 'env' in target ? { ...target, env: masked(target.env) } : target))
  return { ...params, result: { ...params.result, targets } }
}

function attachReply(header: Header, reply: Obj): readonly Found[] {
  if (typeof reply.session_id !== 'string') return NOTHING
  header.sessionId ??= reply.session_id as Fixture['header']['sessionId']
  if (reply.session_id !== header.sessionId) return NOTHING
  const version = isObject(reply.info) ? reply.info.version : undefined
  if (typeof version === 'string') header.hermes ??= version
  const rows = Array.isArray(reply.display_messages) ? reply.display_messages : undefined
  if (header.stored !== undefined) return rows === undefined ? NOTHING : [{ stored: rows }]
  header.stored = rows ?? []
  return NOTHING
}

/**
 * Wraps any dialer and appends every frame of one session, in and out, to `path` in fixture format
 * (`HIGHWING_RECORD=out.jsonl pnpm dev`). The session is the first one the client attaches. A
 * `session.resume` reply that carried rows is written as a `stored` step. An answer to a server
 * request is written as an `answer` step. Recordings hold real paths and commands: they go to a
 * git-ignored folder, and a fixture is committed only after review.
 * No ticket can reach the file: the recorder sits above the dial and sees frames only. No typed
 * secret can either: a value sent for a password, a secret or a code, and every credential a
 * connector card sends, is written as `MASKED`.
 */
export function recordingDialer(inner: Dialer, path: string, clock: Clock = systemClock): Dialer {
  const startedAt = clock.now()
  const header: Header = { fixture: 1, source: 'recorded' }
  const slots: Slot[] = []
  let written: string | null = null
  const line = (value: unknown) => `${JSON.stringify(value)}\n`
  const at = () => clock.now() - startedAt
  const add = (step: FixtureStep | null): Slot => {
    const slot = { step }
    slots.push(slot)
    return slot
  }
  const flush = () => {
    const { describe, list, sessionId, stored } = header
    if (describe === undefined || list === undefined || sessionId === undefined || stored === undefined) return
    const head = line({ ...header, hermes: header.hermes ?? 'unknown' })
    if (written === null) writeFileSync(path, head)
    else if (head !== written) writeFileSync(path, head + readFileSync(path, 'utf8').slice(written.length))
    written = head
    for (let next = slots[0]; next !== undefined && next.step !== null; next = slots[0]) {
      appendFileSync(path, line(next.step))
      slots.shift()
    }
  }
  const ofSession = (params: unknown) => isObject(params) && params.session_id !== undefined && params.session_id === header.sessionId

  return async request => {
    const socket = await inner(request)
    const calls = new Map<unknown, { readonly method: string; readonly params: Obj; readonly at: number; readonly slot: Slot | null }>()
    const sent = (frame: unknown) => {
      if (!isObject(frame) || frame.id === undefined) return
      if (typeof frame.method !== 'string') {
        const { code, message } = isObject(frame.error) ? frame.error : {}
        if (typeof code === 'number' && typeof message === 'string') add({ at: at(), answer: String(frame.id), error: { code, message } })
        else if ('result' in frame) add({ at: at(), answer: String(frame.id), result: maskedResult(frame.result) })
        return
      }
      const own = frame.method in OWN_ANSWERS
      calls.set(frame.id, { method: frame.method, params: isObject(frame.params) ? frame.params : {}, at: at(), slot: own ? null : add(null) })
    }
    const heard = (frame: unknown) => {
      if (!isObject(frame)) return
      if (typeof frame.method === 'string') {
        if (ofSession(frame.params)) add({ at: at(), push: frame })
        return
      }
      const call = calls.get(frame.id)
      if (call === undefined) return
      calls.delete(frame.id)
      const { method, params } = call
      if (call.slot !== null) {
        const answer = isObject(frame.error) ? { error: frame.error as NonNullable<Extract<FixtureStep, { await: string }>['error']> } : { reply: frame.result }
        call.slot.step = { at: call.at, await: method, params: maskedParams(method, params), ...answer }
      } else if (isObject(frame.result)) {
        for (const found of OWN_ANSWERS[method]?.(header, frame.result, params) ?? NOTHING) add({ at: at(), ...found })
      }
    }
    const wire = wireSocket({
      send: text => {
        sent(JSON.parse(text))
        socket.send(text)
      },
      close: () => socket.close()
    }, socket.reach)
    socket.onText = text => {
      heard(JSON.parse(text))
      flush()
      wire.text(text)
    }
    socket.onClose = (code, reason) => {
      add({ at: at(), drop: code })
      flush()
      wire.closed(code, reason)
    }
    return wire.socket
  }
}
