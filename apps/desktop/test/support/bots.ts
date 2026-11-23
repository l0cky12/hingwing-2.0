import { rosterOf, type BotFacts, type BotId, type Bots } from '@highwing/hermes/domain'

export const fact = (id: string, name: string, more: Partial<BotFacts> = {}): BotFacts =>
  ({ id: id as BotId, name, isDefault: false, role: null, section: null, chosenTone: null, preview: null, ...more })

export const listed = (...facts: readonly BotFacts[]): Bots => ({ state: 'listed', roster: rosterOf(facts) })

export const APPROVED = listed(
  fact('default', 'Hermes Agent', { isDefault: true }),
  fact('researcher', 'Researcher', { section: 'Work', preview: 'Three of the five sources agree.' }),
  fact('reviewer', 'Reviewer', { section: 'Work', role: 'Code review', preview: 'The slash menu change looks right.' }),
  fact('ops', 'Ops', { role: 'On call', preview: 'Pruned four worktrees.' }),
  fact('scribe', 'Scribe')
)
