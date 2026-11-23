export interface SlashEntry {
  readonly kind: 'command' | 'skill'
  /** Without the leading slash, as typed after it. */
  readonly name: string
  readonly description: string
}

/** Commands first, then skills. Empty when Hermes has no catalog or refused it: then there is no menu. */
export type SlashCatalog = readonly SlashEntry[]

export interface SlashLine {
  readonly entry: SlashEntry
  readonly arg: string
}

const LINE = /^\/(\S+)(?:\s+([\s\S]*))?$/

export function slashLineOf(text: string, catalog: SlashCatalog): SlashLine | null {
  const match = LINE.exec(text.trim())
  if (match === null) return null
  const entry = catalog.find(held => held.name === match[1])
  return entry === undefined ? null : { entry, arg: (match[2] ?? '').trim() }
}
