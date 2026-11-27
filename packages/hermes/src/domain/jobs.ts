declare const brand: unique symbol

export type JobId = string & { readonly [brand]: 'JobId' }

/** A scheduled job as Hermes last listed it: when it last ran and how that run ended. */
export interface Job {
  readonly id: JobId
  readonly name: string
  /** When the last run ended, as Hermes wrote it. null: it has not run. */
  readonly ranAt: string | null
  readonly failed: boolean
  readonly error: string | null
}
