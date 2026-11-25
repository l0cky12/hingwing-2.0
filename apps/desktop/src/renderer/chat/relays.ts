import type { Relay } from '@highwing/hermes/domain'

export interface PlacedRelays {
  /** Sent before the chat held a turn. */
  readonly first: readonly Relay[]
  /** By the key of the turn each was sent after. */
  readonly after: ReadonlyMap<string, readonly Relay[]>
  /** Sent after a turn the thread no longer holds, as after a rebuilt history. */
  readonly last: readonly Relay[]
}

/** Where the messages handed to other bots sit among the turns, each group in the order sent. */
export function placeRelays(relays: readonly Relay[], turnKeys: readonly string[]): PlacedRelays {
  const first: Relay[] = []
  const last: Relay[] = []
  const after = new Map<string, Relay[]>(turnKeys.map(key => [key, []]))
  for (const relay of relays) (relay.after === null ? first : after.get(relay.after) ?? last).push(relay)
  return { first, after, last }
}
