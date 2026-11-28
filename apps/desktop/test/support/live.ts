import { nextServers, type ServerId, type Servers, type Target } from '@highwing/hermes/domain'
import type { Live } from '../../src/ipc-contract'
import type { Settings } from '../../src/main/settings'

export const SERVER = 'server-1' as ServerId

/** A connection to the server every test saves first, through `target`. */
export const live = (target: Target, epoch: number, server: ServerId = SERVER): Live => ({ server, target, epoch })

/** One saved server, `SERVER`, with `target` as its only way in. */
export const oneServer = (target: Target): Servers => nextServers(null, { do: 'replace', target, id: SERVER }) as Servers

export const savedAt = (target: Target): Settings => ({ state: 'saved', servers: oneServer(target) })
