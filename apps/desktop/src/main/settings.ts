import { targetOf, type Target } from '@highwing/hermes/domain'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

/** Where Hermes runs. Session state stays with the gateway. The other file Highwing keeps is each chat's unsent draft (`drafts.ts`). */
export const SETTINGS_FILE = 'connection.json'
const VERSION = 1

export type Settings =
  | { readonly state: 'none' }
  | { readonly state: 'saved'; readonly target: Target }
  /** Not JSON, not this shape, or not readable as a file. */
  | { readonly state: 'unreadable' }
  /** Written by a later Highwing, which may hold more than this build understands. */
  | { readonly state: 'newer' }

/** The only code that knows the file's shape. `null` is no file. */
export function parseSettings(text: string | null): Settings {
  if (text === null) return { state: 'none' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { state: 'unreadable' }
  }
  const { version, target } = raw !== null && typeof raw === 'object' ? raw as { readonly version?: unknown; readonly target?: unknown } : {}
  if (typeof version === 'number' && version > VERSION) return { state: 'newer' }
  const parsed = version === VERSION ? targetOf(target) : null
  return parsed === null ? { state: 'unreadable' } : { state: 'saved', target: parsed }
}

export async function loadSettings(dir: string): Promise<Settings> {
  try {
    return parseSettings(await readFile(join(dir, SETTINGS_FILE), 'utf8'))
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'none' } : { state: 'unreadable' }
  }
}

/**
 * Writes `target` as the saved connection. A crash leaves the old file or the new one, never half of
 * either: the bytes go to a temp file, are synced, and are renamed over the old file. A file this
 * build cannot read is first set aside as `connection.<reason>-<ms>.json`, so a file from a newer
 * Highwing is never lost.
 */
export async function saveSettings(dir: string, target: Target, now: number = Date.now()): Promise<void> {
  const file = join(dir, SETTINGS_FILE)
  await mkdir(dir, { recursive: true })
  const held = await loadSettings(dir)
  if (held.state === 'unreadable' || held.state === 'newer') await rename(file, join(dir, `connection.${held.state}-${now}.json`))
  const temp = await open(`${file}.tmp`, 'w', 0o600)
  try {
    await temp.writeFile(`${JSON.stringify({ version: VERSION, target })}\n`)
    await temp.sync()
  } finally {
    await temp.close()
  }
  await rename(`${file}.tmp`, file)
}
