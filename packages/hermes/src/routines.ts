import type { BotId } from './domain/bots'
import type { RoutineList, Routines } from './domain/routines'
import { NOT_CONNECTED } from './open'
import { METHOD_NOT_FOUND, Offline, RpcRefusal, type Connection } from './wire/link'
import { parseRoutines } from './wire/parse'

/** Hermes reads the profile's jobs file for this call, so a slow disk can stall it. */
const READ_TIMEOUT_MS = 10_000
const READING: RoutineList = { state: 'reading' }
const OFFLINE = NOT_CONNECTED.ok ? '' : NOT_CONNECTED.refusal.message
const UNSUPPORTED = "This Hermes can't list routines for Highwing. Update Hermes on that machine, then reconnect."

export interface RoutineBook {
  readonly routines: Routines
  /** Shows this bot's routines and keeps them current. null stops. */
  show(bot: BotId | null): void
  /** Reads again while a bot is shown: Hermes said a job moved, or the link came back. */
  reread(): void
}

/**
 * Owns the routines one window shows. `changed` runs after every change of `routines`. A read for a bot no longer shown,
 * or older than a newer read, is dropped. A read that follows a change keeps the list on screen while it runs.
 */
export function routineBook(conn: Pick<Connection, 'as'>, changed: () => void): RoutineBook {
  let held: Routines = null
  let reads = 0

  const take = (next: Routines) => {
    held = next
    changed()
  }

  const read = async (bot: BotId) => {
    const mine = ++reads
    let list: RoutineList
    try {
      list = parseRoutines(await conn.as(bot).call('cron.manage', { action: 'list', include_disabled: true }, READ_TIMEOUT_MS), bot)
    } catch (error) {
      if (error instanceof Offline) list = held?.list.state === 'listed' ? held.list : { state: 'refused', message: OFFLINE }
      else if (error instanceof RpcRefusal) list = { state: 'refused', message: error.code === METHOD_NOT_FOUND ? UNSUPPORTED : `Hermes couldn't read the routines: ${error.message}` }
      else throw error
    }
    if (mine === reads && held?.bot === bot && JSON.stringify(held.list) !== JSON.stringify(list)) take({ bot, list })
  }

  const reread = () => {
    if (held !== null) void read(held.bot)
  }

  return {
    get routines() { return held },
    show: bot => {
      if (bot === null) {
        reads++
        if (held !== null) take(null)
        return
      }
      take({ bot, list: READING })
      void read(bot)
    },
    reread
  }
}
