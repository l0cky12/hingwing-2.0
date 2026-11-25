import { slashLineOf, type SendPlan, type SlashCatalog } from '@highwing/hermes/domain'

const BUSY_WORDS = {
  submit: null,
  steer: 'Hermes is working. It reads this after its current step.',
  redirect: 'Hermes is working. It stops this step to read this.'
} as const satisfies Record<SendPlan['by'], string | null>

export const busyHint = (by: SendPlan['by'], draft: string, catalog: SlashCatalog): string | null =>
  slashLineOf(draft, catalog) === null ? BUSY_WORDS[by] : null
