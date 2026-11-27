import { randomBytes } from 'node:crypto'
import type { Bot } from './domain/bots'
import type { Relay, RelayDesk, RelayId, RelayState } from './domain/relay'
import type { SessionId, TurnId } from './domain/session'
import { Offline, RpcRefusal, type Connection } from './wire/link'
import { parseDelivery, undeliveredWords } from './wire/parse'

const METHOD_NOT_FOUND = -32601
const PROBE_TIMEOUT_MS = 10_000
/**
 * `bot_relay.deliver` answers when the target's turn ends. Hermes's own desktop waits this long: 120 s
 * for the target's lock, two attempts of 600 s, and 180 s of margin.
 */
export const RELAY_TIMEOUT_MS = 1_500_000

function failureWords(error: unknown, name: string, online: boolean): string {
  if (error instanceof RpcRefusal) return undeliveredWords(error.reason, name) ?? `${name} couldn't take your message: ${error.message}`
  if (!(error instanceof Offline)) throw error
  return online ? `${name} didn't answer in ${RELAY_TIMEOUT_MS / 60_000} minutes.` : `The connection to Hermes dropped before ${name} answered.`
}

export interface RelayBook {
  readonly desk: RelayDesk
  /** Asks a new socket whether its Hermes has `bot_relay.deliver`. An answer that never comes leaves the last one. */
  probe(): Promise<void>
  /** Hands `text` to `to` and files it under `sessionId` as waiting, then as what came back. Never rejects. */
  send(sessionId: SessionId, after: TurnId | null, to: Bot, text: string): void
  /** Moves each message of `sessionId` to the turn `moved` names for the turn it sat after. */
  reanchor(sessionId: SessionId, moved: (after: TurnId) => TurnId | null): void
}

/** Owns the messages handed to other bots, for the hub's lifetime. `changed` runs after every change of `desk`. */
export function relayBook(conn: Pick<Connection, 'call' | 'as' | 'link'>, changed: () => void): RelayBook {
  let desk: RelayDesk = { supported: false, bySession: {} }
  const put = (next: RelayDesk) => {
    desk = next
    changed()
  }
  const settle = (sessionId: SessionId, id: RelayId, state: RelayState) =>
    put({ ...desk, bySession: { ...desk.bySession, [sessionId]: (desk.bySession[sessionId] ?? []).map(relay => (relay.id === id ? { ...relay, state } : relay)) } })

  return {
    get desk() { return desk },
    probe: async () => {
      // Empty params are refused at the id check, before anything is admitted, so the answer says only whether the method exists.
      const supported = await conn.call('bot_relay.deliver', {} as never, PROBE_TIMEOUT_MS).then(() => true, (error: unknown) => {
        if (error instanceof RpcRefusal) return error.code !== METHOD_NOT_FOUND
        if (error instanceof Offline) return null
        throw error
      })
      if (supported !== null && supported !== desk.supported) put({ ...desk, supported })
    },
    send: (sessionId, after, to, text) => {
      const relay: Relay = { id: randomBytes(16).toString('hex') as RelayId, to: to.id, name: to.name, tone: to.tone, text, after, state: { s: 'waiting' } }
      put({ ...desk, bySession: { ...desk.bySession, [sessionId]: [...(desk.bySession[sessionId] ?? []), relay] } })
      void conn.as(to.id).call('bot_relay.deliver', { id: relay.id, message: text }, RELAY_TIMEOUT_MS).then(
        reply => parseDelivery(reply, to.name),
        (error: unknown): RelayState => ({ s: 'failed', words: failureWords(error, to.name, conn.link.state === 'online') })
      ).then(state => settle(sessionId, relay.id, state))
    },
    reanchor: (sessionId, moved) => {
      const held = desk.bySession[sessionId] ?? []
      const placed = held.map(relay => {
        const after = relay.after === null ? null : moved(relay.after)
        return after === relay.after ? relay : { ...relay, after }
      })
      if (placed.some((relay, at) => relay !== held[at])) put({ ...desk, bySession: { ...desk.bySession, [sessionId]: placed } })
    }
  }
}
