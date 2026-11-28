/**
 * The Hermes servers Highwing remembers, the ways in to each, and which way a dial takes.
 * Plain data and pure functions, read by Electron main, by the route that dials and by Settings alike.
 */
import { byKind, hostPart, machineOf, sameTarget, targetOf, type Target } from './reach'

declare const serverId: unique symbol
/** Names a saved server. It is also the `place` its unread marks are kept under. */
export type ServerId = string & { readonly [serverId]: true }

/** `fastest`: the way that answers soonest. `order`: the first way in priority order that answers. */
export type PickMode = 'fastest' | 'order'

export const PICK_MODES: readonly PickMode[] = ['fastest', 'order']

export interface Server {
  readonly id: ServerId
  /** `serverName` of the first way when the server was made. Reordering its ways never renames it. */
  readonly name: string
  /** Priority order, index 0 first. Never empty, never two `sameTarget` ways. */
  readonly ways: readonly [Target, ...Target[]]
  readonly pick: PickMode
}

/** What connection.json holds: never empty, and `current` is one of `list`. */
export interface Servers { readonly list: readonly [Server, ...Server[]]; readonly current: ServerId }

/** How long one way took to answer when it was last timed. null: it did not answer in time. */
export interface Timed { readonly target: Target; readonly ms: number | null }

/** The words a way is shown under. Derived, never stored. */
export type WayLabel = 'Tailscale' | 'LAN' | 'SSH' | 'Web' | 'This computer'

const PRIVATE_NAME = /\.(?:local|lan|home\.arpa)\.?$/i

/** Whether a host name or IP address is one only the local network reaches. An IPv6 address may come bare or in a URL's brackets. */
export function isPrivateHost(name: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(name)
  if (v4 !== null) {
    const [first, second] = [Number(v4[1]), Number(v4[2])]
    return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 169 && second === 254)
  }
  if (name.includes(':')) {
    const head = parseInt(/^\[?([0-9a-f]{1,4}):/i.exec(name)?.[1] ?? '0', 16)
    return (head & 0xfe00) === 0xfc00 || (head & 0xffc0) === 0xfe80
  }
  return PRIVATE_NAME.test(name)
}

export function wayLabel(target: Target): WayLabel {
  return byKind<WayLabel>(target, {
    local: () => 'This computer',
    remote: () => 'Tailscale',
    ssh: ({ host }) => (isPrivateHost(hostPart(host)) ? 'LAN' : 'SSH'),
    url: ({ url }) => {
      const { hostname } = new URL(url)
      return isPrivateHost(hostname) ? 'LAN' : /\.ts\.net\.?$/i.test(hostname) ? 'Tailscale' : 'Web'
    }
  })
}

/** What a server made from `target` is called: the machine, as the Connection card's title names it. */
export const serverName = (target: Target): string => byKind(target, { local: () => 'This computer', remote: machineOf, ssh: machineOf, url: machineOf })

type Obj = Readonly<Record<string, unknown>>
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)
const filled = (value: unknown): value is string => typeof value === 'string' && value !== ''
const isPick = (value: unknown): value is PickMode => PICK_MODES.includes(value as PickMode)

const distinct = (ways: readonly Target[]): boolean => ways.every((way, index) => !ways.slice(0, index).some(earlier => sameTarget(earlier, way)))

function serverOf(raw: unknown): Server | null {
  if (!isObject(raw) || !filled(raw.id) || !filled(raw.name) || !isPick(raw.pick) || !Array.isArray(raw.ways)) return null
  const ways = raw.ways.map(targetOf).filter(way => way !== null)
  if (ways.length === 0 || ways.length !== raw.ways.length || !distinct(ways)) return null
  return { id: raw.id as ServerId, name: raw.name, ways: ways as [Target, ...Target[]], pick: raw.pick }
}

/** The one parser of `Servers`. null: `raw` breaks one of the rules the types state. */
export function serversOf(raw: unknown): Servers | null {
  if (!isObject(raw) || !Array.isArray(raw.list)) return null
  const list = raw.list.map(serverOf).filter(server => server !== null)
  if (list.length === 0 || list.length !== raw.list.length) return null
  const ids = new Set<string>(list.map(server => server.id))
  if (ids.size !== list.length || !filled(raw.current) || !ids.has(raw.current)) return null
  return { list: list as [Server, ...Server[]], current: raw.current as ServerId }
}

export const currentServer = (servers: Servers): Server => servers.list.find(server => server.id === servers.current) ?? servers.list[0]

