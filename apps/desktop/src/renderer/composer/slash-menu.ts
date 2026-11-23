import type { SlashCatalog, SlashEntry } from '@highwing/hermes/domain'

export interface MenuState {
  readonly active: number
  readonly dismissedDraft: string | null
}

export type Menu =
  | { readonly open: false }
  | { readonly open: true; readonly matches: readonly SlashEntry[]; readonly active: number }

const CLOSED: Menu = { open: false }
const TYPING_A_NAME = /^\/(\S*)$/

export function menuOf(draft: string, catalog: SlashCatalog, { active, dismissedDraft }: MenuState): Menu {
  const typed = TYPING_A_NAME.exec(draft)?.[1]
  if (typed === undefined || draft === dismissedDraft) return CLOSED
  const query = typed.toLowerCase()
  const matches = catalog.filter(entry => entry.name.toLowerCase().startsWith(query))
  if (matches.length === 0) return CLOSED
  return { open: true, matches, active: ((active % matches.length) + matches.length) % matches.length }
}

export const completionOf = (entry: SlashEntry) => `/${entry.name} `
