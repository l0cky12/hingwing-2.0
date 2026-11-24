export interface OpenState {
  readonly opened: ReadonlySet<string>
  readonly closed: ReadonlySet<string>
}

export const NONE_OPEN: OpenState = { opened: new Set(), closed: new Set() }

export const isOpen = (state: OpenState, key: string, byDefault: boolean) => state.opened.has(key) || (byDefault && !state.closed.has(key))

const without = (held: ReadonlySet<string>, key: string) => new Set([...held].filter(row => row !== key))

/** A node open by default is closed through `closed`, and a press that opens it again also records the choice in `opened`, so it stays open when its turn settles. */
export function toggled(state: OpenState, key: string, byDefault: boolean): OpenState {
  if (isOpen(state, key, byDefault)) return { opened: without(state.opened, key), closed: byDefault ? new Set([...state.closed, key]) : state.closed }
  return { opened: new Set([...state.opened, key]), closed: without(state.closed, key) }
}
