import type { TurnId } from '@highwing/hermes/domain'

export interface Placed<T> {
  /** Those whose `after` is null, drawn before every turn. */
  readonly first: readonly T[]
  /** By the key of the turn each sits after. */
  readonly after: ReadonlyMap<string, readonly T[]>
  /** After a turn the thread no longer holds, as after a rebuilt history. */
  readonly last: readonly T[]
}

/** Where things drawn beside the turns sit, such as the messages handed to other bots, each group in the order given. */
export function placeByTurn<T extends { readonly after: TurnId | null }>(held: readonly T[], turnKeys: readonly string[]): Placed<T> {
  const first: T[] = []
  const last: T[] = []
  const after = new Map<string, T[]>(turnKeys.map(key => [key, []]))
  for (const each of held) (each.after === null ? first : after.get(each.after) ?? last).push(each)
  return { first, after, last }
}
