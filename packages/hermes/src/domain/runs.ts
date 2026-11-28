/**
 * A routine's past runs as Hermes's `GET /api/cron/jobs/{id}/runs` lists them (hermes_cli/web_routers/cron.py),
 * read into what the Routines tab draws. Plain JSON data only, like `session.ts`, because these values cross
 * Electron IPC. Hermes's rows carry far more than this (chat ids, user ids, prompts), and none of it is copied.
 */
import type { BotId } from './bots'
import type { RoutineId } from './routines'
import type { SessionId } from './session'

/** What Hermes recorded about how one run went. */
export type RunOutcome =
  | { readonly is: 'running' }
  | { readonly is: 'succeeded' }
  | { readonly is: 'failed'; readonly why: string }
  | { readonly is: 'cancelled'; readonly why: string | null }
  | { readonly is: 'missed'; readonly why: string | null }
  /** Hermes kept no verdict for it: an output doc with no status, or a session that ended some other way or never closed. */
  | { readonly is: 'unknown' }

export interface RoutineRun {
  /** Hermes's row id, unique in the list. */
  readonly key: string
  readonly outcome: RunOutcome
  /** Epoch ms Hermes stamps the run with: a session's start, or when a script-only run finished. */
  readonly at: number
  /** How long it ran. null: Hermes doesn't say, because it is still running or left only an output doc. */
  readonly seconds: number | null
  /** The run's chat. null: Hermes kept no session for it. */
  readonly chat: SessionId | null
  /** The profile Hermes says holds the run's chat, which an older Hermes may put outside the routine's bot. null: it doesn't say. */
  readonly owner: BotId | null
}

export const RUNS_SHOWN = 20

export const runsPath = (routine: RoutineId, bot: BotId): string =>
  `/api/cron/jobs/${encodeURIComponent(routine)}/runs?profile=${encodeURIComponent(bot)}&limit=${RUNS_SHOWN}`

export const NO_REASON = 'Hermes gave no reason.'

/** The title Hermes puts after a status when a script-only run left neither an error nor an output (`_execution_status_title`). */
const NO_OUTPUT_TITLE = 'Script-only run'

const RUNNING: RunOutcome = { is: 'running' }
const SUCCEEDED: RunOutcome = { is: 'succeeded' }
const UNKNOWN: RunOutcome = { is: 'unknown' }

const reasonOrNull = (rest: string): string | null => (rest === '' || rest === NO_OUTPUT_TITLE ? null : rest)
const failure = (rest: string): RunOutcome => ({ is: 'failed', why: reasonOrNull(rest) ?? NO_REASON })

/** The status words Hermes puts before ` · ` in a row's title (`_execution_status_title`, `_cron_output_status_label`). */
const LABELLED: ReadonlyMap<string, (rest: string) => RunOutcome> = new Map<string, (rest: string) => RunOutcome>([
  ['COMPLETED', () => SUCCEEDED],
  ['OK', () => SUCCEEDED],
  ['FAILED', failure],
  ['ERROR', failure],
  ['CANCELLED', rest => ({ is: 'cancelled', why: reasonOrNull(rest) })],
  ['MISSED', rest => ({ is: 'missed', why: reasonOrNull(rest) })]
])

/** `end_reason` of a session a cron run closed (cron/scheduler.py). Any other reason, or none, is no verdict. */
const ENDED: ReadonlyMap<string, RunOutcome> = new Map<string, RunOutcome>([
  ['cron_complete', SUCCEEDED],
  ['cron_incomplete_no_output', { is: 'failed', why: 'It ended without a final reply.' }]
])

const SEPARATOR = ' · '

function outcomeOfTitle(title: string): RunOutcome {
  const at = title.indexOf(SEPARATOR)
  const verdict = LABELLED.get(at < 0 ? title : title.slice(0, at))
  return verdict === undefined ? UNKNOWN : verdict(at < 0 ? '' : title.slice(at + SEPARATOR.length).trim())
}

type Obj = Readonly<Record<string, unknown>>
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)
const seconds = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/**
 * Whether a session's run is still going. `scheduler_owned` is Hermes's own answer, from the execution the scheduler
 * holds. A Hermes that predates it says only `is_active`, which is recent activity within five minutes.
 */
const running = (row: Obj): boolean => (typeof row.scheduler_owned === 'boolean' ? row.scheduler_owned : row.is_active === true)

function sessionRow(key: string, row: Obj, started: number): RoutineRun {
  const title = typeof row.title === 'string' ? row.title : ''
  const ended = seconds(row.ended_at) && row.ended_at >= started ? row.ended_at : null
  const verdict = typeof row.end_reason === 'string' ? ENDED.get(row.end_reason) : undefined
  const outcome = title.startsWith('CANCELLED' + SEPARATOR) ? outcomeOfTitle(title) : verdict ?? (running(row) ? RUNNING : UNKNOWN)
  const owner = typeof row.profile === 'string' && row.profile !== '' ? row.profile as BotId : null
  return { key, outcome, at: started * 1000, seconds: ended === null ? null : ended - started, chat: key as SessionId, owner }
}

function outputRow(key: string, row: Obj, started: number): RoutineRun {
  return { key, outcome: outcomeOfTitle(typeof row.title === 'string' ? row.title : ''), at: started * 1000, seconds: null, chat: null, owner: null }
}

const FAMILIES: ReadonlyMap<string, (key: string, row: Obj, started: number) => RoutineRun> = new Map<string, (key: string, row: Obj, started: number) => RoutineRun>([
  ['cron', sessionRow],
  ['cron_output', outputRow]
])

function runOf(raw: unknown): RoutineRun | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || raw.id === '' || typeof raw.source !== 'string' || !seconds(raw.started_at)) return null
  return FAMILIES.get(raw.source)?.(raw.id, raw, raw.started_at) ?? null
}

/** Newest first, as Hermes sends them, at most `RUNS_SHOWN`. A row Highwing can't read is left out. null: the reply is not Hermes's run list. */
export function parseRoutineRuns(body: unknown): readonly RoutineRun[] | null {
  if (!isObject(body) || !Array.isArray(body.runs)) return null
  const seen = new Set<string>()
  const runs: RoutineRun[] = []
  for (const raw of body.runs) {
    const run = runOf(raw)
    if (run === null || seen.has(run.key)) continue
    seen.add(run.key)
    runs.push(run)
    if (runs.length === RUNS_SHOWN) break
  }
  return runs
}
