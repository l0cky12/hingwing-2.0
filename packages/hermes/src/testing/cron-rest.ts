/**
 * The fixture's cron REST routes (hermes_cli/web_routers/cron.py): the answer to run a routine now, and to change its schedule.
 * Every answer is one the script holds, in the shape Hermes sends it, and nothing here knows what a schedule means. A job with
 * no `rest` entry has neither route, as it does not on a Hermes without them. The routes are found as the app finds them, by the
 * job's run list, which `history` serves.
 */
import { systemClock, type HermesRequest, type HttpAnswer, type WriteHermes } from '../wire/link'
import type { CronScript } from './fixture'

/** What Hermes answers: the status, and the JSON body as Hermes sends it. */
export interface RestAnswer { readonly status: number; readonly body: unknown }
/**
 * `trigger`: the answer to `POST /api/cron/jobs/<id>/trigger`, sent `trigger_ms` after the call (default 0), as Hermes answers once the
 * job has run. `reschedule`: the answer to `PUT /api/cron/jobs/<id>` for each exact schedule text. A text not listed is answered 400 with
 * the detail Hermes gives for a schedule it cannot read. A write the entry holds no answer for is a 404 `Not Found`.
 */
export interface CronRest {
  readonly trigger?: RestAnswer
  readonly trigger_ms?: number
  readonly reschedule?: { readonly [schedule: string]: RestAnswer }
}

export const NOT_FOUND: HttpAnswer = { status: 404, body: { detail: 'Not Found' } }

type Obj = Readonly<Record<string, unknown>>
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)
const isAnswer = (value: unknown): value is RestAnswer => isObject(value) && Number.isInteger(value.status) && (value.status as number) >= 100 && (value.status as number) <= 599 && 'body' in value

export const isRestScript = (value: unknown): value is { readonly [job_id: string]: CronRest } =>
  isObject(value) && Object.values(value).every(entry => isObject(entry)
    && (entry.trigger === undefined || isAnswer(entry.trigger))
    && (entry.trigger_ms === undefined || (Number.isFinite(entry.trigger_ms) && (entry.trigger_ms as number) >= 0))
    && (entry.reschedule === undefined || (isObject(entry.reschedule) && Object.values(entry.reschedule).every(isAnswer))))

const JOB_PATH = /^\/api\/cron\/jobs\/([^/?]+)(\/trigger)?(?:\?|$)/

/** The job a `/api/cron/jobs/<id>` or `.../trigger` path names, and whether it is the trigger route. null: any other path. */
function jobOf(path: string): { readonly job: string; readonly trigger: boolean } | null {
  const match = JOB_PATH.exec(path)
  try {
    return match?.[1] === undefined ? null : { job: decodeURIComponent(match[1]), trigger: match[2] !== undefined }
  } catch {
    return null
  }
}

const entryOf = (cron: CronScript | undefined, job: string): CronRest | null =>
  cron?.rest !== undefined && Object.hasOwn(cron.rest, job) ? cron.rest[job] ?? null : null

/** Hermes's reason for a schedule it cannot read (cron/jobs.py:857-865), which a 400 carries in `detail`. */
const unreadable = (text: string): HttpAnswer => ({
  status: 400,
  body: {
    detail: `Invalid schedule '${text}'. Use:\n  - Interval: '30m', 'every 30m', 'every 2h' (recurring)\n  - One-shot delay: 'in 30m', 'in 2h' (fires once)\n`
      + "  - Weekly/daily: 'every monday 9am', 'weekdays at 9am' (recurring)\n  - Cron: '0 9 * * *' (cron expression)\n  - Timestamp: '2026-02-03T14:00:00' (one-shot at time)"
  }
})

/** The schedule a PUT carries, when its body is `{ updates: { schedule } }`. */
const scheduleOf = (json: unknown): string | null =>
  isObject(json) && isObject(json.updates) && typeof json.updates.schedule === 'string' ? json.updates.schedule : null

async function answer({ method, path, json }: HermesRequest, cron: CronScript | undefined): Promise<HttpAnswer> {
  const named = jobOf(path)
  const entry = named === null ? null : entryOf(cron, named.job)
  if (named === null || entry === null) return NOT_FOUND
  if (named.trigger) {
    if (method !== 'POST' || entry.trigger === undefined) return NOT_FOUND
    await new Promise<void>(resolve => systemClock.setTimeout(resolve, entry.trigger_ms ?? 0))
    return entry.trigger
  }
  const text = scheduleOf(json)
  if (method !== 'PUT' || entry.reschedule === undefined) return NOT_FOUND
  if (text === null) return { status: 422, body: { detail: [{ type: 'missing', loc: ['body', 'updates'], msg: 'Field required' }] } }
  return Object.hasOwn(entry.reschedule, text) ? entry.reschedule[text] ?? NOT_FOUND : unreadable(text)
}

/** The fixture's writes: the cron routes its script holds answers for, and a 404 for every other path. */
export const fixtureWrite = (script: { readonly cron?: CronScript | undefined }): WriteHermes => request => answer(request, script.cron)
