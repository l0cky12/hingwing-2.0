import { nextServers, serversOf, targetOf, type ServerId, type Servers } from '@highwing/hermes/domain'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

export const SETTINGS_FILE = 'connection.json'
const VERSION = 2

export type Settings =
  | { readonly state: 'none' }
  | { readonly state: 'saved'; readonly servers: Servers }
  /** Not JSON, not this shape, or not readable as a file. */
  | { readonly state: 'unreadable' }
  /** Written by a later Highwing, which may hold more than this build understands. */
  | { readonly state: 'newer' }

type Obj = Readonly<Record<string, unknown>>

/**
 * Version 1 held one target. It reads as one server with that one way. Its id is the place version 1
 * kept the target's unread marks under, so they are still there after the upgrade.
 */
const fromVersion1 = (raw: Obj): Servers | null => {
  const target = targetOf(raw.target)
  return target && nextServers(null, { do: 'replace', target, id: JSON.stringify(target) as ServerId })
}

const READERS: Readonly<Record<number, (raw: Obj) => Servers | null>> = {
  1: fromVersion1,
  [VERSION]: raw => serversOf({ list: raw.servers, current: raw.current })
}

/** The only code that knows the file's shape. `null` is no file. */
export function parseSettings(text: string | null): Settings {
  if (text === null) return { state: 'none' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { state: 'unreadable' }
  }
  const held: Obj = raw !== null && typeof raw === 'object' ? raw as Obj : {}
  const { version } = held
  if (typeof version === 'number' && version > VERSION) return { state: 'newer' }
  const servers = typeof version === 'number' ? READERS[version]?.(held) ?? null : null
  return servers === null ? { state: 'unreadable' } : { state: 'saved', servers }
}

export async function loadSettings(dir: string): Promise<Settings> {
  try {
    return parseSettings(await readFile(join(dir, SETTINGS_FILE), 'utf8'))
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'none' } : { state: 'unreadable' }
  }
}

/**
 * Writes `servers` as the saved connections, in the current version whatever version was read. A crash
 * leaves the old file or the new one, never half of either: the bytes go to a temp file, are synced,
 * and are renamed over the old file. A file this build cannot read is first set aside as
 * `connection.<reason>-<ms>.json`, so a file from a newer Highwing is never lost.
 */
export async function saveSettings(dir: string, servers: Servers, now: number = Date.now()): Promise<void> {
  const file = join(dir, SETTINGS_FILE)
  await mkdir(dir, { recursive: true })
  const held = await loadSettings(dir)
  if (held.state === 'unreadable' || held.state === 'newer') await rename(file, join(dir, `connection.${held.state}-${now}.json`))
  const temp = await open(`${file}.tmp`, 'w', 0o600)
  try {
    await temp.writeFile(`${JSON.stringify({ version: VERSION, current: servers.current, servers: servers.list })}\n`)
    await temp.sync()
  } finally {
    await temp.close()
  }
  await rename(`${file}.tmp`, file)
}
