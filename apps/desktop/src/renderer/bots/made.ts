import type { BotCreated } from '@highwing/hermes/domain'
import { useSyncExternalStore } from 'react'

/** The bot just made, which the Bots column shows the warnings of. A template makes its bot from the Connectors screen, so the column does not hold this itself. */
let made: BotCreated | null = null
const listeners = new Set<() => void>()

export function setMade(next: BotCreated | null): void {
  made = next
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export const useMade = (): BotCreated | null => useSyncExternalStore(subscribe, () => made, () => made)
