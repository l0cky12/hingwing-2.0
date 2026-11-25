import { slashLineOf, type SendPlan, type SlashCatalog } from '@highwing/hermes/domain'
import type { Editing } from './edit'

const BUSY_WORDS = {
  submit: null,
  steer: 'Hermes is working. It reads this after its current step.',
  redirect: 'Hermes is working. It stops this step to read this.'
} as const satisfies Record<SendPlan['by'], string | null>

/** An edit never reaches the running turn, so it gets no hint. */
export const busyHint = (by: SendPlan['by'], draft: string, catalog: SlashCatalog, editing: Editing | null): string | null =>
  editing === null && slashLineOf(draft, catalog) === null ? BUSY_WORDS[by] : null
