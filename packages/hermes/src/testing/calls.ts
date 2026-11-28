import type { CallHermes } from '../wire/link'
import { kanbanCall, MISSING, type Kanban } from './kanban'
import { configCall, type RuleBook } from './rules'

/**
 * The HTTP calls a fixture run answers, as the app's main process makes them: the kanban plugin's routes from the header's
 * `kanban`, and `/api/config` from the command rules the gateway holds. Any other path is a 404.
 */
export function fixtureCall(kanban: Kanban | undefined, rules: RuleBook | null): CallHermes {
  return async ask => kanbanCall(kanban, ask) ?? configCall(rules, ask) ?? MISSING
}
