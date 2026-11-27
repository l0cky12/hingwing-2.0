import type { Job } from './domain/jobs'
import { Offline, RpcRefusal, type Connection } from './wire/link'
import { parseJobs } from './wire/parse'

export interface JobList {
  /** The home profile's scheduled jobs. null until Hermes lists them, and on a Hermes that refuses `cron.manage`. */
  readonly jobs: readonly Job[] | null
  /** Lists the jobs again. One list is in flight at a time, and asking during it lists once more after it. */
  read(): void
}

/** `changed` runs after every new list. A list the link drops, or Hermes fails, keeps the last one. */
export function jobList(conn: Pick<Connection, 'call'>, changed: () => void): JobList {
  let jobs: readonly Job[] | null = null
  let reading = false
  let again = false

  const read = async () => {
    if (reading) {
      again = true
      return
    }
    reading = true
    try {
      const listed = parseJobs(await conn.call('cron.manage', { action: 'list', include_disabled: true }))
      if (listed !== null) {
        jobs = listed
        changed()
      }
    } catch (error) {
      if (!(error instanceof Offline) && !(error instanceof RpcRefusal)) throw error
    } finally {
      reading = false
      if (again) {
        again = false
        void read()
      }
    }
  }

  return {
    get jobs() { return jobs },
    read: () => void read()
  }
}
