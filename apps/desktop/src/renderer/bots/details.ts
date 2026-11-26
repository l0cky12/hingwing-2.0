import type { BotDetails, CommandOutcome } from '@highwing/hermes/domain'

export type DetailsLoad =
  | { readonly at: 'loading' }
  | { readonly at: 'shown'; readonly details: BotDetails }
  | { readonly at: 'refused'; readonly words: string }

export const LOADING: DetailsLoad = { at: 'loading' }

export const loadOf = (outcome: CommandOutcome<BotDetails>): DetailsLoad =>
  outcome.ok ? { at: 'shown', details: outcome.value } : { at: 'refused', words: outcome.refusal.message }

export type DetailsTab = 'details' | 'routines' | 'memory' | 'library'

export const DETAILS_TABS: readonly { readonly id: DetailsTab; readonly label: string }[] = [{ id: 'details', label: 'Details' }]
