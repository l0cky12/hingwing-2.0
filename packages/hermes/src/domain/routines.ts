/** A job Hermes's scheduler runs for a bot. `schedule` is Hermes's own words for when (cron/job_args.py:494). */
export interface Routine {
  readonly id: string
  readonly name: string
  readonly schedule: string
  readonly paused: boolean
}