/** Two times this close count as one, so a way must be clearly faster to pass a way the user put above it. */
export const TIE_MS = 5

/**
 * The indices of `times` to dial, best first. Ways that did not answer come last, in priority order, so a slow timer never hides a working way.
 * `order` keeps the answered ways in priority order. `fastest` takes the lowest time first, or of the ways within `TIE_MS` of it, the one highest in priority.
 */
export function rankWays(times: readonly (number | null)[], pick: PickMode): readonly number[] {
  const indices = times.map((_, index) => index)
  const silent = indices.filter(index => times[index] === null)
  const left = indices.filter(index => times[index] !== null)
  if (pick === 'order') return [...left, ...silent]
  const ranked: number[] = []
  while (left.length > 0) {
    const least = Math.min(...left.map(index => times[index] as number))
    const best = left.findIndex(index => (times[index] as number) - least <= TIE_MS)
    ranked.push(...left.splice(best, 1))
  }
  return [...ranked, ...silent]
}

/** Every change the user can make to the saved servers. One reducer, so the file, the owner and the tests agree. */
export type ServerEdit =
  /** Change: the current server is swapped, in place, for a new one with this id and only this way. With no servers, the first server. */
  | { readonly do: 'replace'; readonly target: Target; readonly id: ServerId }
  /** Appended, and made current. */
  | { readonly do: 'addServer'; readonly target: Target; readonly id: ServerId }
  /** Appended to the current server's ways. A way it already has changes nothing. */
  | { readonly do: 'addWay'; readonly target: Target }
  /** The current server's ways reordered or cut down, and its pick. Every way must be one it already has, none may repeat, and one must be left. */
  | { readonly do: 'arrange'; readonly ways: readonly Target[]; readonly pick: PickMode }
  | { readonly do: 'use'; readonly server: ServerId }
  /** The current server cannot be removed. */
  | { readonly do: 'remove'; readonly server: ServerId }

type Edits = { readonly [E in ServerEdit['do']]: (servers: Servers | null, edit: Extract<ServerEdit, { readonly do: E }>) => Servers | null }

// A new id on purpose: a server's id is where its unread marks are kept, and two machines must never share them.
const made = (id: ServerId, target: Target): Server => ({ id, name: serverName(target), ways: [target], pick: 'fastest' })
const first = (id: ServerId, target: Target): Servers => ({ list: [made(id, target)], current: id })
const taken = (servers: Servers, id: ServerId): boolean => servers.list.some(server => server.id === id)
const withCurrent = (servers: Servers, next: Server): Servers =>
  ({ list: servers.list.map(server => (server.id === servers.current ? next : server)) as [Server, ...Server[]], current: next.id })

const EDITS: Edits = {
  replace: (servers, { id, target }) => {
    if (servers === null) return first(id, target)
    return taken(servers, id) ? null : withCurrent(servers, made(id, target))
  },
  addServer: (servers, { id, target }) => {
    if (servers === null) return first(id, target)
    return taken(servers, id) ? null : { list: [...servers.list, made(id, target)], current: id }
  },
  addWay: (servers, { target }) => {
    if (servers === null) return null
    const server = currentServer(servers)
    return server.ways.some(way => sameTarget(way, target)) ? servers : withCurrent(servers, { ...server, ways: [...server.ways, target] })
  },
  arrange: (servers, { ways, pick }) => {
    if (servers === null) return null
    const server = currentServer(servers)
    const kept = ways.map(way => server.ways.find(held => sameTarget(held, way))).filter(way => way !== undefined)
    if (kept.length === 0 || kept.length !== ways.length || !distinct(kept)) return null
    return withCurrent(servers, { ...server, ways: kept as [Target, ...Target[]], pick })
  },
  use: (servers, { server }) => {
    if (servers === null || !taken(servers, server)) return null
    return servers.current === server ? servers : { ...servers, current: server }
  },
  remove: (servers, { server }) => {
    if (servers === null || servers.current === server || !taken(servers, server)) return null
    return { ...servers, list: servers.list.filter(held => held.id !== server) as [Server, ...Server[]] }
  }
}

/** The saved servers after `edit`. null: the edit is refused. An edit that changes nothing gives back `servers` itself. */
export function nextServers(servers: Servers | null, edit: ServerEdit): Servers | null {
  return (EDITS[edit.do] as (servers: Servers | null, edit: ServerEdit) => Servers | null)(servers, edit)
}
