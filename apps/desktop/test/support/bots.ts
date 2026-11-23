import { rosterOf, type BotFacts, type BotId, type Bots } from '@highwing/hermes/domain'

export const fact = (id: string, name: string, more: Partial<BotFacts> = {}): BotFacts =>
  ({ id: id as BotId, name, isDefault: false, section: null, preview: null, ...more })

export const listed = (...facts: readonly BotFacts[]): Bots => ({ state: 'listed', roster: rosterOf(facts) })

export const APPROVED = listed(
  fact('default', 'Emu', { isDefault: true }),
  fact('dr-eggbot', 'dr eggbot', { section: 'New section', preview: 'the SOUL.md is the same thi' }),
  fact('research', 'Research', { preview: "In Let's talk about QAing your" }),
  fact('timothy', 'Timothy · CEO', { preview: 'Should I start building Launch' }),
  fact('hermes-dev', 'Hermes', { preview: 'Use case 6 is the video\'s "aut' }),
  fact('highwing', 'highwing', { preview: 'The step 1 plan is ready in the' })
)
