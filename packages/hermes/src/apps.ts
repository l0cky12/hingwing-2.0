import { refusalOf } from './actor'
import type { AppSignIn, AppsBoard } from './domain/apps'
import type { BotId } from './domain/bots'
import type { Outcome, Refusal } from './domain/command'
import { NOT_CONNECTED } from './open'
import { METHOD_NOT_FOUND, Offline, RpcRefusal, type Connection } from './wire/link'
import { parseApps, parseSignIn } from './wire/parse'

type Wire = Pick<Connection, 'call'>
type Reasons = { readonly [code: number]: (message: string) => Refusal }

const APPS_REASONS: Reasons = {
  [METHOD_NOT_FOUND]: () => ({ kind: 'unsupported', message: "This Hermes can't list its apps." })
}

const profileOf = (bot: BotId | null) => (bot === null ? {} : { profile: bot })
const OWNER = { type: 'account' as const }

async function guarded<T>(work: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof Offline) return NOT_CONNECTED
    return { ok: false, refusal: error instanceof RpcRefusal ? APPS_REASONS[error.code]?.(error.message) ?? refusalOf(error) : refusalOf(error) }
  }
}

export const listApps = (conn: Wire, bot: BotId | null): Promise<Outcome<AppsBoard>> =>
  guarded(async () => {
    const scope = profileOf(bot)
    const [catalog, accounts] = await Promise.all([
      conn.call('connectors.catalog', scope),
      conn.call('connectors.accounts', scope)
    ])
    return { ok: true, value: parseApps(catalog, accounts) }
  })

export const connectApp = (conn: Wire, slug: string, bot: BotId | null, connectionId: string | null): Promise<Outcome<AppSignIn>> =>
  guarded(async () => ({
    ok: true,
    value: parseSignIn(await conn.call('connectors.connect', {
      ...profileOf(bot),
      owner: OWNER,
      connectors: [slug],
      ...(connectionId === null ? {} : { reconnect: true, connection_id: connectionId })
    }))
  }))

/** Hermes forgets a sign-in once it settles (tools/connectors/live.py `get_by_op_id`), so an operation it no longer knows has ended. */
export const appSignIn = (conn: Wire, opId: string, bot: BotId | null): Promise<Outcome<AppSignIn>> =>
  guarded(async () => {
    try {
      return { ok: true, value: parseSignIn(await conn.call('connectors.operation.status', { ...profileOf(bot), owner: OWNER, op_id: opId })) }
    } catch (error) {
      if (error instanceof RpcRefusal && error.reason === 'UNKNOWN_OPERATION') return { ok: true, value: { opId, settled: true, url: null, standing: null } }
      throw error
    }
  })

export const removeApp = (conn: Wire, connectionId: string, bot: BotId | null): Promise<Outcome<void>> =>
  guarded(async () => {
    await conn.call('connectors.accounts.remove', { ...profileOf(bot), connection_id: connectionId })
    return { ok: true, value: undefined }
  })
