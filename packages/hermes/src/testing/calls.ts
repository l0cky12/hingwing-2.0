import { profiled, type CallHermes, type HttpAnswer } from '../wire/link'
import type { CronScript, MemoryScript } from './fixture'
import { kanbanCall, MISSING, type Kanban } from './kanban'
import { memoryReads } from './memory-book'
import { configCall, type RuleBook } from './rules'

const RUNS_PATH = /^\/api\/cron\/jobs\/([^/?]+)\/runs(?:\?|$)/

/** The job a `/api/cron/jobs/<id>/runs` path names, or null for any other path. */
function runsJobOf(path: string): string | null {
  const named = RUNS_PATH.exec(path)?.[1]
  try {
    return named === undefined ? null : decodeURIComponent(named)
  } catch {
    return null
  }
}

/** Hermes keeps one config.yaml, so a fixture that scripts both the memory caps and the command rules answers `/api/config` with both. */
function oneConfig(rules: HttpAnswer | null, memory: HttpAnswer | null): HttpAnswer | null {
  const held = [rules, memory].filter(answer => answer?.status === 200) as HttpAnswer[]
  if (held.length === 0) return rules ?? memory
  return { status: 200, body: Object.assign({}, ...held.map(answer => answer.body)) }
}

export interface FixtureRoutes {
  readonly kanban?: Kanban | undefined
  readonly cron?: CronScript | undefined
  readonly memory?: MemoryScript | undefined
}

/**
 * The HTTP calls a fixture run answers, as the app's main process makes them: the kanban plugin's routes from the header's
 * `kanban`, a routine's runs from its `cron`, the Memory tab's reads from its `memory`, and `/api/config` from the command
 * rules the gateway holds. Any other path is a 404, as it is on a Hermes without that route.
 */
export function fixtureCall({ kanban, cron, memory }: FixtureRoutes, rules: RuleBook | null): CallHermes {
  const memoryRead = memoryReads(memory)
  return async ask => {
    const kanbanAnswer = kanbanCall(kanban, ask)
    if (kanbanAnswer !== null) return kanbanAnswer
    // The memory and runs routes read the profile from the query, where a GET carries it.
    const { path } = profiled(ask)
    const remembered = ask.method === 'GET' ? memoryRead(path) : null
    const config = oneConfig(configCall(rules, ask), remembered)
    if (config !== null) return config
    const job = ask.method === 'GET' ? runsJobOf(path) : null
    const history = cron?.history
    return job !== null && history !== undefined && Object.hasOwn(history, job) ? { status: 200, body: history[job] } : MISSING
  }
}
