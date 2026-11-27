import type { SessionId } from '@highwing/hermes/domain'

export interface PaneRefusal {
  readonly id: SessionId | null
  readonly message: string
}

export function refusalOnPane(refused: PaneRefusal | null, id: SessionId | null): PaneRefusal | null {
  if (refused === null || (refused.id !== null && refused.id !== id)) return null
  if (refused.id === null && id !== null) return { id, message: refused.message }
  return refused
}
