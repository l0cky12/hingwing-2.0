/**
 * A bot's routines: the Hermes cron jobs it owns. Hermes runs them, and Highwing only shows them.
 * Plain JSON data only, like `session.ts`, because these values cross Electron IPC.
 */
declare const brand: unique symbol

/** Hermes's `job_id`. */
export type RoutineId = string & { readonly [brand]: 'RoutineId' }

export interface Routine {
  readonly id: RoutineId
  /** The job's name without the `[bot:<name>] ` tag Hermes desktop puts in front of it. */
  readonly name: string
  /** Hermes's own words for when it runs, such as `every 60m`, `0 9 * * 1-5` or `once at 2026-12-01 09:00`. */
  readonly schedule: string
  readonly paused: boolean
  /** ISO 8601, as Hermes stores it. null: Hermes has no next run for it. */
  readonly nextRunAt: string | null
}
